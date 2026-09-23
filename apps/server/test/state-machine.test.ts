import { describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { TicketService, Ticket } from '../src/domain/ticket-service.js';
import { createTestContext, captureError } from './helpers.js';

/**
 * 沿合法路径把工单推进到目标态（DRAFT 起步；终态 DONE/CANCELLED 不在路径上）。
 * 通道按 type 自动分流：TASK 的放行步带 workerId、DISPATCHED→IN_PROGRESS/IN_PROGRESS→DONE
 * 走 system 通道（dispatcher 进/结算进）；STORY 人工边全集保留。
 */
function walkTo(service: TicketService, id: number, target: Status): Ticket {
  const NEXT: Partial<Record<Status, Status>> = {
    DRAFT: 'SPEC_READY',
    SPEC_READY: 'DISPATCHED',
    DISPATCHED: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
  };
  let ticket = service.getTicket(id);
  const isTask = ticket.type === 'TASK';
  while (ticket.status !== target) {
    const to = NEXT[ticket.status];
    if (!to) throw new Error(`测试助手无法从 ${ticket.status} 推进到 ${target}`);
    if (to === 'SPEC_READY') {
      ticket = service.submitSpec(id, '# spec');
    } else if (isTask && to === 'DISPATCHED') {
      ticket = service.transition(id, to, { actor: 'user', workerId: 'fake' });
    } else if (isTask && (to === 'IN_PROGRESS' || to === 'DONE')) {
      ticket = service.transition(id, to, { actor: 'system' });
    } else {
      ticket = service.transition(id, to, 'user');
    }
  }
  return ticket;
}

describe('状态机：合法边（TASK 通道二分：user 边带 workerId / 执行边走 system）【A1】', () => {
  test('DRAFT→SPEC_READY（经 submitSpec 唯一入口），快照冻结 + 落一行转移', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: '任务' });
    const updated = service.submitSpec(t.id, '# spec v1');
    expect(updated.status).toBe('SPEC_READY');
    expect(updated.specContent).toBe('# spec v1');
    const ts = service.getTicketDetail(t.id).transitions;
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ fromStatus: 'DRAFT', toStatus: 'SPEC_READY', note: 'submit spec' });
  });

  // TASK 的 user 白名单边（放行需 workerId）
  test.each([
    ['SPEC_READY', 'DISPATCHED'],
    ['SPEC_READY', 'CANCELLED'],
    ['DISPATCHED', 'CANCELLED'],
  ] as Array<[Status, Status]>)('%s→%s（user 通道）：status 变更 + 落一行转移', (from, to) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${to}` });
    walkTo(service, t.id, from);
    const updated = service.transition(t.id, to, { actor: 'user', workerId: 'fake', note: 'note-x' });
    expect(updated.status).toBe(to);
    const ts = service.getTicketDetail(t.id).transitions;
    expect(ts.at(-1)).toMatchObject({ fromStatus: from, toStatus: to, note: 'note-x', operator: 'user' });
  });

  // TASK 的执行边（dispatcher 进/结算进）：system 通道合法
  test.each([
    ['DISPATCHED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'DONE'],
  ] as Array<[Status, Status]>)('%s→%s（system 通道）：status 变更 + operator=system', (from, to) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${to}` });
    walkTo(service, t.id, from);
    const updated = service.transition(t.id, to, { actor: 'system', note: 'note-x' });
    expect(updated.status).toBe(to);
    const ts = service.getTicketDetail(t.id).transitions;
    expect(ts.at(-1)).toMatchObject({ fromStatus: from, toStatus: to, note: 'note-x', operator: 'system' });
  });
});

describe('非法转移 → 422 INVALID_TRANSITION，状态不变且转移日志零新增【A2】', () => {
  test.each([
    ['DRAFT', 'DISPATCHED'],
    ['DRAFT', 'IN_PROGRESS'],
    ['DRAFT', 'DONE'],
    ['DRAFT', 'CANCELLED'],
    ['SPEC_READY', 'IN_PROGRESS'],
    ['SPEC_READY', 'DONE'],
    ['DISPATCHED', 'DONE'],
    ['IN_PROGRESS', 'CANCELLED'],
  ] as Array<[Status, Status]>)('%s→%s 被拒', (from, to) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${from}` });
    walkTo(service, t.id, from);
    const before = service.getTicketDetail(t.id).transitions.length;
    const err = captureError(() => service.transition(t.id, to, 'user'));
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.message).toContain(from);
    expect(service.getTicket(t.id).status).toBe(from);
    expect(service.getTicketDetail(t.id).transitions.length).toBe(before);
  });
});

describe('to=SPEC_READY 一律拒绝（USE_SPEC_ENDPOINT，任意来源态）【A6】', () => {
  test.each(['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS'] as Status[])(
    '从 %s 经 transition() 进 SPEC_READY 被拒',
    (from) => {
      const { service } = createTestContext();
      const t = service.createTicket({ type: 'TASK', title: `t-${from}` });
      walkTo(service, t.id, from);
      const before = service.getTicketDetail(t.id).transitions.length;
      const err = captureError(() => service.transition(t.id, 'SPEC_READY', 'user'));
      expect(err.code).toBe('USE_SPEC_ENDPOINT');
      expect(service.getTicket(t.id).status).toBe(from);
      expect(service.getTicketDetail(t.id).transitions.length).toBe(before);
    },
  );
});

describe('终态仅保留重开出边：DONE/CANCELLED 除→DISPATCHED（重开）外均拒【A7】', () => {
  const ALL_OTHER: Status[] = ['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'BLOCKED', 'FAILED'];

  test.each(['DONE', 'CANCELLED'] as Status[])('%s 终态拒绝重开外的一切转移', (terminal) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${terminal}` });
    if (terminal === 'DONE') {
      walkTo(service, t.id, 'DONE');
    } else {
      walkTo(service, t.id, 'SPEC_READY');
      service.transition(t.id, 'CANCELLED', 'user');
    }
    const before = service.getTicketDetail(t.id).transitions.length;
    for (const to of ALL_OTHER.filter((s) => s !== terminal && s !== 'DISPATCHED')) {
      const err = captureError(() => service.transition(t.id, to, 'user'));
      expect(err.code).toMatch(/^(INVALID_TRANSITION|USE_SPEC_ENDPOINT|MANUAL_FORBIDDEN)$/);
    }
    expect(service.getTicket(t.id).status).toBe(terminal);
    expect(service.getTicketDetail(t.id).transitions.length).toBe(before);
  });
});
