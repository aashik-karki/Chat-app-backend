import { z } from 'zod';
import { loginDto } from '../modules/auth/dto/login.dto.js';
import { registerDto } from '../modules/auth/dto/register.dto.js';
import { agentIdParamsDto } from '../modules/agents/dto/agent-id-params.dto.js';
import { setAvailabilityDto } from '../modules/agents/dto/set-availability.dto.js';
import { transferConversationDto } from '../modules/agents/dto/transfer-conversation.dto.js';
import { updateAgentSettingsDto } from '../modules/agents/dto/update-agent-settings.dto.js';
import { conversationIdParamsDto } from '../modules/chat/dto/conversation-id-params.dto.js';
import { exportQueryDto } from '../modules/chat/dto/export-query.dto.js';
import { historyQueryDto } from '../modules/chat/dto/history-query.dto.js';
import { updateTopicDto } from '../modules/chat/dto/update-topic.dto.js';
import { createSubscriptionDto } from '../modules/push/dto/create-subscription.dto.js';
import { deleteSubscriptionDto } from '../modules/push/dto/delete-subscription.dto.js';
import { listUsersQueryDto } from '../modules/users/dto/list-users-query.dto.js';
import { updateApprovalDto } from '../modules/users/dto/update-approval.dto.js';
import { updateRoleDto } from '../modules/users/dto/update-role.dto.js';
import { userIdParamsDto } from '../modules/users/dto/user-id-params.dto.js';

/**
 * OpenAPI 3.1 document for the REST API. Request schemas are generated from
 * the SAME zod DTOs the validate() pipe uses, so the docs can't drift from
 * what the server actually accepts. Served at /api/docs (Swagger UI) and
 * /api/docs/openapi.json. Socket.IO events are documented in docs/realtime-events.md.
 */
type Json = Record<string, unknown>;

const schemaOf = (dto: z.ZodType): Json => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(dto, { io: 'input', unrepresentable: 'any' }) as Json;
  return schema;
};

const parametersOf = (dto: z.ZodObject, location: 'path' | 'query') =>
  Object.entries(dto.shape).map(([name, fieldSchema]) => ({
    name,
    in: location,
    required: location === 'path' || !(fieldSchema as z.ZodType).safeParse(undefined).success,
    schema: schemaOf(fieldSchema as z.ZodType),
  }));

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

interface OperationSpec {
  tag: string;
  summary: string;
  description?: string;
  /** default true: needs the session cookie */
  auth?: boolean;
  /** default: true for POST/PATCH/DELETE */
  csrf?: boolean;
  permission?: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  ok?: { status?: number; description: string; example?: unknown };
}

const operation = (method: string, spec: OperationSpec): Json => {
  const auth = spec.auth ?? true;
  const csrf = spec.csrf ?? ['post', 'patch', 'delete'].includes(method);
  const okStatus = String(spec.ok?.status ?? 200);
  const security: Json[] = [];
  if (auth && csrf) security.push({ sessionCookie: [], csrfToken: [] });
  else if (auth) security.push({ sessionCookie: [] });
  else if (csrf) security.push({ csrfToken: [] });

  return {
    tags: [spec.tag],
    summary: spec.summary,
    ...(spec.description || spec.permission
      ? { description: [spec.description, spec.permission ? `Requires permission \`${spec.permission}\`.` : ''].filter(Boolean).join('\n\n') }
      : {}),
    ...(security.length ? { security } : { security: [] }),
    parameters: [
      ...(spec.params ? parametersOf(spec.params, 'path') : []),
      ...(spec.query ? parametersOf(spec.query, 'query') : []),
    ],
    ...(spec.body ? { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(spec.body) } } } } : {}),
    responses: {
      [okStatus]: {
        description: spec.ok?.description ?? 'OK',
        ...(spec.ok?.example !== undefined ? { content: { 'application/json': { example: spec.ok.example } } } : {}),
      },
      ...(spec.body || spec.query || spec.params ? { 400: errorResponse('Validation error (VALIDATION_ERROR)') } : {}),
      ...(auth ? { 401: errorResponse('Not logged in (AUTHENTICATION_REQUIRED)') } : {}),
      ...(csrf ? { 403: errorResponse('Missing/invalid CSRF token, or insufficient permissions') } : spec.permission ? { 403: errorResponse('Insufficient permissions') } : {}),
      429: errorResponse('Rate limited (TOO_MANY_REQUESTS)'),
    },
  };
};

const exampleUser = { id: '66f1c0d2a1b2c3d4e5f60718', name: 'Sita', email: 'sita@example.com', role: 'user', status: 'approved' };

export const buildOpenApiDocument = (): Json => ({
  openapi: '3.1.0',
  info: {
    title: 'Support Chat API',
    version: '1.0.0',
    description: [
      'REST API for the real-time support chat. Real-time features (messages, typing, presence, read receipts, agent status, metrics) use **Socket.IO** on the same host — see `docs/realtime-events.md`.',
      '',
      '**Auth:** session cookie (`chat.sid`, HttpOnly). Call `GET /auth/csrf-token` first, then send `X-CSRF-Token` on every POST/PATCH/DELETE. After login use the new `csrfToken` from the login response. Browsers must send requests with `credentials: "include"`.',
      '',
      '**Errors** always look like `{ "error": { "code": "...", "message": "..." } }`.',
      '',
      '**Versioning:** every route lives under `/api/v1`; breaking changes will ship as `/api/v2` alongside it.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Auth' },
    { name: 'Admin: users' },
    { name: 'Conversations' },
    { name: 'Agents' },
    { name: 'Push notifications' },
    { name: 'Metrics' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'chat.sid' },
      csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
          },
        },
      },
    },
  },
  paths: {
    '/auth/csrf-token': { get: operation('get', { tag: 'Auth', summary: 'Get a CSRF token (also starts an anonymous session)', auth: false, ok: { description: 'Token', example: { csrfToken: 'a1b2…' } } }) },
    '/auth/register': { post: operation('post', { tag: 'Auth', summary: 'Register (account starts as pending until an admin approves)', auth: false, body: registerDto, ok: { status: 201, description: 'Created', example: { user: { ...exampleUser, status: 'pending' } } } }) },
    '/auth/login': { post: operation('post', { tag: 'Auth', summary: 'Log in', description: 'Rotates the session id (prevents session fixation) and returns a NEW csrfToken — use it from now on.', auth: false, body: loginDto, ok: { description: 'Logged in', example: { user: exampleUser, csrfToken: 'c3d4…' } } }) },
    '/auth/logout': { post: operation('post', { tag: 'Auth', summary: 'Log out', ok: { status: 204, description: 'Logged out' } }) },
    '/auth/me': { get: operation('get', { tag: 'Auth', summary: 'Current user', ok: { description: 'User', example: { user: exampleUser } } }) },

    '/admin/users': { get: operation('get', { tag: 'Admin: users', summary: 'List users by status/role', permission: 'user:approve', query: listUsersQueryDto }) },
    '/admin/users/summary': { get: operation('get', { tag: 'Admin: users', summary: 'Counts by status + latest 200 customers', permission: 'user:approve' }) },
    '/admin/users/{userId}/approval': { patch: operation('patch', { tag: 'Admin: users', summary: 'Approve or reject a pending user', permission: 'user:approve', params: userIdParamsDto, body: updateApprovalDto }) },
    '/admin/users/{userId}/role': { patch: operation('patch', { tag: 'Admin: users', summary: 'Promote a user to agent (or demote)', permission: 'agent:manage', params: userIdParamsDto, body: updateRoleDto }) },

    '/conversations': { get: operation('get', { tag: 'Conversations', summary: 'List conversations (customer: own; staff: all) with unread counts' }) },
    '/conversations/mine': { get: operation('get', { tag: 'Conversations', summary: "The customer's own support thread (created on first use)", permission: 'chat:read_own' }) },
    '/conversations/mine/topic': { patch: operation('patch', { tag: 'Conversations', summary: 'Set what the customer needs help with (skill-based routing)', permission: 'chat:send_own', body: updateTopicDto }) },
    '/conversations/{conversationId}': { get: operation('get', { tag: 'Conversations', summary: 'One conversation', params: conversationIdParamsDto }) },
    '/conversations/{conversationId}/messages': {
      get: operation('get', {
        tag: 'Conversations',
        summary: 'Message history (cursor pagination, oldest → newest in each page)',
        description: 'First page is served from the Redis cache. Pass `nextCursor` from the previous page to load older messages.',
        params: conversationIdParamsDto,
        query: historyQueryDto,
        ok: { description: 'Page', example: { data: [], nextCursor: null } },
      }),
    },
    '/conversations/{conversationId}/messages/export': { get: operation('get', { tag: 'Conversations', summary: 'Download the whole history as JSON or CSV (streamed)', permission: 'chat:export', params: conversationIdParamsDto, query: exportQueryDto, ok: { description: 'File download (Content-Disposition: attachment)' } }) },

    '/agents': { get: operation('get', { tag: 'Agents', summary: 'All agents with live status and load', permission: 'agent:view' }) },
    '/agents/queue': { get: operation('get', { tag: 'Agents', summary: 'Conversations waiting for an agent, oldest first', permission: 'agent:view' }) },
    '/agents/me/status': { patch: operation('patch', { tag: 'Agents', summary: 'Set my availability (online / busy / offline)', permission: 'agent:set_status', body: setAvailabilityDto }) },
    '/agents/{agentId}/settings': { patch: operation('patch', { tag: 'Agents', summary: 'Set an agent\'s skills and max concurrent chats', permission: 'agent:manage', params: agentIdParamsDto, body: updateAgentSettingsDto }) },
    '/agents/conversations/{conversationId}/claim': { post: operation('post', { tag: 'Agents', summary: 'Take an unassigned conversation (409 if another agent got it first)', permission: 'chat:reply', params: conversationIdParamsDto }) },
    '/agents/conversations/{conversationId}/transfer': { post: operation('post', { tag: 'Agents', summary: 'Move a conversation to another agent, or back to the queue (agentId: null)', permission: 'agent:assign', params: conversationIdParamsDto, body: transferConversationDto }) },
    '/agents/conversations/{conversationId}/close': { post: operation('post', { tag: 'Agents', summary: 'Close a conversation (assigned agent or admin)', permission: 'chat:reply', params: conversationIdParamsDto, ok: { status: 204, description: 'Closed' } }) },

    '/push/public-key': { get: operation('get', { tag: 'Push notifications', summary: 'VAPID public key for pushManager.subscribe()', ok: { description: 'Key', example: { publicKey: 'BEl6…' } } }) },
    '/push/subscriptions': {
      post: operation('post', { tag: 'Push notifications', summary: 'Save this browser\'s push subscription (PushSubscription.toJSON())', body: createSubscriptionDto, ok: { status: 201, description: 'Saved' } }),
      delete: operation('delete', { tag: 'Push notifications', summary: 'Remove this browser\'s push subscription', body: deleteSubscriptionDto, ok: { status: 204, description: 'Removed' } }),
    },

    '/metrics/overview': { get: operation('get', { tag: 'Metrics', summary: 'Live metrics snapshot + messages per minute (last 60 min)', permission: 'metrics:view', description: 'Live updates: socket event `metrics:subscribe`, then `metrics:update` every 5s.' }) },
  },
});
