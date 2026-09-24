# Support Chat Backend

Real-time customer-support chat: Node.js, Express 5, TypeScript, Socket.IO, MongoDB, Redis, BullMQ.
Structured like a NestJS app (modules → routes → controllers → services → models), without the framework.

## Quick start

Requirements: Node.js 22+, MongoDB, Redis.

```bash
cp .env.example .env          # set SESSION_SECRET (32+ chars)
npm install
npm run push:vapid            # optional: paste the output into .env to enable Web Push
npm run seed:admin            # creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                   # http://localhost:4000
```

- API docs (Swagger UI): http://localhost:4000/api/docs · OpenAPI JSON: `/api/docs/openapi.json`
- Real-time events: [docs/realtime-events.md](docs/realtime-events.md)
- Health: `/health` (process up) · `/health/ready` (MongoDB + Redis)

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run with watch mode |
| `npm run build` / `npm start` | Compile to `dist/` / run compiled |
| `npm test` | Unit tests (vitest) |
| `npm run test:e2e` | End-to-end: 2 real server processes + real MongoDB/Redis (`-- chat`, `-- agents`, `-- push` to run one) |
| `npm run seed:admin` | Create the first admin |
| `npm run push:vapid` | Generate VAPID + encryption keys for Web Push |

## Architecture

```
src/
  main.ts                 bootstrap: infra → modules → HTTP → Socket.IO → graceful shutdown
  app.ts                  Express app: security middleware, docs, /api/v1 routers, errors
  core/                   config (zod-validated env), logger, MongoDB, Redis, sessions
  common/                 guards (auth, permission, CSRF), validate pipe, rate limiter, errors
  realtime/               Socket.IO server, Redis Streams adapter, socket auth, event handler wrapper
  modules/
    auth/  users/         login/register/session, admin approval, roles
    chat/                 conversations, messages, Redis history cache, export, chat gateway
    presence/             online/offline in Redis (multi-tab, reload grace, crash sweep)
    agents/               agent status, skill routing, load balancing, queue, assignment
    push/                 Web Push subscriptions (encrypted) + BullMQ delivery queue
    metrics/              live metrics (socket + REST), Redis time series, Prometheus
  docs/openapi.ts         OpenAPI generated from the zod DTOs
```

Each module has `schemas/` (Mongoose), `models/`, `dto/` (zod), `*.service.ts`, `*.controller.ts`, `*.routes.ts`, optional `*.gateway.ts`, and a `*.module.ts` that wires them.

### Key design decisions

- **Auth without JWT:** HttpOnly + SameSite session cookie stored in Redis; session id rotated on login; CSRF token on every unsafe request; the same cookie authenticates sockets.
- **Authorization:** permission-based (`common/auth/permissions.ts`) — routes ask for a permission, roles map to permissions; add a role by editing one file.
- **Horizontal scaling:** sessions, presence, rate limits, cache and queues live in Redis; Socket.IO uses the Redis **Streams** adapter (cross-server events + connection-state recovery).
- **Messages:** idempotent sends (`clientMessageId` unique index), keyset pagination, status only moves forward (`sent → delivered → read`) via atomic conditional updates; read status is per side (customer vs support team).
- **Cache:** cache-aside for the hot first page of each conversation, invalidated by a per-conversation version counter (no stale-write race).
- **Agents:** atomic capacity reservation + conditional assignment, so two servers can't double-assign; a 30s rebalance (one server, Redis lock) repairs counters and requeues chats of agents who are gone.
- **Push:** BullMQ fan-out — one job per device with exponential-backoff retries; 404/410 subscriptions deleted; no push if the recipient is looking at the chat.
- **Observability:** pino structured logs (errors serialized), `/health/ready`, live metrics, Prometheus endpoint.
