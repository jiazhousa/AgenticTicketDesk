import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { ticketCommits, ticketReports } from '../src/db/schema.js';
import { createRealContext, createTestContext, type TestContext } from './helpers.js';

/** 构造一张已完整执行过的 TASK（伪造数据直达 DONE）：round=1 + commit + 报告 */
function makeExecutedTicket(ctx: TestContext): number {
  const t = ctx.service.createTicket({ type: 'TASK', title: '已执行任务' });
  ctx.service.submitSpec(t.id, '# spec');
  ctx.service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
  ctx.service.transition(t.id, 'IN_PROGRESS', { actor: 'system', round: 1 });
  ctx.db
    .insert(ticketCommits)
    .values({ ticketId: t.id, round: 1, sha: 'deadbeefdeadbeef', createdAt: Date.now() })
    .run();
  ctx.db
    .insert(ticketReports)
    .values({
      ticketId: t.id,
      round: 1,
      status: 'done',
      summary: '测试摘要',
      blockReason: null,
      createdAt: Date.now(),
    })
    .run();
  ctx.service.transition(t.id, 'DONE', { actor: 'system' });
  return t.id;
}

/** 构造 BLOCKED 单 + 未关 BLOCKER */
function makeBlockedTicket(ctx: TestContext, title: string): { parent: number; blocker: number } {
  const t = ctx.service.createTicket({ type: 'TASK', title });
  ctx.service.submitSpec(t.id, '# spec');
  ctx.service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
  ctx.service.transition(t.id, 'IN_PROGRESS', { actor: 'system' });
  ctx.service.transition(t.id, 'BLOCKED', { actor: 'system' });
  const blocker = ctx.service.createBlocker({ parentTicketId: t.id, reason: '外部卡点：需人工确认' });
  return { parent: t.id, blocker: blocker.id };
}

describe('GET /api/workers', () => {
  test('返回注册表列表（id/name/protocol/capabilities）', async () => {
    const { app } = createTestContext();
    const res = await app.inject({ method: 'GET', url: '/api/workers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([{ id: 'fake', name: 'Fake', protocol: 'spawn-cli', capabilities: ['task'] }]);
  });
});

describe('POST /transition 放行校验链', () => {
  test('TASK 放行无 workerId → 422 WORKER_REQUIRED', async () => {
    const { app, service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# spec');
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/transition`,
      payload: { to: 'DISPATCHED' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('WORKER_REQUIRED');
  });

  test('workerId 未注册 → 422 WORKER_UNKNOWN', async () => {
    const { app, service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# spec');
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/transition`,
      payload: { to: 'DISPATCHED', workerId: 'ghost' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('WORKER_UNKNOWN');
  });

  test('TASK 手推执行边 → 422 MANUAL_FORBIDDEN', async () => {
    const { app, service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# spec');
    service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/transition`,
      payload: { to: 'IN_PROGRESS' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MANUAL_FORBIDDEN');
  });
});

describe('GET /api/tickets/:id 详情聚合扩展', () => {
  test('含 round/pendingLabel/workerName/execution/commits/report；无卡点时 blocker=null', async () => {
    const ctx = createTestContext();
    const id = makeExecutedTicket(ctx);
    const res = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ticket.round).toBe(1);
    expect(body.ticket.pendingLabel).toBeNull();
    expect(body.ticket.workerId).toBe('fake');
    expect(body.workerName).toBe('Fake');
    // 终态（DONE）不携带 execution——前端以其判执行中，终态必须 null
    expect(body.execution).toBeNull();
    expect(body.commits).toEqual([{ round: 1, sha: 'deadbeefdeadbeef' }]);
    expect(body.report).toEqual({ round: 1, status: 'done', summary: '测试摘要', blockReason: null });
    expect(body.blocker).toBeNull();
  });

  test('执行中（IN_PROGRESS）携带 execution；BLOCKER 详情 blocks 反查父单', async () => {
    const ctx = createTestContext();
    const t = ctx.service.createTicket({ type: 'TASK', title: '执行中单' });
    ctx.service.submitSpec(t.id, '# spec');
    ctx.service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t.id, 'IN_PROGRESS', { actor: 'system', round: 1 });
    const res = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${t.id}` });
    expect(res.json().execution?.startedAt).toEqual(expect.any(Number));

    // BLOCKER：造父单 BLOCKED + BLOCKER 子单 → BLOCKER 详情 blocks 含父单
    const parent = ctx.service.createTicket({ type: 'TASK', title: '卡点父单' });
    ctx.service.submitSpec(parent.id, '# spec');
    ctx.service.transition(parent.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(parent.id, 'IN_PROGRESS', { actor: 'system', round: 1 });
    ctx.service.transition(parent.id, 'BLOCKED', { actor: 'system', note: '升级' });
    const blocker = ctx.service.createBlocker({ parentTicketId: parent.id, reason: '上下文' });
    const bRes = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${blocker.id}` });
    expect(bRes.json().blocks.map((x: { id: number }) => x.id)).toContain(parent.id);
  });

  test('BLOCKED 单透出 pendingLabel=l3 与未关 BLOCKER', async () => {
    const ctx = createTestContext();
    const { parent, blocker } = makeBlockedTicket(ctx, '卡住的任务');
    const res = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${parent}` });
    const body = res.json();
    expect(body.ticket.status).toBe('BLOCKED');
    expect(body.ticket.pendingLabel).toBe('l3');
    expect(body.blocker).toMatchObject({ id: blocker, type: 'BLOCKER', status: 'IN_PROGRESS' });
    // BLOCKER 关闭后详情不再透出
    ctx.service.transition(blocker, 'DONE', { actor: 'system' });
    const after = (await ctx.app.inject({ method: 'GET', url: `/api/tickets/${parent}` })).json();
    expect(after.blocker).toBeNull();
  });
});

describe('GET /api/tickets/:id/logs', () => {
  test('缺省 round=当前轮、tail=50；显式 round/tail 生效；上限 500', async () => {
    const ctx = createTestContext();
    const id = makeExecutedTicket(ctx);
    const logsDir = path.join(ctx.config.dataDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const lines = Array.from(
      { length: 60 },
      (_, i) => JSON.stringify({ type: 'text-delta', text: `line-${i}` }),
    );
    writeFileSync(path.join(logsDir, `t${id}.r1.events.jsonl`), `${lines.join('\n')}\n`);

    const def = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${id}/logs` });
    expect(def.statusCode).toBe(200);
    const defBody = def.json();
    expect(defBody.round).toBe(1);
    expect(defBody.events).toHaveLength(50);
    expect(defBody.events[0]).toEqual({ type: 'text-delta', text: 'line-10' });
    expect(defBody.events.at(-1)).toEqual({ type: 'text-delta', text: 'line-59' });

    const small = (await ctx.app.inject({ method: 'GET', url: `/api/tickets/${id}/logs?tail=10` })).json();
    expect(small.events).toHaveLength(10);

    const big = (
      await ctx.app.inject({ method: 'GET', url: `/api/tickets/${id}/logs?tail=999&round=1` })
    ).json();
    expect(big.events).toHaveLength(60);
  });

  test('日志文件不存在 → 空事件数组（round 原样回显）', async () => {
    const ctx = createTestContext();
    const t = ctx.service.createTicket({ type: 'TASK', title: 't' });
    const res = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${t.id}/logs` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ round: 0, events: [] });
  });
});

describe('POST /api/tickets/:blockerId/resolve 校验链', () => {
  test('目标不是 BLOCKER → RESOLUTION_INVALID', async () => {
    const ctx = createTestContext();
    const id = makeExecutedTicket(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${id}/resolve`,
      payload: { resolution: 'abort' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('RESOLUTION_INVALID');
  });

  test('BLOCKER 已关 → RESOLUTION_INVALID', async () => {
    const ctx = createTestContext();
    const { blocker } = makeBlockedTicket(ctx, '已决任务');
    ctx.service.transition(blocker, 'DONE', { actor: 'system' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${blocker}/resolve`,
      payload: { resolution: 'abort' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('RESOLUTION_INVALID');
  });

  test('父单非 BLOCKED → RESOLUTION_INVALID', async () => {
    const ctx = createTestContext();
    const t = ctx.service.createTicket({ type: 'TASK', title: '未阻塞父单' });
    ctx.service.submitSpec(t.id, '# spec');
    ctx.service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t.id, 'IN_PROGRESS', { actor: 'system' });
    // 直接建 BLOCKER 但父单保持 IN_PROGRESS
    const blocker = ctx.service.createBlocker({ parentTicketId: t.id, reason: 'x' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${blocker.id}/resolve`,
      payload: { resolution: 'abort' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('RESOLUTION_INVALID');
  });

  test('reassign 缺 reassignWorkerId → 422；未注册 → WORKER_UNKNOWN', async () => {
    const ctx = createTestContext();
    const { blocker } = makeBlockedTicket(ctx, '改派任务');
    const miss = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${blocker}/resolve`,
      payload: { resolution: 'reassign' },
    });
    expect(miss.statusCode).toBe(422);
    expect(miss.json().error.code).toBe('WORKER_REQUIRED');

    const ghost = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${blocker}/resolve`,
      payload: { resolution: 'reassign', reassignWorkerId: 'ghost' },
    });
    expect(ghost.statusCode).toBe(422);
    expect(ghost.json().error.code).toBe('WORKER_UNKNOWN');
  });

  test('abort 裁决：note 落 BLOCKER 留言 → BLOCKER DONE → 父单 FAILED', async () => {
    const ctx = createTestContext();
    const { parent, blocker } = makeBlockedTicket(ctx, '终止任务');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${blocker}/resolve`,
      payload: { resolution: 'abort', note: '放弃该方案' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocker.status).toBe('DONE');
    expect(body.parent.status).toBe('FAILED');
    const comments = ctx.service.getTicketDetail(blocker).comments;
    expect(comments.at(-1)).toMatchObject({ authorType: 'user', content: '放弃该方案' });
    expect(ctx.service.getTicket(parent).pendingLabel).toBeNull();
  });
});

describe('spec 超长拦截（prompt 长度约束）', () => {
  test('specContent 超 128KB → 422 PROMPT_TOO_LONG', async () => {
    const { app, service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/tickets/${t.id}/spec`,
      payload: { specContent: 'x'.repeat(128 * 1024 + 1) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PROMPT_TOO_LONG');
    expect(service.getTicket(t.id).status).toBe('DRAFT');
  });
});

describe('B2：worktree 前置失败（dataDir 只读）→ 放行 422 WORKTREE_SETUP', () => {
  test('状态留 SPEC_READY，无 spawn', async () => {
    // dataDir 父目录只读 → 四子目录 mkdir 失败
    const roBase = mkdtempSync(path.join(tmpdir(), 'atdro-'));
    chmodSync(roBase, 0o555);
    try {
      const roCtx = createRealContext({ dataDir: path.join(roBase, 'atd') });
      const t = roCtx.service.createTicket({ type: 'TASK', title: '只读任务' });
      roCtx.service.submitSpec(t.id, '# spec');
      const res = await roCtx.app.inject({
        method: 'POST',
        url: `/api/tickets/${t.id}/transition`,
        payload: { to: 'DISPATCHED', workerId: 'fake' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('WORKTREE_SETUP');
      expect(roCtx.service.getTicket(t.id).status).toBe('SPEC_READY');
      // 无任何日志产物（未 spawn）
      expect(existsSync(path.join(roCtx.config.dataDir, 'logs'))).toBe(false);
    } finally {
      chmodSync(roBase, 0o755);
    }
  });
});
