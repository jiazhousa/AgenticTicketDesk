import { describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { TicketService } from '../src/domain/ticket-service.js';
import { createTestContext, captureError } from './helpers.js';

/** 沿合法路径推进（TASK：放行带 workerId、执行边 system；STORY：人工边全集） */
function walkTo(service: TicketService, id: number, target: Status): void {
  const NEXT: Partial<Record<Status, Status>> = {
    DRAFT: 'SPEC_READY',
    SPEC_READY: 'DISPATCHED',
    DISPATCHED: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
  };
  const isTask = service.getTicket(id).type === 'TASK';
  let cur = service.getTicket(id).status;
  while (cur !== target) {
    const to = NEXT[cur];
    if (!to) throw new Error(`测试助手无法从 ${cur} 推进到 ${target}`);
    if (to === 'SPEC_READY') service.submitSpec(id, '# spec');
    else if (isTask && to === 'DISPATCHED') service.transition(id, to, { actor: 'user', workerId: 'fake' });
    else if (isTask && (to === 'IN_PROGRESS' || to === 'DONE')) service.transition(id, to, { actor: 'system' });
    else service.transition(id, to, 'user');
    cur = service.getTicket(id).status;
  }
}

/** TASK 推进到 IN_PROGRESS（system 通道） */
function taskToInProgress(service: TicketService, title: string): number {
  const t = service.createTicket({ type: 'TASK', title });
  walkTo(service, t.id, 'IN_PROGRESS');
  return t.id;
}

describe('新边（system 通道）合法各一例', () => {
  test('IN_PROGRESS→BLOCKED：pendingLabel=l3 + 落转移行', () => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, 't-blocked');
    const updated = service.transition(id, 'BLOCKED', { actor: 'system', note: '卡点' });
    expect(updated.status).toBe('BLOCKED');
    expect(updated.pendingLabel).toBe('l3');
    expect(service.getTicketDetail(id).transitions.at(-1)).toMatchObject({
      fromStatus: 'IN_PROGRESS',
      toStatus: 'BLOCKED',
      operator: 'system',
    });
  });

  test('IN_PROGRESS→FAILED（worker 崩溃/超时入边）', () => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, 't-failed');
    expect(service.transition(id, 'FAILED', { actor: 'system' }).status).toBe('FAILED');
  });

  test('BLOCKED→IN_PROGRESS（裁决=继续）：pendingLabel 清空', () => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, 't-continue');
    service.transition(id, 'BLOCKED', { actor: 'system' });
    const updated = service.transition(id, 'IN_PROGRESS', { actor: 'system' });
    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.pendingLabel).toBeNull();
  });

  test('BLOCKED→DISPATCHED（裁决=改派，可带新 workerId）', () => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, 't-reassign');
    service.transition(id, 'BLOCKED', { actor: 'system' });
    const updated = service.transition(id, 'DISPATCHED', { actor: 'system', workerId: 'fake' });
    expect(updated.status).toBe('DISPATCHED');
    expect(updated.workerId).toBe('fake');
    expect(updated.pendingLabel).toBeNull();
  });

  test('BLOCKED→FAILED（裁决=终止）', () => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, 't-abort');
    service.transition(id, 'BLOCKED', { actor: 'system' });
    expect(service.transition(id, 'FAILED', { actor: 'system' }).status).toBe('FAILED');
  });

  test('BLOCKED→CANCELLED（user 白名单边：人为取消）', () => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, 't-cancel');
    service.transition(id, 'BLOCKED', { actor: 'system' });
    const updated = service.transition(id, 'CANCELLED', { actor: 'user' });
    expect(updated.status).toBe('CANCELLED');
    expect(updated.pendingLabel).toBeNull();
  });
});

describe('user 请求 system 边 → MANUAL_FORBIDDEN（判定优先级：INVALID_TRANSITION 先于本码）', () => {
  test.each([
    ['DISPATCHED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'DONE'],
    ['IN_PROGRESS', 'BLOCKED'],
    ['IN_PROGRESS', 'FAILED'],
  ] as Array<[Status, Status]>)('TASK %s→%s（user）被拒，状态不变', (from, to) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${to}` });
    walkTo(service, t.id, from);
    const err = captureError(() => service.transition(t.id, to, 'user'));
    expect(err.code).toBe('MANUAL_FORBIDDEN');
    expect(service.getTicket(t.id).status).toBe(from);
  });

  test.each([
    ['BLOCKED', 'IN_PROGRESS'],
    ['BLOCKED', 'DISPATCHED'],
    ['BLOCKED', 'FAILED'],
  ] as Array<[Status, Status]>)('TASK %s→%s（user）被拒', (from, to) => {
    const { service } = createTestContext();
    const id = taskToInProgress(service, `t-${to}`);
    service.transition(id, 'BLOCKED', { actor: 'system' });
    const err = captureError(() => service.transition(id, to, 'user'));
    expect(err.code).toBe('MANUAL_FORBIDDEN');
    expect(service.getTicket(id).status).toBe('BLOCKED');
  });

  test('优先级锚点：不在边表的转移返回 INVALID_TRANSITION（而非 MANUAL_FORBIDDEN）', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't-priority' });
    const err = captureError(() => service.transition(t.id, 'DONE', 'user'));
    expect(err.code).toBe('INVALID_TRANSITION');
  });

  test('STORY 人工边保留：IN_PROGRESS→DONE（user）合法', () => {
    const { service } = createTestContext();
    const story = service.createTicket({ type: 'STORY', title: 's' });
    walkTo(service, story.id, 'IN_PROGRESS');
    expect(service.transition(story.id, 'DONE', 'user').status).toBe('DONE');
  });
});

describe('TASK 放行三件套（校验顺序：blockedBy → workerId → worktree）', () => {
  test('无 workerId → WORKER_REQUIRED', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# spec');
    const err = captureError(() => service.transition(t.id, 'DISPATCHED', { actor: 'user' }));
    expect(err.code).toBe('WORKER_REQUIRED');
    expect(service.getTicket(t.id).status).toBe('SPEC_READY');
  });

  test('workerId 未注册 → WORKER_UNKNOWN', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# spec');
    const err = captureError(() =>
      service.transition(t.id, 'DISPATCHED', { actor: 'user', workerId: 'ghost' }),
    );
    expect(err.code).toBe('WORKER_UNKNOWN');
  });

  test('blockedBy 未完成时先拒 BLOCKED_BY_PENDING（最优先，先于 WORKER_REQUIRED）', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: '依赖A' });
    const b = service.createTicket({ type: 'TASK', title: '被阻塞B' });
    service.submitSpec(b.id, '# spec');
    service.addDependency(b.id, a.id);
    const err = captureError(() => service.transition(b.id, 'DISPATCHED', { actor: 'user' }));
    expect(err.code).toBe('BLOCKED_BY_PENDING');
  });
});
