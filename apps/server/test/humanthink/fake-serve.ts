import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

/**
 * humanthink 测试假件：内存路由表模拟 serve v2 端点族 + 可控 SSE 流 + 假 spawn。
 * 契约形态对齐探针实证（信封 {location?, data}、message 分页、permission 列表）。
 */

export type FakeMessage = {
  id: string;
  type: 'user' | 'assistant' | 'idle';
  time: { created: number };
  text?: string;
  content?: Array<{ type: string; text?: string }>;
};

export type FakePending = { id: string; sessionID: string; action: string; resources: string[]; save?: string[] };

export type FakeServe = {
  fetchImpl: typeof fetch;
  spawnImpl: (argv: string[], opts: { cwd: string; env: Record<string, string> }) => ChildProcess;
  /** 向全局事件流订阅者推送一帧（serve 信封形态） */
  pushEvent(envelope: Record<string, unknown>): void;
  /** 结束当前流（模拟断流——触发重连+对账） */
  endStream(): void;
  /** 会话存储（id → 存在性；删除后移除=serve 404） */
  sessions: Map<string, true>;
  /** message 端点数据（sessionId → 消息列表，order=asc 语义） */
  messages: Map<string, FakeMessage[]>;
  /** 会话级 pending 权限 */
  permissions: Map<string, FakePending[]>;
  /** 健康探测失败开关（true=网络错误） */
  failHealth: boolean;
  /** message 端点故障开关 */
  failMessages: boolean;
  /** 已收请求记录（断言用） */
  requests: Array<{ method: string; path: string; body?: unknown }>;
  /** reply 调用记录 */
  replies: Array<{ sessionID: string; requestID: string; decision: string; message?: string }>;
  /** spawn 计数与最后 env/argv */
  spawnCount: number;
  lastSpawnArgv: string[] | null;
  lastSpawnEnv: Record<string, string> | null;
  /** 假子进程（崩溃注入用） */
  child: FakeChildProcess;
};

export type FakeChildProcess = ChildProcess & EventEmitter;

export function createFakeServe(): FakeServe {
  const sessions = new Map<string, true>();
  const messages = new Map<string, FakeMessage[]>();
  const permissions = new Map<string, FakePending[]>();
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const replies: Array<{ sessionID: string; requestID: string; decision: string; message?: string }> = [];
  let sessionSeq = 0;
  let msgSeq = 0;
  const state: FakeServe = {
    sessions,
    messages,
    permissions,
    failHealth: false,
    failMessages: false,
    requests,
    replies,
    spawnCount: 0,
    lastSpawnArgv: null,
    lastSpawnEnv: null,
    child: null as unknown as FakeChildProcess,
    fetchImpl: null as unknown as typeof fetch,
    spawnImpl: null as unknown as FakeServe['spawnImpl'],
    pushEvent: () => {},
    endStream: () => {},
  };

  // —— 可控 SSE 流 ——
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streamClosed = false;
  const sseBody = (): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        streamClosed = false;
        c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","data":{}}\n\n'));
      },
      cancel() {
        controller = null;
        streamClosed = true;
      },
    });
  state.pushEvent = (envelope) => {
    if (controller != null && !streamClosed) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(envelope)}\n\n`));
    }
  };
  state.endStream = () => {
    if (controller != null && !streamClosed) {
      streamClosed = true;
      controller.close();
      controller = null;
    }
  };

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  state.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url ?? String(input));
    const path = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body != null ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, body });

    if (path === '/api/agent') {
      if (state.failHealth) throw new Error('模拟网络不可达');
      return json({ location: { directory: '/tmp' }, data: [] });
    }
    if (path === '/api/event' && method === 'GET') {
      return new Response(sseBody(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (path === '/api/session' && method === 'POST') {
      sessionSeq += 1;
      const id = `ses_test_${String(sessionSeq).padStart(4, '0')}`;
      sessions.set(id, true);
      messages.set(id, []);
      permissions.set(id, []);
      return json({ data: { id, projectID: 'proj_test', agent: 'atd-ht-atd', title: body?.title ?? null, location: { directory: body?.location?.directory ?? '/tmp' } } });
    }
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/api\/session\/([^/]+)\/prompt$/)) && method === 'POST') {
      if (!sessions.has(m[1])) return json({ error: { message: 'session not found' } }, 404);
      msgSeq += 1;
      const mid = `msg_test_${msgSeq}`;
      const list = messages.get(m[1]) ?? [];
      list.push({ id: mid, type: 'user', time: { created: Date.now() }, text: String(body?.text ?? '') });
      messages.set(m[1], list);
      return json({ data: { id: mid, sessionID: m[1], time: { created: Date.now() }, type: 'user', payload: { text: body?.text } } });
    }
    if ((m = path.match(/^\/api\/session\/([^/]+)\/interrupt$/)) && method === 'POST') {
      if (!sessions.has(m[1])) return json({ error: { message: 'session not found' } }, 404);
      return json({ interrupted: true });
    }
    if ((m = path.match(/^\/api\/session\/([^/]+)$/)) && method === 'DELETE') {
      if (!sessions.has(m[1])) return json({ error: { message: 'session not found' } }, 404);
      sessions.delete(m[1]);
      return new Response(null, { status: 204 });
    }
    if ((m = path.match(/^\/api\/session\/([^/]+)\/permission$/)) && method === 'GET') {
      if (!sessions.has(m[1])) return json({ error: { message: 'session not found' } }, 404);
      return json({ data: (permissions.get(m[1]) ?? []).map((p) => ({ ...p, source: { type: 'tool' } })) });
    }
    if (method === 'POST') {
      const reply = path.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/);
      if (reply != null) {
        if (!sessions.has(reply[1])) return json({ error: { message: 'session not found' } }, 404);
        const pending = permissions.get(reply[1]) ?? [];
        permissions.set(reply[1], pending.filter((p) => p.id !== reply[2]));
        replies.push({ sessionID: reply[1], requestID: reply[2], decision: String(body?.decision), message: body?.message });
        return json({});
      }
    }
    if ((m = path.match(/^\/api\/session\/([^/]+)\/message$/)) && method === 'GET') {
      if (state.failMessages) throw new Error('模拟 message 端点不可达');
      if (!sessions.has(m[1])) return json({ error: { message: 'session not found' } }, 404);
      const order = url.searchParams.get('order') === 'asc';
      const list = messages.get(m[1]) ?? [];
      return json({ data: order ? [...list] : [...list].reverse(), cursor: { previous: null, next: null } });
    }
    if (method === 'GET') {
      const detail = path.match(/^\/api\/session\/([^/]+)\/message\/([^/]+)$/);
      if (detail != null) {
        const msg = (messages.get(detail[1]) ?? []).find((x) => x.id === detail[2]);
        if (msg == null) return json({ error: { message: 'message not found' } }, 404);
        return json({ data: msg });
      }
    }
    return json({ error: { message: `unmocked ${method} ${path}` } }, 404);
  }) as typeof fetch;

  // —— 假子进程（pid 存在；崩溃注入经 child.emit('exit')） ——
  const child = new EventEmitter() as FakeChildProcess;
  Object.assign(child, {
    pid: 424242,
    exitCode: null as number | null,
    kill: () => true,
    killed: false,
    stdout: null,
    stderr: null,
    stdin: null,
    stdio: [null, null, null],
  });
  state.child = child;
  state.spawnImpl = (argv, opts) => {
    state.spawnCount += 1;
    state.lastSpawnArgv = argv;
    state.lastSpawnEnv = opts.env;
    return child;
  };

  return state;
}
