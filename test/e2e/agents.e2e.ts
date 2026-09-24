import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import type { Socket } from 'socket.io-client';
import { User } from '../../src/modules/users/models/user.model.js';
import { api, check, connectSocket, emit, login, nextEvent, setup, sleep, startServer, teardown, type Client, type TestContext } from './helpers.js';

/** Agent status, skill routing, load balancing, queue, claim race, transfer, requeue, self-healing counters. */
export const agentsE2E = async () => {
  console.log('\nAgents + assignment (2 servers)');
  const ctx: TestContext = await setup('agents');
  try {

  const hash = await bcrypt.hash('password123', 4);
  const mk = (name: string, role: 'user' | 'agent' | 'admin') => User.create({ name, email: `${name.toLowerCase()}@t.co`, passwordHash: hash, role, status: 'approved' });
  await Promise.all(['C1', 'C2', 'C3', 'C4'].map((n) => mk(n, 'user')));
  await mk('AgentA', 'agent'); await mk('AgentB', 'agent'); await mk('Admin', 'admin');
  await Promise.all([startServer(ctx, 4701), startServer(ctx, 4702)]);

  const admin = await login(4701, 'admin@t.co', 'password123');
  const A = await login(4702, 'agenta@t.co', 'password123');
  const B = await login(4701, 'agentb@t.co', 'password123');
  const [c1, c2, c3, c4] = (await Promise.all(['c1', 'c2', 'c3', 'c4'].map((n, i) => login(i % 2 ? 4702 : 4701, `${n}@t.co`, 'password123')))) as [Client, Client, Client, Client];

  // Admin configures agents: A = billing, max 2; B = max 1
  let r = await api(admin, 'PATCH', `/agents/${A.id}/settings`, { skills: ['billing'], maxConcurrentChats: 2 });
  check('admin sets agent A skills/capacity', r.status === 200 && r.body.agent.maxConcurrentChats === 2, r);
  r = await api(admin, 'PATCH', `/agents/${B.id}/settings`, { maxConcurrentChats: 1 });
  r = await api(A, 'PATCH', `/agents/${B.id}/settings`, { maxConcurrentChats: 9 });
  check('agent cannot change agent settings (403)', r.status === 403, r);

  const adminSock = await connectSocket(admin);
  const aSock = await connectSocket(A); const bSock = await connectSocket(B);

  r = await api(admin, 'GET', '/agents');
  check('agents list: connected but status offline until they choose online', r.body.agents.every((a: any) => a.connected && a.status === 'offline'), r.body);

  const dash = nextEvent(adminSock, 'agent:status', 4000, (p) => p.agentId === A.id && p.status === 'online');
  const s1 = await emit(aSock, 'agent:set-status', { availability: 'online' });
  check('agent A goes online via socket', s1.ok && s1.data.status === 'online', s1);
  check('admin dashboard (other server) gets live agent:status', !!(await dash));
  const s2 = await api(B, 'PATCH', '/agents/me/status', { availability: 'online' });
  check('agent B goes online via REST', s2.status === 200 && s2.body.agent.status === 'online', s2);
  r = await api(c1, 'PATCH', '/agents/me/status', { availability: 'online' });
  check('customer cannot set agent status (403)', r.status === 403, r);

  // Customers
  const [k1, k2, k3, k4] = (await Promise.all([c1, c2, c3, c4].map(connectSocket))) as [Socket, Socket, Socket, Socket];
  const t = await api(c1, 'PATCH', '/conversations/mine/topic', { topic: 'billing' });
  check('customer 1 sets topic billing', t.status === 200 && t.body.conversation.topic === 'billing', t);
  const conv = async (c: Client) => (await api(c, 'GET', '/conversations/mine')).body.conversation.id as string;
  const [cv1, cv2, cv3, cv4] = [await conv(c1), await conv(c2), await conv(c3), await conv(c4)];

  // 1) Skill-based: billing → A
  const asg1 = nextEvent(k1, 'conversation:assigned', 4000);
  const adminAsg = nextEvent(adminSock, 'conversation:assigned', 4000, (p) => p.conversationId === cv1);
  await emit(k1, 'message:send', { conversationId: cv1, clientId: 'm1', text: 'billing question' });
  const a1 = await asg1;
  check('billing chat → agent A (skill match), customer told agent name', a1?.agentId === A.id && a1.agentName === 'AgentA' && a1.reason === 'auto', a1);
  check('staff dashboard gets the assignment too', (await adminAsg)?.agentId === A.id);

  // 2) Load balancing: general → B (0 chats) not A (1 chat)
  const asg2 = nextEvent(k2, 'conversation:assigned', 4000);
  await emit(k2, 'message:send', { conversationId: cv2, clientId: 'm1', text: 'hello' });
  check('general chat → least loaded agent B', (await asg2)?.agentId === B.id);

  // 3) B full (1/1) → A (1/2)
  const asg3 = nextEvent(k3, 'conversation:assigned', 4000);
  await emit(k3, 'message:send', { conversationId: cv3, clientId: 'm1', text: 'hi' });
  check('B at capacity → goes to A', (await asg3)?.agentId === A.id);

  // 4) everyone full → queue
  const asg4 = nextEvent(k4, 'conversation:assigned', 1500);
  await emit(k4, 'message:send', { conversationId: cv4, clientId: 'm1', text: 'anyone?' });
  check('all agents full → no assignment', (await asg4) === null);
  r = await api(admin, 'GET', '/agents/queue');
  check('customer 4 is in the queue', r.body.queue.length === 1 && r.body.queue[0].conversationId === cv4, r.body);
  r = await api(admin, 'GET', '/agents');
  const load = Object.fromEntries(r.body.agents.map((a: any) => [a.name, a.activeChats]));
  check('activeChats counters A=2, B=1', load.AgentA === 2 && load.AgentB === 1, load);

  // 5) reply guard
  await emit(bSock, 'conversation:join', { conversationId: cv1 });
  const g = await emit(bSock, 'message:send', { conversationId: cv1, clientId: 'b1', text: 'let me help' });
  check("agent B cannot reply in agent A's chat", g.ok === false && g.error.code === 'FORBIDDEN', g);
  await emit(adminSock, 'conversation:join', { conversationId: cv1 });
  const ga = await emit(adminSock, 'message:send', { conversationId: cv1, clientId: 'ad1', text: 'admin here' });
  check('admin can reply anywhere', ga.ok, ga);

  // 6) close frees a slot → queued customer 4 goes to A
  const asgQ = nextEvent(k4, 'conversation:assigned', 5000);
  const cl = await api(B, 'POST', `/agents/conversations/${cv1}/close`);
  check('agent B cannot close A\'s chat (403)', cl.status === 403, cl);
  const closeEvt = nextEvent(k1, 'conversation:assigned', 4000, (p) => p.status === 'closed');
  const cl2 = await api(A, 'POST', `/agents/conversations/${cv1}/close`);
  check('agent A closes chat 1', cl2.status === 204, cl2);
  check('customer 1 told chat closed', (await closeEvt)?.reason === 'closed');
  check('freed slot → queued customer 4 auto-assigned to A', (await asgQ)?.agentId === A.id);

  // 7) closed chat reopened by customer → back to routing; A full, B full → queue
  const reo = nextEvent(k1, 'conversation:assigned', 1500);
  await emit(k1, 'message:send', { conversationId: cv1, clientId: 'm2', text: 'one more thing' });
  check('customer reopens closed chat; all agents full → queued', (await reo) === null);
  r = await api(admin, 'GET', `/conversations/${cv1}`);
  check('chat 1 is open again', r.body.conversation.status === 'open' && r.body.conversation.assignedAgentId === null, r.body);

  // 8) admin transfer (ignores capacity)
  r = await api(A, 'POST', `/agents/conversations/${cv1}/transfer`, { agentId: B.id });
  check('agent cannot transfer (403)', r.status === 403, r);
  const tr = nextEvent(k1, 'conversation:assigned', 4000);
  r = await api(admin, 'POST', `/agents/conversations/${cv1}/transfer`, { agentId: B.id });
  check('admin transfers chat 1 to B', r.status === 200 && r.body.assignedAgentId === B.id, r);
  check('customer told about manual transfer', (await tr)?.reason === 'manual');

  // 9) claim race: unassigned chat, two agents claim at once → exactly one wins
  await api(admin, 'POST', `/agents/conversations/${cv2}/transfer`, { agentId: null }); // back to queue (auto-assign may fail: all full)
  const [x, y] = await Promise.all([api(A, 'POST', `/agents/conversations/${cv2}/claim`), api(B, 'POST', `/agents/conversations/${cv2}/claim`)]);
  const winners = [x, y].filter((z) => z.status === 200).length;
  check('two agents claim at the same time → exactly one wins, other gets 409', winners === 1 && [x.status, y.status].includes(409), [x, y]);

  // 10) agent chooses offline → chats requeued immediately
  const before = (await api(admin, 'GET', '/agents')).body.agents.find((a: any) => a.name === 'AgentA').activeChats;
  const rq = nextEvent(adminSock, 'conversation:assigned', 5000, (p) => p.reason === 'requeue');
  await emit(aSock, 'agent:set-status', { availability: 'offline' });
  check('agent A going offline → their chats requeued', !!(await rq) && before > 0, before);
  await sleep(500);
  r = await api(admin, 'GET', '/agents');
  const aNow = r.body.agents.find((a: any) => a.name === 'AgentA');
  check('agent A now has 0 chats, status offline', aNow.activeChats === 0 && aNow.status === 'offline', aNow);

  // 11) busy agent gets nothing new; raising capacity + online drains the queue
  await emit(bSock, 'agent:set-status', { availability: 'busy' });
  const q1 = (await api(admin, 'GET', '/agents/queue')).body.queue.length;
  check('queue holds A\'s chats while B busy', q1 > 0, q1);
  await api(admin, 'PATCH', `/agents/${B.id}/settings`, { maxConcurrentChats: 10 });
  await sleep(500);
  check('busy B still gets nothing', (await api(admin, 'GET', '/agents/queue')).body.queue.length === q1);
  await emit(bSock, 'agent:set-status', { availability: 'online' });
  await sleep(1500);
  const q2 = (await api(admin, 'GET', '/agents/queue')).body.queue.length;
  check('B back online with room → queue drained to B', q2 === 0, q2);

  // 12) agent B disconnects: status offline on dashboards (chats kept for 60s grace)
  const off = nextEvent(adminSock, 'agent:status', 9000, (p) => p.agentId === B.id && p.status === 'offline');
  bSock.disconnect();
  const o = await off;
  check('B disconnects → dashboards see offline (after presence grace)', o?.connected === false, o);
  r = await api(admin, 'GET', '/agents');
  check('B keeps chats during short disconnect (no instant requeue)', r.body.agents.find((a: any) => a.name === 'AgentB').activeChats > 0, r.body);

  // 13) self-healing: corrupt a counter in the DB; the 30s rebalance must fix it
  await mongoose.connection.collection('agentprofiles').updateOne({ userId: new mongoose.Types.ObjectId(A.id) }, { $set: { activeChats: 99 } });
  const real = await mongoose.connection.collection('conversations').countDocuments({ status: 'open', assignedAgentId: new mongoose.Types.ObjectId(A.id) });
  await sleep(32_000);
  r = await api(admin, 'GET', '/agents');
  const healed = r.body.agents.find((a: any) => a.name === 'AgentA').activeChats;
  check(`corrupted counter (99) repaired by rebalance to real count (${real})`, healed === real, { healed, real });

  [adminSock, aSock, k1, k2, k3, k4].forEach((s) => s.disconnect());
  } finally {
    await teardown(ctx);
  }
};
