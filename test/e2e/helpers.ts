/**
 * Tiny end-to-end harness: starts real server processes, logs in over HTTP,
 * connects real Socket.IO clients. Uses its own MongoDB database (dropped at
 * the end) and Redis logical DB 15 (flushed at the start), so it never
 * touches your development data.
 *
 *   TEST_MONGODB_URI (default mongodb://127.0.0.1:27017)
 *   TEST_REDIS_URL   (default redis://127.0.0.1:6379/15)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { io as connect, type Socket } from 'socket.io-client';

export const MONGODB_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
export const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';

let failures = 0;
export const check = (name: string, condition: boolean, details: unknown = '') => {
  if (!condition) failures += 1;
  console.log(condition ? '  PASS' : '  FAIL', name, condition ? '' : JSON.stringify(details)?.slice(0, 400));
};
export const failureCount = () => failures;
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TestContext {
  dbName: string;
  env: NodeJS.ProcessEnv;
  servers: ChildProcess[];
}

export const setup = async (name: string): Promise<TestContext> => {
  const dbName = `chat_e2e_${name}_${Date.now()}`;
  const redis = new Redis(REDIS_URL);
  await redis.flushdb(); // only DB 15 — resets rate limits/presence from earlier runs
  redis.disconnect();
  await mongoose.connect(MONGODB_URI, { dbName });
  return {
    dbName,
    servers: [],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      REDIS_URL,
      MONGODB_URI,
      MONGODB_DB_NAME: dbName,
      SESSION_SECRET: 'e2e-secret-'.padEnd(40, 'x'),
      LOG_LEVEL: 'error',
      CLIENT_ORIGIN: 'http://localhost:3000',
      ALLOW_INFRA_FAILURE: 'false',
    },
  };
};

export const teardown = async (ctx: TestContext) => {
  for (const server of ctx.servers) {
    try {
      process.kill(-server.pid!, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await sleep(1500);
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
};

/** Starts `src/main.ts` on a port and waits for /health. */
export const startServer = (ctx: TestContext, port: number) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/main.ts'], {
      env: { ...ctx.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so teardown can kill npx + node together
    });
    ctx.servers.push(child);
    child.stderr!.on('data', (data) => process.stderr.write(`[server ${port}] ${data}`));
    child.stdout!.on('data', (data) => {
      if (/"level":(50|60)/.test(String(data))) process.stderr.write(`[server ${port}] ${data}`);
    });
    const timeout = setTimeout(() => reject(new Error(`server on ${port} did not start`)), 30_000);
    const poll = setInterval(async () => {
      try {
        if ((await fetch(`http://localhost:${port}/health`)).ok) {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve();
        }
      } catch {
        /* not up yet */
      }
    }, 300);
  });

export interface Client {
  id: string;
  cookie: string;
  csrf: string;
  port: number;
  /** The anonymous session cookie used before logging in (to prove login rotates it). */
  preLoginCookie: string;
}

export const login = async (port: number, email: string, password: string): Promise<Client> => {
  const tokenResponse = await fetch(`http://localhost:${port}/api/v1/auth/csrf-token`);
  const firstCookie = tokenResponse.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = (await tokenResponse.json()) as { csrfToken: string };
  const response = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: firstCookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { user: { id: string }; csrfToken: string };
  if (!response.ok) throw new Error(`login ${email} failed: ${JSON.stringify(body)}`);
  return {
    id: body.user.id,
    cookie: response.headers.get('set-cookie')!.split(';')[0]!,
    csrf: body.csrfToken,
    port,
    preLoginCookie: firstCookie,
  };
};

export const api = async (client: Client, method: string, path: string, body?: unknown) => {
  const response = await fetch(`http://localhost:${client.port}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: client.cookie, 'x-csrf-token': client.csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (text ? JSON.parse(text) : null) as any };
};

export const connectSocket = (client: Client) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = connect(`http://localhost:${client.port}`, {
      extraHeaders: { cookie: client.cookie },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const emit = (socket: Socket, event: string, payload: unknown) => socket.timeout(5000).emitWithAck(event, payload) as Promise<any>;

/** Resolves with the next matching event, or null after `ms`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nextEvent = (socket: Socket, event: string, ms = 4000, filter: (payload: any) => boolean = () => true) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new Promise<any>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (payload: any) => {
      if (!filter(payload)) return;
      socket.off(event, handler);
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    socket.on(event, handler);
  });
