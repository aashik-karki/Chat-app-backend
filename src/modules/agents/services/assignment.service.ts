import { hasPermission } from '../../../common/auth/permissions.js';
import { HttpError } from '../../../common/errors/http-error.js';
import { logger } from '../../../core/logger.js';
import { isRedisReady, redis } from '../../../core/redis/redis.js';
import { rooms } from '../../../realtime/rooms.js';
import type { AppServer, SocketUser } from '../../../realtime/socket.types.js';
import type { LeanConversation } from '../../chat/models/conversation.types.js';
import type { ConversationsService } from '../../chat/services/conversations.service.js';
import type { PresenceService } from '../../presence/presence.service.js';
import type { UsersService } from '../../users/users.service.js';
import type { AgentCandidate, AgentsService } from './agents.service.js';

type AssignReason = 'auto' | 'claim' | 'manual' | 'requeue' | 'closed';
type Actor = Pick<SocketUser, 'id' | 'role'>;

/** An agent who has been disconnected this long loses their open chats to the queue. */
const OFFLINE_REQUEUE_AFTER_MS = 60_000;
const REBALANCE_EVERY_MS = 30_000;

/**
 * Routing: which agent gets which conversation.
 *
 * Load balancing: the least-loaded available agent wins; ties go to whoever
 * got a chat the longest time ago (round robin). Skill-based routing: agents
 * whose skills include the conversation's topic are tried first; if none is
 * free, any available agent is used rather than letting the customer wait.
 *
 * Race safety across servers — assignment is two atomic steps:
 *   1. reserve a slot on the agent  (only if activeChats < maxConcurrentChats)
 *   2. assign the conversation      (only if it still has no agent)
 * If step 2 loses (another server assigned it first), step 1 is undone.
 */
export class AssignmentService {
  private io: AppServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  /** Per-conversation lock (this server): rapid messages don't race to assign the same chat. */
  private assigning = new Map<string, Promise<unknown>>();

  constructor(
    private readonly agents: AgentsService,
    private readonly conversations: ConversationsService,
    private readonly presence: PresenceService,
    private readonly users: UsersService,
  ) {}

  start(io: AppServer) {
    this.io = io;
    this.timer = setInterval(() => void this.rebalance(), REBALANCE_EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Available = chose "online" + actually connected + below capacity. Best candidates first. */
  private async candidatesFor(conversation: LeanConversation): Promise<AgentCandidate[]> {
    const agents = await this.agents.listAgents();
    const presence = await this.presence.snapshot(agents.map((agent) => agent.user.id));
    const available = agents.filter(
      ({ user, profile }) =>
        presence[user.id]?.online && profile.availability === 'online' && profile.activeChats < profile.maxConcurrentChats,
    );
    const topic = conversation.topic ?? 'general';
    const skillScore = (candidate: AgentCandidate) => (topic !== 'general' && candidate.profile.skills.includes(topic) ? 0 : 1);
    return available.sort(
      (a, b) =>
        skillScore(a) - skillScore(b) ||
        a.profile.activeChats - b.profile.activeChats ||
        (a.profile.lastAssignedAt?.getTime() ?? 0) - (b.profile.lastAssignedAt?.getTime() ?? 0),
    );
  }

  /** Tries to give an unassigned open conversation to the best available agent. */
  autoAssign(conversationId: string): Promise<'assigned' | 'no_agent' | 'skipped'> {
    // Chain behind any assignment already running for this conversation on this server.
    // (Across servers the atomic reserve + assignIfUnassigned below still decides the winner.)
    const previous = this.assigning.get(conversationId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.assignNow(conversationId));
    this.assigning.set(conversationId, run);
    void run.finally(() => {
      if (this.assigning.get(conversationId) === run) this.assigning.delete(conversationId);
    });
    return run;
  }

  private async assignNow(conversationId: string): Promise<'assigned' | 'no_agent' | 'skipped'> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation || conversation.status !== 'open' || conversation.assignedAgentId) return 'skipped';

    for (const candidate of await this.candidatesFor(conversation)) {
      if (!(await this.agents.reserveSlot(candidate.user.id))) continue; // filled up meanwhile → next agent
      const assigned = await this.conversations.assignIfUnassigned(conversationId, candidate.user.id);
      if (!assigned) {
        await this.agents.releaseSlot(candidate.user.id); // someone else assigned it first
        return 'skipped';
      }
      await this.announce(assigned, null, 'auto');
      return 'assigned';
    }
    return 'no_agent';
  }

  /** Assigns waiting conversations, oldest first, until the queue or the free agents run out. */
  async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (const conversation of await this.conversations.listQueue()) {
        if ((await this.autoAssign(conversation._id.toString())) === 'no_agent') break;
      }
    } catch (error) {
      logger.warn({ error }, 'Draining the queue failed');
    } finally {
      this.draining = false;
    }
  }

  /** An agent takes an unassigned conversation themselves. */
  async claim(conversationId: string, agent: Actor): Promise<LeanConversation> {
    if (agent.role !== 'agent') throw HttpError.forbidden('Only agents can claim conversations');
    const current = await this.requireOpen(conversationId);
    if (current.assignedAgentId?.toString() === agent.id) return current;
    if (current.assignedAgentId) throw HttpError.conflict('ALREADY_ASSIGNED', 'Another agent already has this conversation');

    await this.agents.reserveSlot(agent.id, true);
    const assigned = await this.conversations.assignIfUnassigned(conversationId, agent.id);
    if (!assigned) {
      await this.agents.releaseSlot(agent.id);
      throw HttpError.conflict('ALREADY_ASSIGNED', 'Another agent already has this conversation');
    }
    await this.announce(assigned, null, 'claim');
    return assigned;
  }

  /** Admin moves a conversation to another agent, or back to the queue (toAgentId = null). */
  async transfer(conversationId: string, toAgentId: string | null): Promise<LeanConversation> {
    const current = await this.requireOpen(conversationId);
    const fromAgentId = current.assignedAgentId?.toString() ?? null;
    if (fromAgentId === toAgentId) return current;
    if (toAgentId && !(await this.agents.isAgent(toAgentId))) throw HttpError.notFound('AGENT_NOT_FOUND', 'Agent not found');

    if (toAgentId) await this.agents.reserveSlot(toAgentId, true);
    const moved = await this.conversations.reassign(conversationId, fromAgentId, toAgentId);
    if (!moved) {
      if (toAgentId) await this.agents.releaseSlot(toAgentId);
      throw HttpError.conflict('ASSIGNMENT_CHANGED', 'The assignment changed meanwhile; reload and try again');
    }
    if (fromAgentId) await this.agents.releaseSlot(fromAgentId);
    await this.announce(moved, fromAgentId, toAgentId ? 'manual' : 'requeue');
    if (!toAgentId) void this.autoAssign(conversationId);
    return moved;
  }

  /** The assigned agent (or an admin) closes the conversation; the agent's slot frees up. */
  async close(conversationId: string, actor: Actor): Promise<void> {
    const current = await this.requireOpen(conversationId);
    const assignee = current.assignedAgentId?.toString() ?? null;
    if (actor.role !== 'admin' && assignee !== actor.id) {
      throw HttpError.forbidden('Only the assigned agent or an admin can close this conversation');
    }
    const before = await this.conversations.close(conversationId);
    if (!before) return; // closed by someone else meanwhile
    if (assignee) await this.agents.releaseSlot(assignee);
    await this.announce({ ...before, status: 'closed', assignedAgentId: null }, assignee, 'closed');
    void this.drainQueue(); // that agent has room for the next waiting customer
  }

  /**
   * Chat gateway hook, runs before a staff reply is saved:
   *  - admins can always reply
   *  - an agent can reply to their own chats
   *  - replying to an unassigned chat claims it
   *  - another agent's chat is blocked
   */
  staffReplyGuard = async (conversationId: string, staff: SocketUser): Promise<void> => {
    if (hasPermission(staff.role, 'agent:assign')) return;
    const conversation = await this.requireOpenOrReopen(conversationId);
    const assignee = conversation.assignedAgentId?.toString() ?? null;
    if (assignee === staff.id) return;
    if (assignee) throw HttpError.forbidden('This conversation is assigned to another agent');
    await this.claim(conversationId, staff);
  };

  /** Chat gateway hook, runs after a message is saved. */
  onMessageCreated = async (event: { conversation: { id: string }; sender: SocketUser }): Promise<void> => {
    if (event.sender.role !== 'user') return;
    try {
      await this.conversations.reopenIfClosed(event.conversation.id);
      await this.autoAssign(event.conversation.id);
    } catch (error) {
      logger.warn({ error, conversationId: event.conversation.id }, 'Auto-assign after message failed');
    }
  };

  /** An agent went offline/busy/online (or their capacity changed). */
  onAgentStatusChange = (agentId: string, status: 'online' | 'busy' | 'offline'): void => {
    if (status === 'online') void this.drainQueue();
    // "offline" by choice → their chats go to others right away.
    // Disconnected (network) → handled by rebalance after OFFLINE_REQUEUE_AFTER_MS.
    if (status === 'offline') {
      void this.agents
        .getStatus(agentId)
        .then((current) => (current.availability === 'offline' ? this.requeueAgentChats(agentId) : undefined))
        .catch((error) => logger.warn({ error, agentId }, 'Requeue after going offline failed'));
    }
  };

  /** Puts every open chat of this agent back in the queue, then reassigns them. */
  async requeueAgentChats(agentId: string): Promise<number> {
    let moved = 0;
    for (const conversation of await this.conversations.listOpenAssignedTo(agentId)) {
      const requeued = await this.conversations.reassign(conversation._id.toString(), agentId, null);
      if (!requeued) continue;
      await this.agents.releaseSlot(agentId);
      await this.announce(requeued, agentId, 'requeue');
      moved += 1;
    }
    if (moved > 0) {
      logger.info({ agentId, moved }, 'Requeued conversations of unavailable agent');
      await this.drainQueue();
    }
    return moved;
  }

  /**
   * Runs every 30s on ONE server (Redis lock). Repairs anything the
   * event-driven paths missed — e.g. a server crashed mid-assignment:
   *  - re-counts every agent's open chats (fixes counter drift)
   *  - requeues chats of agents disconnected > 60s, or who chose "offline"
   *  - requeues chats of users who are no longer agents
   *  - assigns waiting conversations
   */
  async rebalance(): Promise<void> {
    try {
      if (isRedisReady()) {
        const gotLock = await redis.set('agents:rebalance-lock', '1', 'PX', REBALANCE_EVERY_MS - 5_000, 'NX');
        if (!gotLock) return;
      }

      const agents = await this.agents.listAgents();
      const agentIds = agents.map((agent) => agent.user.id);
      await this.agents.syncActiveChats(await this.conversations.countOpenByAgent(agentIds));

      const presence = await this.presence.snapshot(agentIds);
      const now = Date.now();
      for (const { user, profile } of agents) {
        const state = presence[user.id];
        const goneTooLong = !state?.online && (!state?.lastSeen || now - Date.parse(state.lastSeen) > OFFLINE_REQUEUE_AFTER_MS);
        if (profile.availability === 'offline' || goneTooLong) await this.requeueAgentChats(user.id);
      }

      for (const orphan of await this.conversations.listOpenAssignedOutside(agentIds)) {
        const requeued = await this.conversations.reassign(orphan._id.toString(), orphan.assignedAgentId!.toString(), null);
        if (requeued) await this.announce(requeued, orphan.assignedAgentId!.toString(), 'requeue');
      }

      await this.drainQueue();
    } catch (error) {
      logger.warn({ error }, 'Assignment rebalance failed');
    }
  }

  private async requireOpen(conversationId: string): Promise<LeanConversation> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) throw HttpError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    if (conversation.status === 'closed') throw HttpError.conflict('CONVERSATION_CLOSED', 'Conversation is closed');
    return conversation;
  }

  /** A staff reply to a closed thread re-opens it. */
  private async requireOpenOrReopen(conversationId: string): Promise<LeanConversation> {
    await this.conversations.reopenIfClosed(conversationId);
    return this.requireOpen(conversationId);
  }

  /** Tells staff dashboards, the customer, and the old/new agent about an assignment change. */
  private async announce(conversation: LeanConversation, previousAgentId: string | null, reason: AssignReason) {
    const agentId = conversation.assignedAgentId?.toString() ?? null;
    const agent = agentId ? await this.users.findPublicById(agentId) : null;
    const targets = [rooms.staff, rooms.user(conversation.customerId.toString()), rooms.conversation(conversation._id.toString())];
    this.io?.to(targets).emit('conversation:assigned', {
      conversationId: conversation._id.toString(),
      agentId,
      agentName: agent?.name ?? null,
      status: conversation.status ?? 'open',
      reason,
    });
    // Load changed → dashboards need the new activeChats numbers.
    for (const id of new Set([agentId, previousAgentId].filter((value): value is string => Boolean(value)))) {
      void this.agents.broadcastStatus(id).catch(() => undefined);
    }
  }
}
