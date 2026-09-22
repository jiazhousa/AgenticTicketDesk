import { describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { TicketService, Ticket } from '../src/domain/ticket-service.js';
import { createTestContext, captureError } from './helpers.js';

/** 沿合法路径把工单推进到目标态（DRAFT 起步；终态 DONE/CANCELLED 不在路径上） */
function walkTo(service: TicketService, id: number, target: Status): Ticket {
  const NEXT: Partial<Record<Status, Status>> = {
    DRAFT: 'SPEC_READY',
    SPEC_READY: 'DISPATCHED',
    DISPATCHED: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
  };
  let ticket = service.getTicket(id);
  while (ticket.status !== target) {
    const to = NEXT[ticket.status];
    if (!to) throw new Error(`测试助手无法从 ${ticket.status} 推进到 ${target}`);
    ticket = to === 'SPEC_READY' ? service.submitSpec(id, '# spec') : service.transition(id, to, 'user');
  }
  return ticket;
}

describe('状态机：六条合法边【A1】', () => {
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

  test.each([
    ['SPEC_READY', 'DISPATCHED'],
    ['SPEC_READY', 'CANCELLED'],
    ['DISPATCHED', 'IN_PROGRESS'],
    ['DISPATCHED', 'CANCELLED'],
    ['IN_PROGRESS', 'DONE'],
  ] as Array<[Status, Status]>)('%s→%s：status 变更 + 落一行转移', (from, to) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${to}` });
    walkTo(service, t.id, from);
    const updated = service.transition(t.id, to, 'user', 'note-x');
    expect(updated.status).toBe(to);
    // walkTo 已落 from 之前的转移行，此处断言最后一行即本次转移
    const ts = service.getTicketDetail(t.id).transitions;
    expect(ts.at(-1)).toMatchObject({ fromStatus: from, toStatus: to, note: 'note-x', operator: 'user' });
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

describe('终态无出边：DONE/CANCELLED 任意 to 均拒【A7】', () => {
  const ALL_OTHER: Status[] = ['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

  test.each(['DONE', 'CANCELLED'] as Status[])('%s 终态拒一切转移', (terminal) => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: `t-${terminal}` });
    if (terminal === 'DONE') {
      walkTo(service, t.id, 'DONE');
    } else {
      walkTo(service, t.id, 'SPEC_READY');
      service.transition(t.id, 'CANCELLED', 'user');
    }
    const before = service.getTicketDetail(t.id).transitions.length;
    for (const to of ALL_OTHER.filter((s) => s !== terminal)) {
      const err = captureError(() => service.transition(t.id, to, 'user'));
      expect(err.code).toMatch(/^(INVALID_TRANSITION|USE_SPEC_ENDPOINT)$/);
    }
    expect(service.getTicket(t.id).status).toBe(terminal);
    expect(service.getTicketDetail(t.id).transitions.length).toBe(before);
  });
});
