import { describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestContext } from './helpers.js';

type Created = { id: number; title: string; status: string };

async function post(app: FastifyInstance, url: string, body?: Record<string, unknown>) {
  return await app.inject({ method: 'POST', url, payload: body });
}

async function get(app: FastifyInstance, url: string) {
  return await app.inject({ method: 'GET', url });
}

/** 建单助手 */
async function createTicket(
  app: FastifyInstance,
  body: Record<string, unknown>,
): Promise<Created> {
  const res = await post(app, '/api/tickets', body);
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** transition 助手（TASK 放行需带 workerId） */
async function transition(app: FastifyInstance, id: number, to: string, note?: string, workerId?: string) {
  return post(app, `/api/tickets/${id}/transition`, { to, note, workerId });
}

describe('API 全链：建单→spec→依赖→流转→父单关单【A1】', () => {
  test('STORY+2 子 TASK 全链闭环（第二子单走 blockedBy 先拒后过）', async () => {
    const { app, service } = createTestContext();

    // 建父 STORY + 2 子 TASK
    const parent = await createTicket(app, { type: 'STORY', title: '父需求' });
    expect(parent.status).toBe('DRAFT');
    const child1 = await createTicket(app, { type: 'TASK', title: '子任务1', parentId: parent.id });
    const child2 = await createTicket(app, { type: 'TASK', title: '子任务2', parentId: parent.id });

    // 子2 依赖子1，子1 未完成时子2 放行被拒【A5】（blockedBy 门最优先，先于 workerId 校验）
    const addDep = await post(app, `/api/tickets/${child2.id}/dependencies`, {
      blockedByTicketId: child1.id,
    });
    expect(addDep.statusCode).toBe(201);
    expect(addDep.json()).toEqual({ ok: true });
    await post(app, `/api/tickets/${child2.id}/spec`, { specContent: '# 子2 spec' });
    const blocked = await transition(app, child2.id, 'DISPATCHED', undefined, 'fake');
    expect(blocked.statusCode).toBe(422);
    const blockedBody = blocked.json();
    expect(blockedBody.error.code).toBe('BLOCKED_BY_PENDING');
    expect(blockedBody.error.message).toBeTruthy();
    expect(blockedBody.error.details.join('\n')).toContain(`#${child1.id}`);

    // 子1 走完全程：TASK 执行边已收口 system 通道——HTTP 手推 → 422 MANUAL_FORBIDDEN（收口回归锚点），
    // 后续态由 system 通道（dispatcher 进/结算进）完成
    await post(app, `/api/tickets/${child1.id}/spec`, { specContent: '# 子1 spec' });
    expect((await transition(app, child1.id, 'DISPATCHED', undefined, 'fake')).statusCode).toBe(200);
    const ip1 = await transition(app, child1.id, 'IN_PROGRESS');
    expect(ip1.statusCode).toBe(422);
    expect(ip1.json().error.code).toBe('MANUAL_FORBIDDEN');
    service.transition(child1.id, 'IN_PROGRESS', { actor: 'system' });
    const done1 = await transition(app, child1.id, 'DONE');
    expect(done1.statusCode).toBe(422);
    expect(done1.json().error.code).toBe('MANUAL_FORBIDDEN');
    service.transition(child1.id, 'DONE', { actor: 'system' });

    // 子1 DONE 后子2 放行通过，走完全程（同上：system 边手推被拒后由 system 通道完成）
    expect((await transition(app, child2.id, 'DISPATCHED', undefined, 'fake')).statusCode).toBe(200);
    expect((await transition(app, child2.id, 'IN_PROGRESS')).statusCode).toBe(422);
    service.transition(child2.id, 'IN_PROGRESS', { actor: 'system' });
    expect((await transition(app, child2.id, 'DONE')).statusCode).toBe(422);
    service.transition(child2.id, 'DONE', { actor: 'system' });

    // 父单关单（聚合门满足）
    await post(app, `/api/tickets/${parent.id}/spec`, { specContent: '# 父 spec' });
    expect((await transition(app, parent.id, 'DISPATCHED')).statusCode).toBe(200);
    expect((await transition(app, parent.id, 'IN_PROGRESS')).statusCode).toBe(200);
    const parentDone = await transition(app, parent.id, 'DONE');
    expect(parentDone.statusCode).toBe(200);
    expect(parentDone.json().status).toBe('DONE');

    // 父单详情：时间线完整呈现【A3】
    const detail = (await get(app, `/api/tickets/${parent.id}`)).json();
    expect(detail.transitions.map((t: { fromStatus: string; toStatus: string }) => `${t.fromStatus}→${t.toStatus}`)).toEqual([
      'DRAFT→SPEC_READY',
      'SPEC_READY→DISPATCHED',
      'DISPATCHED→IN_PROGRESS',
      'IN_PROGRESS→DONE',
    ]);
    expect(detail.hasCancelledChildren).toBe(false);
  });

  test('列表返回父子关系与筛选（契约 §3.2）', async () => {
    const { app } = createTestContext();
    const parent = await createTicket(app, { type: 'STORY', title: '父需求' });
    await createTicket(app, { type: 'TASK', title: '子任务1', parentId: parent.id });
    await createTicket(app, { type: 'TASK', title: '子任务2', parentId: parent.id });

    const list = (await get(app, '/api/tickets')).json();
    const parentItem = list.items.find((i: { id: number }) => i.id === parent.id);
    expect(parentItem.childrenCount).toBe(2);
    expect(parentItem.parentTitle).toBeNull();
    const childItem = list.items.find((i: { title: string }) => i.title === '子任务1');
    expect(childItem.parentTitle).toBe('父需求');
    // 默认排序 createdAt DESC：子单后建先出
    expect(list.items[0].title).toBe('子任务2');

    const storyOnly = (await get(app, '/api/tickets?type=STORY')).json();
    expect(storyOnly.items).toHaveLength(1);
    expect(storyOnly.items[0].id).toBe(parent.id);

    // BLOCKER/DREAM 暂不接受创建（400 VALIDATION）
    const bad = await post(app, '/api/tickets', { type: 'BLOCKER', title: 'x' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
  });
});

describe('PATCH /api/tickets/:id【A1 前置】', () => {
  test('DRAFT 期改 title/specContent 生效', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: '旧标题' });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${t.id}`,
      payload: { title: '新标题', specContent: '# spec 草稿' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ title: '新标题', specContent: '# spec 草稿' });
    const detail = (await get(app, `/api/tickets/${t.id}`)).json();
    expect(detail.ticket.title).toBe('新标题');
    expect(detail.ticket.specContent).toBe('# spec 草稿');
  });

  test('空 body（无字段）→ 400 VALIDATION', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: 't' });
    const res = await app.inject({ method: 'PATCH', url: `/api/tickets/${t.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('留言流【A3】', () => {
  test('POST 留言后详情含正序 comments', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: 't' });
    const c1 = await post(app, `/api/tickets/${t.id}/comments`, { content: '第一条' });
    expect(c1.statusCode).toBe(201);
    expect(c1.json()).toMatchObject({ authorType: 'user', authorName: '我', content: '第一条' });
    await post(app, `/api/tickets/${t.id}/comments`, { content: '第二条' });

    const detail = (await get(app, `/api/tickets/${t.id}`)).json();
    expect(detail.comments.map((c: { content: string }) => c.content)).toEqual(['第一条', '第二条']);
  });

  test('空内容留言 → 400 VALIDATION', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: 't' });
    const res = await post(app, `/api/tickets/${t.id}/comments`, { content: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('422 响应体契约【A2】', () => {
  test('非法转移返回 error.code/message', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: 't' });
    const res = await transition(app, t.id, 'DONE');
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('INVALID_TRANSITION');
    expect(typeof body.error.message).toBe('string');
    // 状态未变
    expect((await get(app, `/api/tickets/${t.id}`)).json().ticket.status).toBe('DRAFT');
  });

  test('to=SPEC_READY → USE_SPEC_ENDPOINT（无法绕开 /spec）【A6】', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: 't' });
    const res = await transition(app, t.id, 'SPEC_READY');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('USE_SPEC_ENDPOINT');
  });
});

describe('DELETE /dependencies 解除 blockedBy 门【A5】', () => {
  test('删依赖后原被阻塞单可 DISPATCHED', async () => {
    const { app } = createTestContext();
    const a = await createTicket(app, { type: 'TASK', title: '依赖A' });
    const b = await createTicket(app, { type: 'TASK', title: '被阻塞B' });
    await post(app, `/api/tickets/${b.id}/dependencies`, { blockedByTicketId: a.id });
    await post(app, `/api/tickets/${b.id}/spec`, { specContent: '# spec' });

    const before = await transition(app, b.id, 'DISPATCHED', undefined, 'fake');
    expect(before.statusCode).toBe(422);
    expect(before.json().error.code).toBe('BLOCKED_BY_PENDING');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${b.id}/dependencies/${a.id}`,
    });
    expect(del.statusCode).toBe(204);

    const after = await transition(app, b.id, 'DISPATCHED', undefined, 'fake');
    expect(after.statusCode).toBe(200);
    expect(after.json().status).toBe('DISPATCHED');
  });
});

describe('404 与时间线【A3】', () => {
  test('不存在的工单 → 404 NOT_FOUND 信封', async () => {
    const { app } = createTestContext();
    const res = await get(app, '/api/tickets/9999');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  test('详情含 transitions 时间线（含 spec 冻结行）', async () => {
    const { app } = createTestContext();
    const t = await createTicket(app, { type: 'TASK', title: 't' });
    await post(app, `/api/tickets/${t.id}/spec`, { specContent: '# s' });
    await transition(app, t.id, 'DISPATCHED', '放行', 'fake');
    const detail = (await get(app, `/api/tickets/${t.id}`)).json();
    expect(detail.transitions).toHaveLength(2);
    expect(detail.transitions[0]).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'SPEC_READY', note: 'submit spec' });
    expect(detail.transitions[1]).toMatchObject({ fromStatus: 'SPEC_READY', toStatus: 'DISPATCHED', note: '放行' });
  });
});
