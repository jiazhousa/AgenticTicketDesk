import { describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext, type TestContext } from './helpers.js';

/**
 * S3 API 契约用例（独立文件，不动既有 api.test.ts）：
 * FILE_SET_CONFLICT 错误结构 / 放行排队响应（不报错）/ 新字段透出 / submitSpec plannedFiles 校验。
 */

async function post(app: FastifyInstance, url: string, body?: Record<string, unknown>) {
  return await app.inject({ method: 'POST', url, payload: body });
}

async function get(app: FastifyInstance, url: string) {
  return await app.inject({ method: 'GET', url });
}

/** 建单 + 提交 spec（可带声明文件集），返回工单 id */
async function specTicket(
  ctx: TestContext,
  opts: { title?: string; plannedFiles?: string[] } = {},
): Promise<number> {
  const res = await post(ctx.app, '/api/tickets', { type: 'TASK', title: opts.title ?? 'S3 任务' });
  expect(res.statusCode).toBe(201);
  const { id } = res.json();
  const spec = await post(ctx.app, `/api/tickets/${id}/spec`, {
    specContent: '# spec',
    ...(opts.plannedFiles ? { plannedFiles: opts.plannedFiles } : {}),
  });
  expect(spec.statusCode).toBe(200);
  return id;
}

describe('FILE_SET_CONFLICT 422 错误结构【S3】', () => {
  test('user 放行声明相交 → 422 + details 含双方单号与相交文件', async () => {
    const ctx = createTestContext();
    const t1 = await specTicket(ctx, { title: '在途', plannedFiles: ['src/'] });
    ctx.service.transition(t1, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = await specTicket(ctx, { title: '后来', plannedFiles: ['src/a.ts'] });

    const res = await post(ctx.app, `/api/tickets/${t2}/transition`, {
      to: 'DISPATCHED',
      workerId: 'fake',
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('FILE_SET_CONFLICT');
    expect(body.error.message).toBeTruthy();
    expect(body.error.details.join('\n')).toContain(`单 ${t2} 与单 ${t1} 文件集相交: src/a.ts, src/`);
    // 单未入队（user 通道拒绝语义）
    const after = (await get(ctx.app, `/api/tickets/${t2}`)).json().ticket;
    expect(after.status).toBe('SPEC_READY');
    expect(after.queuedReason).toBeNull();
  });

  test('system 通道同场景不报错：编排链自动放行落排队', async () => {
    const ctx = createTestContext();
    const t1 = await specTicket(ctx, { title: '在途', plannedFiles: ['src/'] });
    ctx.service.transition(t1, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '编排下游', workerId: 'fake' });
    ctx.service.submitSpec(t2.id, '# spec', ['src/a.ts']);
    const queued = ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'system' });
    expect(queued.status).toBe('SPEC_READY');
    expect(queued.queuedReason).toBe('FILE_CONFLICT');
  });
});

describe('放行排队响应（闸门满不报错）【S3】', () => {
  test('user 放行闸门满 → 200 返回排队单（SPEC_READY+queuedReason+workerId 可查）', async () => {
    const ctx = createTestContext({ maxConcurrentPerRepo: 1 });
    const t1 = await specTicket(ctx, { title: '占位' });
    ctx.service.transition(t1, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = await specTicket(ctx, { title: '排队' });

    const res = await post(ctx.app, `/api/tickets/${t2}/transition`, {
      to: 'DISPATCHED',
      workerId: 'fake',
    });
    expect(res.statusCode).toBe(200);
    const ticket = res.json();
    // 契约冻结：排队判定 = status==='SPEC_READY' && queuedReason
    expect(ticket.status).toBe('SPEC_READY');
    expect(ticket.queuedReason).toBe('GATE_QUEUED');
    expect(ticket.workerId).toBe('fake');
    expect(ticket.queuedAt).toBeGreaterThan(0);

    // 详情可查同字段
    const detail = (await get(ctx.app, `/api/tickets/${t2}`)).json().ticket;
    expect(detail.queuedReason).toBe('GATE_QUEUED');
    expect(detail.workerId).toBe('fake');

    // 排队单可取消，取消后排队字段清空
    const cancel = await post(ctx.app, `/api/tickets/${t2}/transition`, { to: 'CANCELLED' });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('CANCELLED');
    expect(cancel.json().queuedReason).toBeNull();
    expect(cancel.json().queuedAt).toBeNull();
  });
});

describe('新字段透出（列表/详情）【S3】', () => {
  test('queuedReason/queuedAt/retryCount/retryAt/plannedFiles 随 Ticket 透出', async () => {
    const ctx = createTestContext();
    const t1 = await specTicket(ctx, { title: '声明单', plannedFiles: ['src/', 'a.ts'] });
    const t2 = await specTicket(ctx, { title: '未声明单' });

    const list = (await get(ctx.app, '/api/tickets')).json().items as Record<string, unknown>[];
    const byId = new Map(list.map((x) => [x.id, x]));
    expect(byId.get(t1)!.plannedFiles).toEqual(['src/', 'a.ts']);
    expect(byId.get(t2)!.plannedFiles).toBeNull();
    for (const id of [t1, t2]) {
      const item = byId.get(id)!;
      expect(item.queuedReason).toBeNull();
      expect(item.queuedAt).toBeNull();
      expect(item.retryCount).toBe(0);
      expect(item.retryAt).toBeNull();
    }

    const detail = (await get(ctx.app, `/api/tickets/${t1}`)).json().ticket;
    expect(detail.plannedFiles).toEqual(['src/', 'a.ts']);
    expect(detail.retryCount).toBe(0);
    expect(detail.retryAt).toBeNull();
    expect(detail.queuedReason).toBeNull();
    expect(detail.queuedAt).toBeNull();
  });
});

describe('submitSpec plannedFiles 校验【S3】', () => {
  test('非数组 / 空路径条目 → 400 VALIDATION（zod routes 层拦截）', async () => {
    const ctx = createTestContext();
    const mk = async () => {
      const res = await post(ctx.app, '/api/tickets', { type: 'TASK', title: '校验' });
      return res.json().id as number;
    };
    const a = await mk();
    const bad1 = await post(ctx.app, `/api/tickets/${a}/spec`, {
      specContent: '# s',
      plannedFiles: 'src/',
    });
    expect(bad1.statusCode).toBe(400);
    expect(bad1.json().error.code).toBe('VALIDATION');
    expect(bad1.json().error.details.join('\n')).toContain('plannedFiles');

    const b = await mk();
    const bad2 = await post(ctx.app, `/api/tickets/${b}/spec`, {
      specContent: '# s',
      plannedFiles: ['ok.ts', ''],
    });
    expect(bad2.statusCode).toBe(400);
    expect(bad2.json().error.code).toBe('VALIDATION');

    // 合法形态通过（空数组=未声明落 null）
    const c = await mk();
    const ok = await post(ctx.app, `/api/tickets/${c}/spec`, { specContent: '# s', plannedFiles: [] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().plannedFiles).toBeNull();
  });
});
