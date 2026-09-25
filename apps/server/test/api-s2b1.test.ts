import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadRegistry } from '@atd/worker-core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import { buildWorkspaceFixture, makeTempRepo, createTestContext } from './helpers.js';
import { createFakeServe, type FakeServe } from './humanthink/fake-serve.js';

/**
 * S2b1 humanthink 9 端点契约 + 四错误码 + degraded。
 * 经 buildServer 全装配（enabled:true + 假 serve 注入），HTTP inject 驱动。
 */

type HtContext = {
  app: FastifyInstance;
  fake: FakeServe;
  start: () => Promise<void>;
  primaryPath: string;
  readablePath: string;
};

/** interactive worker profile（opencode serve 形态）+ atd workspace（主仓+可读仓） */
function createHtContext(opts: { taskOnlyWorker?: boolean } = {}): HtContext {
  const db = createDatabase(':memory:');
  const workersDir = mkdtempSync(path.join(tmpdir(), 'htwk-'));
  writeFileSync(
    path.join(workersDir, 'oc.yaml'),
    opts.taskOnlyWorker
      ? ['id: oc', 'name: OpenCode', 'protocol: spawn-cli', 'capabilities: [task]', 'command: echo run {{prompt}}'].join('\n')
      : [
          'id: oc',
          'name: OpenCode',
          'protocol: spawn-cli',
          'capabilities: [task, interactive]',
          'command: echo run {{prompt}}',
          'timeoutMin: 5',
          'interactive:',
          '  serveCommand: opencode serve --port {port}',
        ].join('\n'),
  );
  // 附带一个 task-only worker（「注册了但无 interactive 能力」拒绝路径）
  writeFileSync(
    path.join(workersDir, 'plain.yaml'),
    ['id: plain', 'name: Plain', 'protocol: spawn-cli', 'capabilities: [task]', 'command: echo x {{prompt}}'].join('\n'),
  );
  const registry = loadRegistry(workersDir);
  const primaryPath = makeTempRepo();
  const readablePath = makeTempRepo();
  const { registry: workspaces } = buildWorkspaceFixture([
    {
      id: 'atd',
      name: 'ATD',
      repos: [
        { id: 'atd', path: primaryPath, role: 'primary' },
        { id: 'docs', path: readablePath, role: 'readable' },
      ],
    },
  ]);
  const fake = createFakeServe();
  const built = buildServer(db, {
    config: {
      dataDir: mkdtempSync(path.join(tmpdir(), 'htdd-')),
      defaultTimeoutMin: 5,
      maxConcurrentPerRepo: 2,
      maxRetries: 3,
      retryBackoffSec: 60,
      humanthinkPort: 4980,
    },
    registry,
    workspaces,
    autoDispatch: false,
    worktreeGuard: 'skip',
    humanthink: {
      enabled: true,
      fetchImpl: fake.fetchImpl,
      spawnImpl: fake.spawnImpl,
      restartBackoffMs: [5, 5, 5],
      healthTimeoutMs: 50,
    },
  });
  return { app: built.app, fake, start: built.humanthinkStart!, primaryPath, readablePath };
}

const errBody = (res: { statusCode: number; json(): Promise<unknown> }) => res.json() as Promise<{ error: { code: string } }>;

describe('humanthink 9 端点契约【S2b1】', () => {
  test('旁路位缺省关闭：既有装配下路由不挂载（404 NOT_FOUND）', async () => {
    const ctx = createTestContext();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  test('建会话：透传 serve（agent=atd-ht-{ws}，directory=主仓）+ 本地落行', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/humanthink/sessions',
      payload: { workerId: 'oc', workspaceId: 'atd', title: '聊需求' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { session: { id: string; workerId: string; workspaceId: string; directory: string; title: string; deletedAt: null } };
    expect(body.session).toMatchObject({ id: 'ses_test_0001', workerId: 'oc', workspaceId: 'atd', directory: ctx.primaryPath, title: '聊需求', deletedAt: null });
    const create = ctx.fake.requests.find((r) => r.method === 'POST' && r.path === '/api/session');
    expect(create?.body).toMatchObject({ agent: 'atd-ht-atd', location: { directory: ctx.primaryPath }, title: '聊需求' });
    await ctx.app.close();
  });

  test('建会话校验：worker 未注册 / 无 interactive 能力 / workspace 未声明 / body 缺字段', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const r1 = await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'ghost', workspaceId: 'atd' } });
    expect(r1.statusCode).toBe(422);
    expect((await errBody(r1)).error.code).toBe('WORKER_UNKNOWN');
    // 注册了但 task-only（无 interactive 能力）——同样 WORKER_UNKNOWN，下拉不列出该 worker
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'plain', workspaceId: 'atd' } });
    expect(r2.statusCode).toBe(422);
    expect((await errBody(r2)).error.code).toBe('WORKER_UNKNOWN');
    const r3 = await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'nope' } });
    expect((await errBody(r3)).error.code).toBe('WORKSPACE_UNKNOWN');
    const r4 = await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc' } });
    expect(r4.statusCode).toBe(400);
    expect((await errBody(r4)).error.code).toBe('VALIDATION');
    await ctx.app.close();
  });

  test('列表：排除已删 + workspace 过滤 + q（标题/文本 payload）搜索', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const s1 = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd', title: '需求讨论' } })).json() as { session: { id: string } };
    const s2 = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd', title: '杂谈' } })).json() as { session: { id: string } };
    // s2 发消息后删除
    await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s2.session.id}/prompt`, payload: { text: '关键词紫' } });
    await ctx.app.inject({ method: 'DELETE', url: `/api/humanthink/sessions/${s2.session.id}` });
    const all = (await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions' })).json() as { items: Array<{ id: string }> };
    expect(all.items.map((i) => i.id)).toEqual([s1.session.id]);
    const byWs = (await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions?workspaceId=atd' })).json() as { items: unknown[] };
    expect(byWs.items).toHaveLength(1);
    const byTitle = (await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions?q=需求' })).json() as { items: unknown[] };
    expect(byTitle.items).toHaveLength(1);
    // 已删会话不出列表（即使文本命中）
    const byGone = (await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions?q=紫' })).json() as { items: unknown[] };
    expect(byGone.items).toHaveLength(0);
    // 已删枚举入口（块间对账：web「已删除」查看入口依赖 deleted=1）
    const deletedOnly = (await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions?deleted=1' })).json() as { items: Array<{ id: string; deletedAt: number | null }> };
    expect(deletedOnly.items.map((i) => i.id)).toEqual([s2.session.id]);
    expect(deletedOnly.items[0]!.deletedAt).not.toBeNull();
    await ctx.app.close();
  });

  test('workers 透出聊天可用性 available（块间对账：web 建会话弹窗过滤依据）', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/workers' });
    const workers = res.json() as Array<{ id: string; capabilities: string[]; available?: boolean }>;
    const oc = workers.find((w) => w.id === 'oc');
    expect(oc?.capabilities).toContain('interactive');
    expect(oc?.available).toBe(true);
    await ctx.app.close();
  });

  test('已删三分语义：详情可查（内嵌历史+deletedAt）；prompt/interrupt/delete/reply/SSE 一律 422', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const s = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd', title: 't' } })).json() as { session: { id: string } };
    await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s.session.id}/prompt`, payload: { text: '最后一句' } });
    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/humanthink/sessions/${s.session.id}` });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { ok: boolean }).ok).toBe(true);
    // 详情：历史仍可查
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/humanthink/sessions/${s.session.id}` });
    expect(detail.statusCode).toBe(200);
    const d = detail.json() as { session: { deletedAt: number | null }; events: Array<{ type: string; event: { role?: string } }> };
    expect(d.session.deletedAt).not.toBeNull();
    expect(d.events.some((e) => e.type === 'message' && e.event.role === 'user')).toBe(true);
    // 操作端点全部 SESSION_TERMINATED
    for (const [method, url] of [
      ['POST', `/api/humanthink/sessions/${s.session.id}/prompt`],
      ['POST', `/api/humanthink/sessions/${s.session.id}/interrupt`],
      ['DELETE', `/api/humanthink/sessions/${s.session.id}`],
      ['POST', `/api/humanthink/sessions/${s.session.id}/permission/per_x/reply`],
      ['GET', `/api/humanthink/sessions/${s.session.id}/events`],
    ] as const) {
      const res = await ctx.app.inject({ method, url, payload: method === 'POST' ? (url.includes('reply') ? { decision: 'once' } : { text: 'x' }) : undefined });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe('SESSION_TERMINATED');
    }
    await ctx.app.close();
  });

  test('prompt/interrupt 透传 + 用户消息即时落历史（不丢话双保险）', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const s = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd' } })).json() as { session: { id: string } };
    const p = await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s.session.id}/prompt`, payload: { text: '帮我看下目录结构' } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toEqual({ admitted: true });
    const promptReq = ctx.fake.requests.find((r) => r.path.endsWith('/prompt'));
    expect(promptReq?.body).toEqual({ text: '帮我看下目录结构' });
    const i = await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s.session.id}/interrupt` });
    expect(i.json()).toEqual({ ok: true });
    expect(ctx.fake.requests.some((r) => r.path.endsWith('/interrupt'))).toBe(true);
    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/humanthink/sessions/${s.session.id}` })).json() as { events: Array<{ type: string; event: { messageId: string; role: string; text: string } }> };
    const msgRow = detail.events.find((e) => e.type === 'message');
    expect(msgRow?.event).toMatchObject({ role: 'user', text: '帮我看下目录结构' });
    expect(msgRow?.event.messageId).toMatch(/^msg_test_/);
    await ctx.app.close();
  });

  test('审批闭环：asked 落镜像 → 待审列表 → once/reject 两档（always 400）→ resolved 后清空', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const { vi } = await import('vitest');    const s = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd' } })).json() as { session: { id: string } };
    // 等全局事件流连上再推（假件在无订阅者时丢弃帧）
    await vi.waitFor(() => expect(ctx.fake.requests.some((r) => r.path === '/api/event')).toBe(true));
    ctx.fake.pushEvent({ type: 'permission.asked', data: { sessionID: s.session.id, id: 'per_1', action: 'shell', resources: ['echo hi'] } });
    await vi.waitFor(async () => {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/humanthink/sessions/${s.session.id}/permission/requests` });
      expect((res.json() as { items: unknown[] }).items.length).toBe(1);
    });
    const items = ((await ctx.app.inject({ method: 'GET', url: `/api/humanthink/sessions/${s.session.id}/permission/requests` })).json() as { items: Array<{ requestID: string; action: string; resources: string[] }> }).items;
    expect(items[0]).toEqual({ requestID: 'per_1', action: 'shell', resources: ['echo hi'] });
    // always 不透传（zod 枚举拒绝）
    const always = await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s.session.id}/permission/per_1/reply`, payload: { decision: 'always' } });
    expect(always.statusCode).toBe(400);
    expect((always.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
    const once = await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s.session.id}/permission/per_1/reply`, payload: { decision: 'once', message: '可以' } });
    expect(once.json()).toEqual({ ok: true });
    expect(ctx.fake.replies).toEqual([{ sessionID: s.session.id, requestID: 'per_1', decision: 'once', message: '可以' }]);
    await vi.waitFor(async () => {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/humanthink/sessions/${s.session.id}/permission/requests` });
      expect((res.json() as { items: unknown[] }).items.length).toBe(0);
    });
    // 历史留痕：permission_request + permission_resolved 行可回溯
    const detail = (await ctx.app.inject({ method: 'GET', url: `/api/humanthink/sessions/${s.session.id}` })).json() as { events: Array<{ type: string }> };
    expect(detail.events.some((e) => e.type === 'permission_request')).toBe(true);
    expect(detail.events.some((e) => e.type === 'permission_resolved')).toBe(true);
    await ctx.app.close();
  });

  test('serve 404 兜底：本地有行但 serve 侧已不存在 → SESSION_NOT_FOUND', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const s = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd' } })).json() as { session: { id: string } };
    ctx.fake.sessions.delete(s.session.id); // serve 侧消失（模拟数据目录清理）
    const res = await ctx.app.inject({ method: 'POST', url: `/api/humanthink/sessions/${s.session.id}/prompt`, payload: { text: '还在吗' } });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SESSION_NOT_FOUND');
    // 本地未知会话 → 同码
    const res2 = await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions/ses_ghost' });
    expect((res2.json() as { error: { code: string } }).error.code).toBe('SESSION_NOT_FOUND');
    await ctx.app.close();
  });

  test('degraded：崩溃+三连退避失败 → 全端点 503 WORKER_UNAVAILABLE（工单功能不受影响）', async () => {
    const ctx = createHtContext();
    await ctx.start();
    const s = (await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions', payload: { workerId: 'oc', workspaceId: 'atd' } })).json() as { session: { id: string } };
    expect((await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions' })).statusCode).toBe(200);
    ctx.fake.failHealth = true;
    ctx.fake.child.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 300));
    expect(ctx.fake.spawnCount).toBe(4); // 首启 + 3 次退避
    for (const [method, url] of [
      ['GET', '/api/humanthink/sessions'],
      ['GET', `/api/humanthink/sessions/${s.session.id}`],
      ['POST', `/api/humanthink/sessions/${s.session.id}/prompt`],
      ['POST', `/api/humanthink/sessions/${s.session.id}/interrupt`],
      ['DELETE', `/api/humanthink/sessions/${s.session.id}`],
      ['GET', `/api/humanthink/sessions/${s.session.id}/permission/requests`],
      ['POST', '/api/humanthink/sessions'],
      ['GET', `/api/humanthink/sessions/${s.session.id}/events`],
    ] as const) {
      const res = await ctx.app.inject({ method, url, payload: method === 'POST' && url.endsWith('/prompt') ? { text: 'x' } : method === 'POST' ? { workerId: 'oc', workspaceId: 'atd' } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('WORKER_UNAVAILABLE');
    }
    // 工单功能不受影响
    const tickets = await ctx.app.inject({ method: 'GET', url: '/api/tickets' });
    expect(tickets.statusCode).toBe(200);
    await ctx.app.close();
  });

  test('无 interactive worker 注册：装配面即拒绝（serve=null → 503 提示语明确）', async () => {
    const ctx = createHtContext({ taskOnlyWorker: true });
    await ctx.start();
    expect(ctx.fake.spawnCount).toBe(0); // 不 spawn
    const res = await ctx.app.inject({ method: 'GET', url: '/api/humanthink/sessions' });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string; message: string } }).error.code).toBe('WORKER_UNAVAILABLE');
    expect((res.json() as { error: { message: string } }).error.message).toContain('未注册提供聊天能力');
    await ctx.app.close();
  });
});
