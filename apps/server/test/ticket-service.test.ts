import { describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { TicketService } from '../src/domain/ticket-service.js';
import { createTestContext, captureError } from './helpers.js';

function walkTo(service: TicketService, id: number, target: Status): void {
  const NEXT: Partial<Record<Status, Status>> = {
    DRAFT: 'SPEC_READY',
    SPEC_READY: 'DISPATCHED',
    DISPATCHED: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
  };
  let cur = service.getTicket(id).status;
  while (cur !== target) {
    const to = NEXT[cur];
    if (!to) throw new Error(`测试助手无法从 ${cur} 推进到 ${target}`);
    if (to === 'SPEC_READY') service.submitSpec(id, '# spec');
    else service.transition(id, to, 'user');
    cur = service.getTicket(id).status;
  }
}

/** 建父 STORY + n 个子 TASK 并推进到指定状态 */
function makeFamily(
  service: TicketService,
  childStatuses: Status[],
): { parent: number; children: number[] } {
  const parent = service.createTicket({ type: 'STORY', title: '父需求' });
  const children = childStatuses.map((target, i) => {
    const child = service.createTicket({ type: 'TASK', title: `子任务${i + 1}`, parentId: parent.id });
    if (target === 'CANCELLED') {
      walkTo(service, child.id, 'SPEC_READY');
      service.transition(child.id, 'CANCELLED', 'user');
    } else if (target !== 'DRAFT') {
      walkTo(service, child.id, target);
    }
    return child.id;
  });
  return { parent: parent.id, children };
}

describe('STORY 聚合门【A4】', () => {
  test('子单未全 DONE → 父单 DONE 被拒，details 列出未完成子单', () => {
    const { service } = createTestContext();
    const { parent, children } = makeFamily(service, ['DONE', 'IN_PROGRESS', 'DRAFT']);
    walkTo(service, parent, 'IN_PROGRESS');
    const err = captureError(() => service.transition(parent, 'DONE', 'user'));
    expect(err.code).toBe('CHILDREN_PENDING');
    expect(err.details).toBeDefined();
    const joined = err.details!.join('\n');
    expect(joined).toContain(`#${children[1]}`);
    expect(joined).toContain(`#${children[2]}`);
    expect(joined).not.toContain(`#${children[0]}`);
    expect(service.getTicket(parent).status).toBe('IN_PROGRESS');
  });

  test('子单全 DONE → 父单 DONE 通过', () => {
    const { service } = createTestContext();
    const { parent } = makeFamily(service, ['DONE', 'DONE', 'DONE']);
    walkTo(service, parent, 'IN_PROGRESS');
    const done = service.transition(parent, 'DONE', 'user');
    expect(done.status).toBe('DONE');
  });

  test('一子 CANCELLED + 余 DONE → 父单 DONE 通过且 hasCancelledChildren=true【A4/A7】', () => {
    const { service } = createTestContext();
    const { parent } = makeFamily(service, ['DONE', 'CANCELLED', 'DONE']);
    walkTo(service, parent, 'IN_PROGRESS');
    const done = service.transition(parent, 'DONE', 'user');
    expect(done.status).toBe('DONE');
    expect(service.getTicketDetail(parent).hasCancelledChildren).toBe(true);
  });

  test('无子单的 STORY 不受聚合门限制', () => {
    const { service } = createTestContext();
    const parent = service.createTicket({ type: 'STORY', title: '独立故事' });
    walkTo(service, parent.id, 'IN_PROGRESS');
    expect(service.transition(parent.id, 'DONE', 'user').status).toBe('DONE');
  });
});

describe('blockedBy 依赖门【A5】', () => {
  test('blockedBy 未 DONE → DISPATCHED 被拒，details 列依赖单', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: '依赖A' });
    walkTo(service, a.id, 'IN_PROGRESS'); // 未 DONE
    const b = service.createTicket({ type: 'TASK', title: '被阻塞B' });
    service.submitSpec(b.id, '# spec');
    service.addDependency(b.id, a.id);
    const err = captureError(() => service.transition(b.id, 'DISPATCHED', 'user'));
    expect(err.code).toBe('BLOCKED_BY_PENDING');
    expect(err.details!.join('\n')).toContain(`#${a.id}`);
    expect(service.getTicket(b.id).status).toBe('SPEC_READY');
  });

  test('blockedBy 全 DONE → DISPATCHED 通过', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: '依赖A' });
    walkTo(service, a.id, 'DONE');
    const b = service.createTicket({ type: 'TASK', title: '被阻塞B' });
    service.submitSpec(b.id, '# spec');
    service.addDependency(b.id, a.id);
    expect(service.transition(b.id, 'DISPATCHED', 'user').status).toBe('DISPATCHED');
  });
});

describe('DAG 完整性【spec §3.3】', () => {
  test('自依赖被拒', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: 'A' });
    const err = captureError(() => service.addDependency(a.id, a.id));
    expect(err.code).toBe('DAG_INVALID');
  });

  test('两单互为依赖成环被拒', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: 'A' });
    const b = service.createTicket({ type: 'TASK', title: 'B' });
    service.addDependency(a.id, b.id); // A blockedBy B
    const err = captureError(() => service.addDependency(b.id, a.id)); // B blockedBy A → 环
    expect(err.code).toBe('DAG_INVALID');
    expect(err.message).toContain('环');
  });

  test('重复依赖边被拒', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: 'A' });
    const b = service.createTicket({ type: 'TASK', title: 'B' });
    service.addDependency(a.id, b.id);
    const err = captureError(() => service.addDependency(a.id, b.id));
    expect(err.code).toBe('DAG_INVALID');
  });

  test('blockedBy 目标不存在 → 404 NOT_FOUND', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: 'A' });
    const err = captureError(() => service.addDependency(a.id, 9999));
    expect(err.code).toBe('NOT_FOUND');
  });

  test('parentId 非 STORY → DAG_INVALID', () => {
    const { service } = createTestContext();
    const task = service.createTicket({ type: 'TASK', title: '普通任务' });
    const err = captureError(() =>
      service.createTicket({ type: 'TASK', title: '非法子单', parentId: task.id }),
    );
    expect(err.code).toBe('DAG_INVALID');
  });

  test('STORY 带 parentId → DAG_INVALID（STORY 无父）', () => {
    const { service } = createTestContext();
    const story = service.createTicket({ type: 'STORY', title: '父故事' });
    const err = captureError(() =>
      service.createTicket({ type: 'STORY', title: '非法嵌套故事', parentId: story.id }),
    );
    expect(err.code).toBe('DAG_INVALID');
    expect(err.message).toContain('仅 TASK');
  });

  test('parentId 不存在 → DAG_INVALID', () => {
    const { service } = createTestContext();
    const err = captureError(() =>
      service.createTicket({ type: 'TASK', title: '孤儿任务', parentId: 9999 }),
    );
    expect(err.code).toBe('DAG_INVALID');
  });
});

describe('spec 快照冻结【A6】', () => {
  test('SPEC_READY 后 PATCH specContent → 422 NOT_DRAFT，字段未变', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# v1');
    const err = captureError(() => service.updateTicket(t.id, { specContent: '# v2' }));
    expect(err.code).toBe('NOT_DRAFT');
    const after = service.getTicket(t.id);
    expect(after.specContent).toBe('# v1');
    expect(after.status).toBe('SPEC_READY');
  });

  test('DRAFT 期 specContent 可编辑（与 title/description 同通道）', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    const updated = service.updateTicket(t.id, { specContent: '# 草稿', title: 't2' });
    expect(updated.specContent).toBe('# 草稿');
    expect(updated.title).toBe('t2');
  });
});
