import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
// @ts-expect-error http_ece has no types (it ships with web-push)
import ece from 'http_ece';
import mongoose from 'mongoose';
import webPush from 'web-push';
import { User } from '../../src/modules/users/models/user.model.js';
import { api, check, connectSocket, emit, login, nextEvent, setup, sleep, startServer, teardown, type TestContext } from './helpers.js';

/**
 * A fake push service (what FCM / Mozilla autopush are for real browsers).
 * It decrypts every notification with the "browser" keys, exactly like a
 * browser would, so the test proves the payload really arrives intact.
 *   /ok/*    → 201
 *   /gone/*  → 410 (subscription expired)
 *   /flaky/* → 500 twice, then 201 (tests retry with backoff)
 */
const startFakePushService = (port: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-push-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });

  const devices = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();
  const received: Array<{ device: string; payload: Record<string, unknown> }> = [];
  const hits = new Map<string, number>();

  const server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      const device = path.split('/').pop()!;
      hits.set(path, (hits.get(path) ?? 0) + 1);
      if (path.startsWith('/gone/')) return response.writeHead(410).end();
      if (path.startsWith('/flaky/') && hits.get(path)! <= 2) return response.writeHead(500).end();
      const keys = devices.get(device)!;
      const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: keys.ecdh, authSecret: keys.auth.toString('base64url') });
      received.push({ device, payload: JSON.parse(plain.toString('utf8')) });
      response.writeHead(201).end();
    });
  });
  server.listen(port);

  /** Creates a browser-like subscription (P-256 key + auth secret). */
  const makeSubscription = (kind: 'ok' | 'gone' | 'flaky', device: string) => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = randomBytes(16);
    devices.set(device, { ecdh, auth });
    return {
      endpoint: `https://localhost:${port}/${kind}/${device}`,
      expirationTime: null,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    };
  };
  return { server, received, hits, makeSubscription, certPath: join(dir, 'cert.pem') };
};

/** Web Push via BullMQ (fan-out, retries, expiry), metrics (REST, socket, Prometheus), API docs. */
export const pushMetricsE2E = async () => {
  console.log('\nPush notifications + metrics + API docs');
  const fake = startFakePushService(4800);
  const vapid = webPush.generateVAPIDKeys();
  const ctx: TestContext = await setup('push');
  Object.assign(ctx.env, {
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:test@example.com',
    METRICS_TOKEN: 'metrics-token-1234567890',
    NODE_EXTRA_CA_CERTS: fake.certPath, // trust the fake push service's self-signed cert
  });
  try {
    const hash = await bcrypt.hash('password123', 4);
    await User.create([
      { name: 'Cust', email: 'cust@t.co', passwordHash: hash, role: 'user', status: 'approved' },
      { name: 'Agent Ram', email: 'agent@t.co', passwordHash: hash, role: 'agent', status: 'approved' },
      { name: 'Admin', email: 'admin@t.co', passwordHash: hash, role: 'admin', status: 'approved' },
    ]);
    await startServer(ctx, 4901);
    const customer = await login(4901, 'cust@t.co', 'password123');
    const agent = await login(4901, 'agent@t.co', 'password123');
    const admin = await login(4901, 'admin@t.co', 'password123');

    // --- subscriptions ---
    const key = await api(customer, 'GET', '/push/public-key');
    check('public VAPID key served', key.body?.publicKey === vapid.publicKey, key);
    const bad = await api(customer, 'POST', '/push/subscriptions', { endpoint: 'http://insecure.example/x', keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(10) } });
    check('non-https endpoint rejected (400)', bad.status === 400, bad);
    for (const [kind, device] of [['ok', 'phone'], ['gone', 'oldlaptop'], ['flaky', 'tablet']] as const) {
      const r = await api(customer, 'POST', '/push/subscriptions', fake.makeSubscription(kind, device));
      check(`customer subscribes device "${device}"`, r.status === 201, r);
    }
    const again = await api(customer, 'POST', '/push/subscriptions', fake.makeSubscription('ok', 'phone'));
    check('re-subscribing the same browser updates, not duplicates', again.status === 201 && (await mongoose.connection.collection('pushsubscriptions').countDocuments()) === 3);
    const raw = await mongoose.connection.collection('pushsubscriptions').findOne({});
    check('stored encrypted: endpoint not readable in the database', !JSON.stringify(raw).includes('localhost:4800'), raw);
    await api(agent, 'POST', '/push/subscriptions', fake.makeSubscription('ok', 'agentdesk'));

    // --- agent replies while customer's app is closed → push to all customer devices ---
    const conversationId = (await api(customer, 'GET', '/conversations/mine')).body.conversation.id as string;
    const agentSocket = await connectSocket(agent);
    await emit(agentSocket, 'agent:set-status', { availability: 'online' });
    const sent = await emit(agentSocket, 'message:send', { conversationId, clientId: 'a1', text: 'Namaste! How can I help you today?' });
    check('agent message sent (customer offline)', sent.ok, sent);

    await sleep(3000);
    const phone = fake.received.find((r) => r.device === 'phone');
    check('push delivered and decrypted on "phone"', phone?.payload.title === 'Agent Ram' && phone.payload.body === 'Namaste! How can I help you today?', fake.received);
    check('payload has conversation link + tag', phone?.payload.url === `/chat/${conversationId}` && phone?.payload.tag === `conversation-${conversationId}`, phone);
    check('expired device (410) was deleted', (await mongoose.connection.collection('pushsubscriptions').countDocuments({ userId: new mongoose.Types.ObjectId(customer.id) })) === 2);

    await sleep(17_000); // flaky device: fails, retries after 5s, fails, retries after 10s, succeeds
    check('flaky device retried with backoff and finally got it (3 attempts)', fake.received.some((r) => r.device === 'tablet') && fake.hits.get('/flaky/tablet') === 3, [...fake.hits]);

    // --- customer viewing the chat → no push for them ---
    const customerSocket = await connectSocket(customer);
    await sleep(500);
    const before = fake.received.filter((r) => r.device === 'phone').length;
    await emit(agentSocket, 'message:send', { conversationId, clientId: 'a2', text: 'Are you there?' });
    await sleep(3000);
    check('no push while the customer has the chat open', fake.received.filter((r) => r.device === 'phone').length === before);

    // --- customer writes; agent is not viewing that chat → agent gets a push ---
    await emit(customerSocket, 'message:send', { conversationId, clientId: 'c1', text: 'Yes, my bill is wrong' });
    await sleep(4000);
    check('assigned agent (not viewing the chat) gets a push', fake.received.some((r) => r.device === 'agentdesk' && r.payload.body === 'Yes, my bill is wrong'), fake.received.map((r) => r.device));

    // --- metrics ---
    const overview = await api(admin, 'GET', '/metrics/overview');
    const snap = overview.body?.snapshot;
    check('metrics: messages today = 3', snap?.messages.today === 3, snap);
    check('metrics: push sent ≥ 3, expired = 1', snap?.push.sent >= 3 && snap?.push.expired === 1, snap?.push);
    check('metrics: 2 active users, 1 agent online', snap?.activeUsers === 2 && snap?.agents.online === 1, snap);
    check('metrics: 60-point messages-per-minute series', overview.body?.messagesPerMinute?.length === 60, overview.body?.messagesPerMinute?.length);
    check('metrics REST forbidden for customers', (await api(customer, 'GET', '/metrics/overview')).status === 403);

    const adminSocket = await connectSocket(admin);
    const sub = await emit(adminSocket, 'metrics:subscribe', {});
    check('admin metrics:subscribe → snapshot in ack', sub.ok && typeof sub.data.snapshot.activeUsers === 'number', sub);
    check('live metrics:update arrives within 6s', !!(await nextEvent(adminSocket, 'metrics:update', 6500)));
    const denied = await emit(customerSocket, 'metrics:subscribe', {});
    check('customer cannot subscribe to metrics', denied.ok === false && denied.error.code === 'FORBIDDEN', denied);

    const prom401 = await fetch('http://localhost:4901/metrics');
    const prom = await fetch('http://localhost:4901/metrics', { headers: { authorization: 'Bearer metrics-token-1234567890' } });
    const promText = await prom.text();
    check('Prometheus /metrics needs the token', prom401.status === 401);
    check('Prometheus /metrics text format', prom.status === 200 && promText.includes('chat_active_users 3') && promText.includes('chat_push_today{outcome="expired"} 1'), promText);

    // --- docs ---
    const spec = (await (await fetch('http://localhost:4901/api/docs/openapi.json')).json()) as { openapi: string; paths: Record<string, unknown> };
    check('OpenAPI 3.1 document served', spec.openapi === '3.1.0' && Object.keys(spec.paths).length >= 25, Object.keys(spec.paths).length);
    const ui = await fetch('http://localhost:4901/api/docs/');
    check('Swagger UI served', ui.status === 200 && (await ui.text()).includes('swagger-ui'));

    [agentSocket, customerSocket, adminSocket].forEach((socket) => socket.disconnect());
  } finally {
    fake.server.close();
    await teardown(ctx);
  }
};
