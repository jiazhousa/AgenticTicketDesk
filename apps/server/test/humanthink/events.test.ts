import { describe, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '../../src/db/client.js';
import { humanthinkEvents, humanthinkSessions } from '../../src/db/schema.js';
import { EventHub, mapToUnifiedEvent, toHumanThinkEvent, type SseFrame } from '../../src/humanthink/events.js';
import { SessionFacade } from '../../src/humanthink/session-facade.js';
import type { ServeHandle } from '../../src/humanthink/serve-manager.js';
import { createFakeServe, type FakeServe } from './fake-serve.js';

/** 内存库 + 会话行 + EventHub（经 fake serve 全链） */
function setup(fake: FakeServe) {
  const db = createDatabase(':memory:');
  db.insert(humanthinkSessions)
    .values({ id: 'ses_t1', workerId: 'oc', workspaceId: 'atd', directory: '/w/atd', title: 't', createdAt: 1, lastActiveAt: 1, deletedAt: null })
    .run();
  // fake serve 侧同步登记（permission/message 端点按 sessions 表判 404）
  fake.sessions.set('ses_t1', true);
  fake.messages.set('ses_t1', []);
  fake.permissions.set('ses_t1', []);
  const handle: ServeHandle = { baseUrl: 'http://fake', authHeader: 'Basic x', port: 1 };
  const facade = new SessionFacade({ serve: () => handle, fetchImpl: fake.fetchImpl });
  const logs: string[] = [];
  const hub = new EventHub({ db, serve: () => handle, facade, fetchImpl: fake.fetchImpl, now: () => 1000, log: (m) => logs.push(m) });
  return { db, hub, logs };
}

const SID = 'ses_t1';

/** serve 信封便捷构造 */
const env = (type: string, data: Record<string, unknown>, durable?: number) => ({
  type,
  data: { sessionID: SID, ...data },
  ...(durable != null ? { durable: { aggregateID: SID, seq: durable, version: 1 } } : {}),
});

describe('serve 事件 → HumanThinkEvent 映射【S2b1】', () => {
  test('tool.input.started 供给工具名，tool.* 载荷补全', () => {
    const names = new Map<string, string>();
    expect(toHumanThinkEvent(env('session.tool.input.started', { id: 'call_1', name: 'read' }), names)).toBeNull();
    expect(names.get('call_1')).toBe('read');
    const called = toHumanThinkEvent(env('session.tool.called', { id: 'call_1', input: { path: '/x' } }), names)!;
    expect(called).toEqual({ type: 'tool.called', callID: 'call_1', tool: 'read', input: { path: '/x' } });
  });

  test('未知 callID 工具名回退 unknown；失败事件携带 error', () => {
    const failed = toHumanThinkEvent(env('session.tool.failed', { id: 'call_x', error: { type: 'permission.rejected', message: 'Permission denied: external_directory' } }), new Map())!;
    expect(failed).toEqual({
      type: 'tool.failed',
      callID: 'call_x',
      tool: 'unknown',
      error: { type: 'permission.rejected', message: 'Permission denied: external_directory' },
    });
  });

  test('permission.replied → permission_resolved（requestID+decision）', () => {
    const ev = toHumanThinkEvent({ type: 'permission.replied', data: { sessionID: SID, requestID: 'per_1', reply: 'once' } }, new Map())!;
    expect(ev).toEqual({ type: 'permission_resolved', requestID: 'per_1', decision: 'once' });
  });

  test('无关事件（usage.updated 等）返回 null', () => {
    expect(toHumanThinkEvent(env('session.usage.updated', { cost: 0 }), new Map())).toBeNull();
  });
});

describe('HumanThinkEvent → UnifiedEvent 映射（技术方案 6）【S2b1】', () => {
  test('step→turn、text.ended→text-end、tool 三型、reasoning 两相', () => {
    expect(mapToUnifiedEvent({ type: 'step.started' })).toEqual({ type: 'turn-start' });
    expect(mapToUnifiedEvent({ type: 'step.ended', finish: 'stop' })).toEqual({ type: 'turn-end', reason: 'stop' });
    expect(mapToUnifiedEvent({ type: 'text.ended', text: '全文' })).toEqual({ type: 'text-end' });
    expect(mapToUnifiedEvent({ type: 'tool.called', callID: 'c', tool: 'bash' })).toEqual({ type: 'tool-call', tool: 'bash' });
    expect(mapToUnifiedEvent({ type: 'tool.success', callID: 'c', tool: 'bash' })).toEqual({ type: 'tool-result', tool: 'bash', errored: false });
    expect(mapToUnifiedEvent({ type: 'reasoning.ended', text: '思考' })).toEqual({ type: 'reasoning', text: '思考', phase: 'ended' });
    expect(mapToUnifiedEvent({ type: 'permission_request', requestID: 'p', action: 'shell', resources: ['echo'] , status: 'pending' })).toEqual({
      type: 'permission_request',
      requestID: 'p',
      action: 'shell',
      resources: ['echo'],
      status: 'pending',
    });
    expect(mapToUnifiedEvent({ type: 'message', messageId: 'm', role: 'user', text: 'x' })).toBeNull();
  });
});

describe('镜像落库与幂等【S2b1 技术方案 4】', () => {
  test('durable 子集落库 (session_id, serve_seq) 幂等去重，本地 seq 递增不跳号', async () => {
    const fake = createFakeServe();
    const { db, hub } = setup(fake);
    hub.start();
    await vi.waitFor(() => expect(fake.requests.some((r) => r.path === '/api/event')).toBe(true));
    fake.pushEvent(env('session.text.ended', { assistantMessageID: 'msg_1', text: '第一段', ordinal: 0 }, 11));
    fake.pushEvent(env('session.text.ended', { assistantMessageID: 'msg_1', text: '第一段', ordinal: 0 }, 11)); // 重复投递
    fake.pushEvent(env('session.step.started', { assistantMessageID: 'msg_1' }, 12));
    await vi.waitFor(() => expect(rows(db, SID)).toHaveLength(2));
    const rs = rows(db, SID);
    expect(rs.map((r) => [r.serveSeq, r.seq, r.type])).toEqual([[11, 1, 'text.ended'], [12, 2, 'step.started']]);
    hub.stop();
  });

  test('信封缺失：跳过落库仅转发+warn（不做退化双键）', async () => {
    const fake = createFakeServe();
    const { db, hub, logs } = setup(fake);
    const frames: SseFrame[] = [];
    hub.start();
    await vi.waitFor(() => expect(fake.requests.some((r) => r.path === '/api/event')).toBe(true));
    hub.attach(SID, 0, (f) => frames.push(f));
    fake.pushEvent(env('session.text.ended', { assistantMessageID: 'm', text: '无信封' })); // 无 durable
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(rows(db, SID)).toHaveLength(0);
    expect(logs.some((l) => l.includes('缺失 durable.seq'))).toBe(true);
    // 转发帧无 seq（delta 语义）
    expect(frames[frames.length - 1].seq).toBeUndefined();
    hub.stop();
  });

  test('delta 仅转发不落库；外来会话（未注册）事件丢弃', async () => {
    const fake = createFakeServe();
    const { db, hub } = setup(fake);
    const frames: SseFrame[] = [];
    hub.start();
    await vi.waitFor(() => expect(fake.requests.some((r) => r.path === '/api/event')).toBe(true));
    hub.attach(SID, 0, (f) => frames.push(f));
    fake.pushEvent(env('session.text.delta', { text: '逐字' }));
    fake.pushEvent({ type: 'session.text.delta', data: { sessionID: 'ses_foreign', text: '外来' } });
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(frames[0]).toEqual({ event: { type: 'text.delta', text: '逐字' } });
    expect(rows(db, SID)).toHaveLength(0);
    hub.stop();
  });

  test('permission.asked/replied 落 ATD 自有行（requestID 幂等；裁决翻转 request 行 status）', async () => {
    const fake = createFakeServe();
    const { db, hub } = setup(fake);
    hub.start();
    await vi.waitFor(() => expect(fake.requests.some((r) => r.path === '/api/event')).toBe(true));
    fake.pushEvent({ type: 'permission.asked', data: { sessionID: SID, id: 'per_1', action: 'shell', resources: ['echo hi'], save: ['echo *'] } });
    fake.pushEvent({ type: 'permission.asked', data: { sessionID: SID, id: 'per_1', action: 'shell', resources: ['echo hi'] } }); // 重复
    await vi.waitFor(() => expect(rows(db, SID, 'permission_request')).toHaveLength(1));
    const reqBefore = JSON.parse(rows(db, SID, 'permission_request')[0].payload);
    expect(reqBefore).toMatchObject({ requestID: 'per_1', action: 'shell', status: 'pending' });
    fake.pushEvent({ type: 'permission.replied', data: { sessionID: SID, requestID: 'per_1', reply: 'once' } });
    fake.pushEvent({ type: 'permission.replied', data: { sessionID: SID, requestID: 'per_1', reply: 'once' } }); // 重复
    await vi.waitFor(() => expect(rows(db, SID, 'permission_resolved')).toHaveLength(1));
    const reqAfter = JSON.parse(rows(db, SID, 'permission_request')[0].payload);
    expect(reqAfter.status).toBe('resolved'); // 待审列表只看 pending——裁决后不再出现
    const res = JSON.parse(rows(db, SID, 'permission_resolved')[0].payload);
    expect(res).toMatchObject({ requestID: 'per_1', decision: 'once' });
    hub.stop();
  });
});

describe('message 对账（恢复补齐，权威兜底）【S2b1】', () => {
  test('断流重连后对账补 user/assistant 文本行；重复对账幂等；已镜像 assistant 跳过', async () => {
    const fake = createFakeServe();
    const { db, hub } = setup(fake);
    // serve 侧已有完整历史（断流窗口前完成）
    fake.messages.set(SID, [
      { id: 'msg_u1', type: 'user', time: { created: 1 }, text: '问个问题' },
      { id: 'msg_a1', type: 'assistant', time: { created: 2 }, content: [{ type: 'reasoning', text: '想' }, { type: 'text', text: '答一段' }] },
      { id: 'msg_i1', type: 'idle', time: { created: 3 } },
    ]);
    hub.start();
    // 流建立即触发对账
    await vi.waitFor(() => expect(rows(db, SID, 'message')).toHaveLength(2));
    const ms = rows(db, SID, 'message');
    expect(JSON.parse(ms[0].payload)).toEqual({ type: 'message', messageId: 'msg_u1', role: 'user', text: '问个问题' });
    expect(JSON.parse(ms[1].payload)).toEqual({ type: 'message', messageId: 'msg_a1', role: 'assistant', text: '答一段' });
    // idle 杂型不落
    expect(rows(db, SID).length).toBe(2);
    // 断流→重连→再对账：先查后插幂等
    fake.endStream();
    await vi.waitFor(() => expect(fake.requests.filter((r) => r.path === '/api/event').length).toBe(2));
    await vi.waitFor(() => expect(fake.requests.filter((r) => r.path.includes('/message')).length).toBeGreaterThanOrEqual(2));
    expect(rows(db, SID, 'message')).toHaveLength(2);
    hub.stop();
  });

  test('assistant 全文已有镜像行（text.ended messageID 命中）→ 对账不重复落', async () => {
    const fake = createFakeServe();
    const { db, hub } = setup(fake);
    fake.messages.set(SID, [{ id: 'msg_a1', type: 'assistant', time: { created: 2 }, content: [{ type: 'text', text: '答一段' }] }]);
    // 镜像行先于对账存在（流内 text.ended 已落库的既成事实）
    db.insert(humanthinkEvents).values({ sessionId: SID, serveSeq: 5, seq: 1, type: 'text.ended', payload: JSON.stringify({ type: 'text.ended', text: '答一段', messageID: 'msg_a1' }), createdAt: 1 }).run();
    hub.start();
    await vi.waitFor(() => expect(fake.requests.some((r) => r.path.includes('/message'))).toBe(true));
    fake.endStream(); // 触发二次对账
    await vi.waitFor(() => expect(fake.requests.filter((r) => r.path.includes('/message')).length).toBe(2));
    expect(rows(db, SID, 'message')).toHaveLength(0);
    hub.stop();
  });
});

describe('SSE attach：镜像回放 + live 合流【S2b1】', () => {
  test('after=0 回放全部镜像行；after=N 仅回放 seq>N；live 帧实时直推', async () => {
    const fake = createFakeServe();
    const { db, hub } = setup(fake);
    db.insert(humanthinkEvents).values([
      { sessionId: SID, serveSeq: 11, seq: 1, type: 'text.ended', payload: JSON.stringify({ type: 'text.ended', text: 'a' }), createdAt: 1 },
      { sessionId: SID, serveSeq: 12, seq: 2, type: 'step.ended', payload: JSON.stringify({ type: 'step.ended' }), createdAt: 1 },
    ]).run();
    hub.start();
    await vi.waitFor(() => expect(fake.requests.some((r) => r.path === '/api/event')).toBe(true));
    const all: SseFrame[] = [];
    hub.attach(SID, 0, (f) => all.push(f));
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual({ seq: 1, event: { type: 'text.ended', text: 'a' } });
    const tail: SseFrame[] = [];
    hub.attach(SID, 1, (f) => tail.push(f));
    expect(tail).toHaveLength(1);
    expect(tail[0].seq).toBe(2);
    fake.pushEvent(env('session.text.delta', { text: 'live' }));
    await vi.waitFor(() => expect(all.some((f) => f.event.type === 'text.delta')).toBe(true));
    hub.stop();
  });
});

describe('审批轮询兜底【S2b1 技术方案 5】', () => {
  test('attach 中的会话 2s 轮询发现新 pending；消失的 pending 补 resolved 行', async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeServe();
      const { db, hub } = setup(fake);
      hub.start();
      hub.attach(SID, 0, () => {});
      // serve 侧出现 pending（流断场景——不 push 事件）
      fake.permissions.set(SID, [{ id: 'per_p1', sessionID: SID, action: 'shell', resources: ['rm -rf'] }]);
      await vi.advanceTimersByTimeAsync(2100);
      expect(rows(db, SID, 'permission_request')).toHaveLength(1);
      // serve 侧被外部裁决（pending 消失）——轮询补 resolved
      fake.permissions.set(SID, []);
      await vi.advanceTimersByTimeAsync(2100);
      expect(rows(db, SID, 'permission_resolved')).toHaveLength(1);
      hub.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** 查询辅助：会话全部行 / 按 type 过滤 */
function rows(db: ReturnType<typeof createDatabase>, sessionId: string, type?: string) {
  const all = db
    .select()
    .from(humanthinkEvents)
    .where(type != null ? and(eq(humanthinkEvents.sessionId, sessionId), eq(humanthinkEvents.type, type)) : eq(humanthinkEvents.sessionId, sessionId))
    .all();
  return all.sort((a, b) => a.seq - b.seq);
}
