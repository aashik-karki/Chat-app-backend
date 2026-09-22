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
