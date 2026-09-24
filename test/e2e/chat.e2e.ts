import bcrypt from 'bcryptjs';
import { User } from '../../src/modules/users/models/user.model.js';
import { check, connectSocket, emit, login, nextEvent, setup, sleep, startServer, teardown, type TestContext } from './helpers.js';

/** Two servers, customer on one, agents on the other: messaging, receipts, typing, presence. */
export const chatE2E = async () => {
  console.log('\nChat + presence (2 servers)');
  const ctx: TestContext = await setup('chat');
  try {

  
  const hash = await bcrypt.hash('password123', 4);
  const mk = (name: string, role: 'user' | 'agent' | 'admin') => User.create({ name, email: `${name.toLowerCase()}@t.co`, passwordHash: hash, role, status: 'approved' });
  const [cust, agent, agent2, other] = await Promise.all([mk('Cust', 'user'), mk('Agent', 'agent'), mk('Agent2', 'agent'), mk('Other', 'user')]);
  await Promise.all([startServer(ctx, 4601), startServer(ctx, 4602)]);

  const health = await (await fetch('http://localhost:4601/health/ready')).json() as any;
  check('health/ready reports mongo+redis', health.checks?.mongo && health.checks?.redis, health);

  const L = await login(4601, 'cust@t.co', 'password123');
  check('login returns user + new csrfToken', L.id === cust.id && typeof L.csrf === 'string' && L.csrf.length === 64, L);
  check('login rotates session id (fixation fix)', L.cookie !== L.preLoginCookie);
  const La = await login(4602, 'agent@t.co', 'password123'); const La2 = await login(4601, 'agent2@t.co', 'password123'); const Lo = await login(4602, 'other@t.co', 'password123');

  const me = await (await fetch('http://localhost:4602/api/v1/auth/me', { headers: { cookie: L.cookie } })).json() as any;
  check('session works on the OTHER server (shared Redis sessions)', me.user?.id === cust.id, me);

  // Unauthenticated socket
  const bad = await connectSocket({ id: '', cookie: 'chat.sid=nope', csrf: '', port: 4601, preLoginCookie: '' }).then(() => 'connected', (e) => e.message);
  check('socket without session refused', bad === 'AUTHENTICATION_REQUIRED', bad);

  const aSock = await connectSocket(La);               // agent on server B
  const pres = await emit(aSock, 'presence:subscribe', { userIds: [cust.id] });
  check('presence snapshot: customer offline before connecting', pres.ok && pres.data[cust.id].online === false, pres);

  const onlineEvt = nextEvent(aSock, 'presence:update', 4000, (p) => p.userId === cust.id);
  const cSock = await connectSocket(L);                // customer on server A
  const onl = await onlineEvt;
  check('agent (server B) sees customer online (server A)', onl?.online === true, onl);

  const mine = await (await fetch('http://localhost:4601/api/v1/conversations/mine', { headers: { cookie: L.cookie } })).json() as any;
  const convId = mine.conversation?.id;
  check('GET /conversations/mine', !!convId, mine);

  // Customer sends while no staff is in the room → stays "sent"
  const staffUpd = nextEvent(aSock, 'conversation:updated', 4000);
  const s1 = await emit(cSock, 'message:send', { conversationId: convId, clientId: 'c1', text: 'hi, need help' });
  check('send ack ok (status sent: no staff in room)', s1.ok && s1.data.status === 'sent', s1);
  const su = await staffUpd;
  check('staff dashboards get conversation:updated with unread=1', su?.conversationId === convId && su.unreadCount === 1, su);

  // Agent joins → message becomes delivered, customer is told
  const delivEvt = nextEvent(cSock, 'message:status', 4000, (p) => p.status === 'delivered');
  const j = await emit(aSock, 'conversation:join', { conversationId: convId });
  check('agent joins conversation', j.ok, j);
  const dv = await delivEvt;
  check('customer (server A) gets delivered status for msg', dv?.messageId === s1.data.id, dv);

  // Now a message goes straight to delivered and crosses servers
  const newEvt = nextEvent(aSock, 'message:new', 4000);
  const s2 = await emit(cSock, 'message:send', { conversationId: convId, clientId: 'c2', text: 'are you there?' });
  const nm = await newEvt;
  check('message:new crosses servers', nm?.id === s2.data?.id && nm.text === 'are you there?', nm);
  check('status is delivered immediately when agent in room', s2.data?.status === 'delivered', s2);

  // Idempotent retry
  const dup = nextEvent(aSock, 'message:new', 1500);
  const s2b = await emit(cSock, 'message:send', { conversationId: convId, clientId: 'c2', text: 'are you there?' });
  check('retry with same clientId → same message, no rebroadcast', s2b.data?.id === s2.data?.id && (await dup) === null, s2b);

  // Validation / access
  const inv = await emit(cSock, 'message:send', { conversationId: convId, text: '' });
  check('invalid payload → INVALID_PAYLOAD', inv.ok === false && inv.error.code === 'INVALID_PAYLOAD', inv);
  const oSock = await connectSocket(Lo);
  const oj = await emit(oSock, 'conversation:join', { conversationId: convId });
  check('other customer cannot join → CONVERSATION_NOT_FOUND', oj.ok === false && oj.error.code === 'CONVERSATION_NOT_FOUND', oj);
  const os = await emit(oSock, 'message:send', { conversationId: convId, clientId: 'x', text: 'hack' });
  check('other customer cannot send', os.ok === false, os);

  // Typing: start broadcast once, keep-alives not rebroadcast, explicit stop
  const t1 = nextEvent(aSock, 'typing:update', 3000);
  await emit(cSock, 'typing:set', { conversationId: convId, isTyping: true });
  check('typing start reaches agent', (await t1)?.isTyping === true);
  const t2 = nextEvent(aSock, 'typing:update', 1000);
  await emit(cSock, 'typing:set', { conversationId: convId, isTyping: true });
  check('typing keep-alive is NOT rebroadcast (saves traffic)', (await t2) === null);
  const t3 = nextEvent(aSock, 'typing:update', 3000);
  await emit(cSock, 'typing:set', { conversationId: convId, isTyping: false });
  check('typing stop reaches agent', (await t3)?.isTyping === false);
  const t4 = nextEvent(aSock, 'typing:update', 9000, (p) => p.isTyping === false);
  await emit(cSock, 'typing:set', { conversationId: convId, isTyping: true });
  await nextEvent(aSock, 'typing:update', 500);
  check('typing auto-clears after 6s without keep-alive', (await t4)?.isTyping === false);

  // Staff reply from agent2 (not in room) then agent reads customer messages
  const a2Sock = await connectSocket(La2);
  await emit(a2Sock, 'conversation:join', { conversationId: convId });
  const custUpd = nextEvent(cSock, 'conversation:updated', 4000);
  const r1 = await emit(a2Sock, 'message:send', { conversationId: convId, clientId: 'a2-1', text: 'Hello, agent2 here' });
  check('agent2 reply delivered (customer in room)', r1.ok && r1.data.status === 'delivered', r1);
  const cu = await custUpd;
  check('customer gets conversation:updated unread=1 (staff msgs)', cu?.unreadCount === 1, cu);

  const readEvt = nextEvent(cSock, 'message:status', 4000, (p) => p.status === 'read');
  const staffUnread = nextEvent(a2Sock, 'conversation:updated', 4000);
  const rd = await emit(aSock, 'message:read', { conversationId: convId, lastMessageId: r1.data.id });
  check('agent read ack ok', rd.ok, rd);
  const re = await readEvt;
  check('customer sees read receipt', re?.status === 'read', re);
  const sun = await staffUnread;
  check('all staff get unread=0 after one agent reads', sun?.unreadCount === 0, sun);
  const hist = await (await fetch(`http://localhost:4601/api/v1/conversations/${convId}/messages`, { headers: { cookie: L.cookie } })).json() as any;
  const a2msg = hist.data.find((m: any) => m.id === r1.data.id);
  check("agent reading does NOT mark agent2's reply as read", a2msg?.status === 'delivered', a2msg);
  const custMsgs = hist.data.filter((m: any) => m.senderId === cust.id);
  check('customer messages are read', custMsgs.every((m: any) => m.status === 'read'), custMsgs.map((m: any) => m.status));

  const noop = nextEvent(cSock, 'message:status', 1000);
  await emit(aSock, 'message:read', { conversationId: convId, lastMessageId: r1.data.id });
  check('repeated read → no duplicate broadcast', (await noop) === null);

  const cread = nextEvent(a2Sock, 'message:status', 3000, (p) => p.status === 'read');
  await emit(cSock, 'message:read', { conversationId: convId, lastMessageId: r1.data.id });
  check('customer reads staff reply → staff sees read', (await cread)?.messageId === r1.data.id);

  const list = await (await fetch('http://localhost:4602/api/v1/conversations', { headers: { cookie: La.cookie } })).json() as any;
  check('REST list for agent: unread 0 + customer info', list.conversations?.[0]?.unreadCount === 0 && list.conversations[0].customer.name === 'Cust', list);

  // Leave room
  const lv = await emit(aSock, 'conversation:leave', { conversationId: convId });
  const afterLeave = nextEvent(aSock, 'message:new', 1500);
  await emit(cSock, 'message:send', { conversationId: convId, clientId: 'c3', text: 'after leave' });
  check('after conversation:leave agent no longer gets message:new', lv.ok && (await afterLeave) === null);

  // Rate limit
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) { const r = await emit(cSock, 'message:send', { conversationId: convId, clientId: 'rl' + i, text: 'spam ' + i }); if (!r.ok && r.error.code === 'RATE_LIMITED') limited = true; }
  check('socket rate limit kicks in', limited);

  // Presence: two tabs, reload grace, offline
  const tab2 = await connectSocket(L);
  const noOffline = nextEvent(aSock, 'presence:update', 6500, (p) => p.userId === cust.id && !p.online);
  cSock.disconnect();
  check('closing one of two tabs keeps user online', (await noOffline) === null);
  const reloadOffline = nextEvent(aSock, 'presence:update', 6500, (p) => p.userId === cust.id && !p.online);
  tab2.disconnect(); await sleep(800);
  const tab3 = await connectSocket(L);             // "page reload" within 5s grace
  check('page reload within grace period → no offline flicker', (await reloadOffline) === null);
  const offline = nextEvent(aSock, 'presence:update', 8000, (p) => p.userId === cust.id && !p.online);
  tab3.disconnect();
  const off = await offline;
  check('last tab closed → offline with lastSeen (after 5s grace)', off?.online === false && !!off.lastSeen, off);

  [aSock, a2Sock, oSock].forEach((s) => s.disconnect());
  } finally {
    await teardown(ctx);
  }
};
