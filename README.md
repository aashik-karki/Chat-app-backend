# Chat Backend

Scalable Node.js, Express, TypeScript, Socket.IO, MongoDB, and Redis backend for a real-time support chat application.

## Quick start

Requirements: Node.js 22+, MongoDB, and Redis.

```bash
cp .env.example .env
# Set SESSION_SECRET to at least 32 random characters.
# For Atlas, set MONGODB_URI to your mongodb+srv connection string.
npm run dev
```

The service starts an Express and Socket.IO backend foundation. Add application routes as features are implemented.

For local startup without MongoDB or Redis, keep `ALLOW_INFRA_FAILURE=true`. Production must set it to `false` and provide managed infrastructure.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the TypeScript server with watch mode |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run tests |
| `npm run lint` | Run ESLint |
| `npm run seed:admin` | Create the initial administrator from environment variables |

## Authentication setup

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your untracked `.env`, then run `npm run seed:admin` once. The command is idempotent: it creates an approved `admin` only if that email does not already exist.

Public users register through `POST /api/v1/auth/register` and remain `pending` until an admin approves them. Obtain a CSRF token from `GET /api/v1/auth/csrf-token`, then send it in the `X-CSRF-Token` header for registration, login, logout, and approval requests. All cookie-authenticated requests must include credentials.

Available endpoints:

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/v1/auth/csrf-token` | Public |
| `POST` | `/api/v1/auth/register` | Public |
| `POST` | `/api/v1/auth/login` | Approved account |
| `POST` | `/api/v1/auth/logout` | Authenticated account |
| `GET` | `/api/v1/auth/me` | Authenticated account |
| `GET` | `/api/v1/admin/users?status=pending` | Admin |
| `PATCH` | `/api/v1/admin/users/:userId/approval` | Admin |

## Architecture

- Express owns versioned REST APIs, security middleware, validation, and OpenAPI documentation.
- Socket.IO owns real-time events and uses the Redis adapter for multi-instance broadcasts.
- MongoDB is the source of truth for messages, users, agents, assignments, and delivery/read state.
- Redis is used for cache-aside chat history, presence, distributed coordination, and BullMQ queues.
- Sessions use secure cookies; authorization is permission-based and does not require JWT.

## Feature branches

Implement features in this order:

1. `feature/message-model-and-history`
2. `feature/socket-rooms-and-messaging`
3. `feature/redis-chat-cache`
4. `feature/message-delivery-read-status`
5. `feature/agent-presence-and-routing`
6. `feature/session-auth-and-rbac`
7. `feature/push-notifications`
8. `feature/analytics-and-metrics`
9. `feature/versioned-api-documentation`

See [docs/features](docs/features/README.md) for the scope and acceptance criteria of each branch.
