import { describe, expect, test } from 'vitest';
import type { Status } from '../src/domain/status.js';
import type { TicketService } from '../src/domain/ticket-service.js';
import { createTestContext, captureError } from './helpers.js';

/**
 * 沿合法路径推进（TASK：放行带 workerId、执行边走 system 通道；STORY：人工边全集）。
 */
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
    const err = captureError(() =>
      service.transition(b.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }),
    );
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
    expect(
      service.transition(b.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }).status,
    ).toBe('DISPATCHED');
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

describe('plannedFiles 冻结与 JSON 往返【S3】', () => {
  test('submitSpec 提交声明 → 读侧还原 string[]；空数组视同未声明；不传为 null', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: 'a' });
    service.submitSpec(a.id, '# spec', ['src/', 'a.ts']);
    expect(service.getTicket(a.id).plannedFiles).toEqual(['src/', 'a.ts']);
    expect(service.getTicketDetail(a.id).ticket.plannedFiles).toEqual(['src/', 'a.ts']);

    const b = service.createTicket({ type: 'TASK', title: 'b' });
    service.submitSpec(b.id, '# spec', []);
    expect(service.getTicket(b.id).plannedFiles).toBeNull();

    const c = service.createTicket({ type: 'TASK', title: 'c' });
    service.submitSpec(c.id, '# spec');
    expect(service.getTicket(c.id).plannedFiles).toBeNull();
  });

  test('SPEC_READY 后不可改（冻结）：updateTicket 仍 NOT_DRAFT，声明不变', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    service.submitSpec(t.id, '# spec', ['src/']);
    const err = captureError(() => service.updateTicket(t.id, { specContent: '# v2' }));
    expect(err.code).toBe('NOT_DRAFT');
    expect(service.getTicket(t.id).plannedFiles).toEqual(['src/']);
  });
});

describe('排队入口：校验顺序与两通道分流【S3】', () => {
  function occupiedCtx() {
    // 闸门=1 且 t1 已占（DISPATCHED），返回上下文与占位单
    const ctx = createTestContext({ maxConcurrentPerRepo: 1 });
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '占位' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    return { ctx, t1: t1.id };
  }

  test('四件套先行：闸门满但无 workerId 仍 WORKER_REQUIRED，不入队', () => {
    const { ctx } = occupiedCtx();
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '排队候选' });
    ctx.service.submitSpec(t2.id, '# spec');
    const err = captureError(() => ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user' }));
    expect(err.code).toBe('WORKER_REQUIRED');
    const after = ctx.service.getTicket(t2.id);
    expect(after.status).toBe('SPEC_READY');
    expect(after.queuedReason).toBeNull();
    expect(after.workerId).toBeNull();
  });

  test('四件套先行：worker 未注册仍 WORKER_UNKNOWN，不入队', () => {
    const { ctx } = occupiedCtx();
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '排队候选' });
    ctx.service.submitSpec(t2.id, '# spec');
    const err = captureError(() =>
      ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'ghost' }),
    );
    expect(err.code).toBe('WORKER_UNKNOWN');
    expect(ctx.service.getTicket(t2.id).queuedReason).toBeNull();
  });

  test('user 通道闸门满 → 排队 GATE_QUEUED：保持 SPEC_READY、worker_id 早绑定、无 transitions 行', () => {
    const { ctx } = occupiedCtx();
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '排队' });
    ctx.service.submitSpec(t2.id, '# spec');
    const rowsBefore = ctx.service.getTicketDetail(t2.id).transitions.length;
    const queued = ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(queued.status).toBe('SPEC_READY');
    expect(queued.queuedReason).toBe('GATE_QUEUED');
    expect(queued.queuedAt).toBeGreaterThan(0);
    expect(queued.workerId).toBe('fake');
    // 排队不走状态机：无新增转移行
    expect(ctx.service.getTicketDetail(t2.id).transitions.length).toBe(rowsBefore);
  });

  test('system 通道闸门满 → 同样排队（预绑定 worker 沿用）', () => {
    const { ctx } = occupiedCtx();
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '编排下游', workerId: 'fake' });
    ctx.service.submitSpec(t2.id, '# spec');
    const queued = ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'system' });
    expect(queued.status).toBe('SPEC_READY');
    expect(queued.queuedReason).toBe('GATE_QUEUED');
    expect(queued.workerId).toBe('fake');
  });

  test('重排队保持原 queued_at（FIFO 位不因重试后移）', async () => {
    const { ctx } = occupiedCtx();
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '排队' });
    ctx.service.submitSpec(t2.id, '# spec');
    const first = ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    await new Promise((r) => setTimeout(r, 5));
    // 再次放行尝试（闸门仍满）：重新排队但 queuedAt 不变
    const again = ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(again.queuedReason).toBe('GATE_QUEUED');
    expect(again.queuedAt).toBe(first.queuedAt);
  });
});

describe('文件集前置校验【S3】', () => {
  test('user 通道声明相交 → 422 FILE_SET_CONFLICT，details 含双方单号与相交文件；单不入队', () => {
    const { service } = createTestContext();
    const t1 = service.createTicket({ type: 'TASK', title: '在途' });
    service.submitSpec(t1.id, '# spec', ['src/']);
    service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = service.createTicket({ type: 'TASK', title: '后来' });
    service.submitSpec(t2.id, '# spec', ['src/a.ts', 'lib/x.ts']);
    const err = captureError(() => service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }));
    expect(err.code).toBe('FILE_SET_CONFLICT');
    expect(err.details!.join('\n')).toContain(`单 ${t2.id} 与单 ${t1.id} 文件集相交: src/a.ts`);
    const after = service.getTicket(t2.id);
    expect(after.status).toBe('SPEC_READY');
    expect(after.queuedReason).toBeNull();
  });

  test('闸门有位但文件冲突 user 仍拒绝（冲突判定不依赖闸门满）', () => {
    const { service } = createTestContext(); // 闸门缺省 2，仅 t1 占 1 位
    const t1 = service.createTicket({ type: 'TASK', title: '在途' });
    service.submitSpec(t1.id, '# spec', ['a.ts']);
    service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = service.createTicket({ type: 'TASK', title: '后来' });
    service.submitSpec(t2.id, '# spec', ['a.ts']);
    const err = captureError(() => service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }));
    expect(err.code).toBe('FILE_SET_CONFLICT');
  });

  test('system 通道声明相交 → 排队 FILE_CONFLICT（不拒绝）', () => {
    const { service } = createTestContext();
    const t1 = service.createTicket({ type: 'TASK', title: '在途' });
    service.submitSpec(t1.id, '# spec', ['src/']);
    service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = service.createTicket({ type: 'TASK', title: '编排下游', workerId: 'fake' });
    service.submitSpec(t2.id, '# spec', ['src/a.ts']);
    const queued = service.transition(t2.id, 'DISPATCHED', { actor: 'system' });
    expect(queued.status).toBe('SPEC_READY');
    expect(queued.queuedReason).toBe('FILE_CONFLICT');
    expect(queued.workerId).toBe('fake');
  });

  test('占用单未声明 → 不构成冲突（未声明跳过）', () => {
    const { service } = createTestContext();
    const t1 = service.createTicket({ type: 'TASK', title: '在途未声明' });
    service.submitSpec(t1.id, '# spec');
    service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = service.createTicket({ type: 'TASK', title: '后来' });
    service.submitSpec(t2.id, '# spec', ['a.ts']);
    const ok = service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(ok.status).toBe('DISPATCHED');
  });

  test('声明不相交 → 并行放行通过', () => {
    const { service } = createTestContext();
    const t1 = service.createTicket({ type: 'TASK', title: '甲' });
    service.submitSpec(t1.id, '# spec', ['src/']);
    service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = service.createTicket({ type: 'TASK', title: '乙' });
    service.submitSpec(t2.id, '# spec', ['lib/']);
    const ok = service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(ok.status).toBe('DISPATCHED');
  });
});

describe('pendingLabel 参数化与重试记账【S3】', () => {
  test('IN_PROGRESS→BLOCKED 缺省 l3，显式 agent 生效', () => {
    const { service } = createTestContext();
    const a = service.createTicket({ type: 'TASK', title: 'a' });
    walkTo(service, a.id, 'IN_PROGRESS');
    const l3 = service.transition(a.id, 'BLOCKED', { actor: 'system', blockReason: 'x' });
    expect(l3.pendingLabel).toBe('l3');

    const b = service.createTicket({ type: 'TASK', title: 'b' });
    walkTo(service, b.id, 'IN_PROGRESS');
    const agent = service.transition(b.id, 'BLOCKED', {
      actor: 'system',
      pendingLabel: 'agent',
      blockReason: 'y',
      retryCount: 1,
      retryAt: 123,
    });
    expect(agent.pendingLabel).toBe('agent');
    expect(agent.retryCount).toBe(1);
    expect(agent.retryAt).toBe(123);
  });

  test('clearRetry 清零（裁决/重开语义）；唤醒路径可单清 retryAt 保留计数', () => {
    const { service } = createTestContext();
    const t = service.createTicket({ type: 'TASK', title: 't' });
    walkTo(service, t.id, 'IN_PROGRESS');
    service.transition(t.id, 'BLOCKED', {
      actor: 'system',
      pendingLabel: 'agent',
      blockReason: 'x',
      retryCount: 2,
      retryAt: 999,
    });
    // 唤醒（tick 恢复）：清 retryAt、保留计数
    const woken = service.transition(t.id, 'DISPATCHED', { actor: 'system', retryAt: null });
    expect(woken.status).toBe('DISPATCHED');
    expect(woken.retryAt).toBeNull();
    expect(woken.retryCount).toBe(2);
    // 再入 BLOCKED 后人工裁决继续：clearRetry 清零
    service.transition(t.id, 'IN_PROGRESS', { actor: 'system' });
    service.transition(t.id, 'BLOCKED', { actor: 'system', pendingLabel: 'agent', blockReason: 'x', retryCount: 3, retryAt: 111 });
    const cont = service.transition(t.id, 'IN_PROGRESS', { actor: 'system', clearRetry: true });
    expect(cont.retryCount).toBe(0);
    expect(cont.retryAt).toBeNull();
  });
});

describe('user 取消边回调【S3】', () => {
  test('DISPATCHED→CANCELLED 与 BLOCKED→CANCELLED 提交成功后触发回调（fire-and-forget）', () => {
    const { service } = createTestContext();
    const fired: number[] = [];
    service.onInflightReleased = (id) => fired.push(id!);

    const a = service.createTicket({ type: 'TASK', title: 'a' });
    walkTo(service, a.id, 'DISPATCHED');
    service.transition(a.id, 'CANCELLED', 'user');
    expect(fired).toEqual([a.id]);

    const b = service.createTicket({ type: 'TASK', title: 'b' });
    walkTo(service, b.id, 'IN_PROGRESS');
    service.transition(b.id, 'BLOCKED', { actor: 'system', blockReason: 'x' });
    service.transition(b.id, 'CANCELLED', 'user');
    expect(fired).toEqual([a.id, b.id]);
  });

  test('排队中取消（SPEC_READY+queued→CANCELLED）触发回调，queued 字段随取消清空', () => {
    // 独立上下文：闸门=1 造排队单，回调序断言不受前例影响
    const ctx = createTestContext({ maxConcurrentPerRepo: 1 });
    const occ = ctx.service.createTicket({ type: 'TASK', title: '占位' });
    ctx.service.submitSpec(occ.id, '# spec');
    ctx.service.transition(occ.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const q = ctx.service.createTicket({ type: 'TASK', title: '排队取消' });
    ctx.service.submitSpec(q.id, '# spec');
    const queued = ctx.service.transition(q.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(queued.queuedReason).toBe('GATE_QUEUED');

    const fired: number[] = [];
    ctx.service.onInflightReleased = (id) => fired.push(id!);
    const cancelled = ctx.service.transition(q.id, 'CANCELLED', 'user');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.queuedReason).toBeNull();
    expect(fired).toEqual([q.id]);
  });

  test('非挂载面不触发：DRAFT 取消、未排队 SPEC_READY 取消、system 通道取消', () => {
    const { service } = createTestContext();
    const fired: number[] = [];
    service.onInflightReleased = (id) => fired.push(id!);

    const d = service.createTicket({ type: 'TASK', title: 'd' });
    service.transition(d.id, 'CANCELLED', 'user'); // DRAFT→CANCELLED
    const s = service.createTicket({ type: 'TASK', title: 's' });
    service.submitSpec(s.id, '# spec');
    service.transition(s.id, 'CANCELLED', 'user'); // 未排队 SPEC_READY→CANCELLED（不占文件集，无位可释；排队中取消的触发面见 dispatcher 排队滞留出口用例）
    const x = service.createTicket({ type: 'TASK', title: 'x' });
    walkTo(service, x.id, 'DISPATCHED');
    service.transition(x.id, 'CANCELLED', { actor: 'system' }); // system 通道（dispatcher 直调负责）
    expect(fired).toEqual([]);
  });

  test('回调异常不抛（提交不受影响）', () => {
    const { service } = createTestContext();
    service.onInflightReleased = () => {
      throw new Error('boom');
    };
    const t = service.createTicket({ type: 'TASK', title: 't' });
    walkTo(service, t.id, 'DISPATCHED');
    const cancelled = service.transition(t.id, 'CANCELLED', 'user');
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('排队字段生命周期与双集合口径【S3】', () => {
  test('任何离开 SPEC_READY 的转移清空 queued 两字段（放行成功/取消）', () => {
    const ctx = createTestContext({ maxConcurrentPerRepo: 1 });
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '占位' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '排队' });
    ctx.service.submitSpec(t2.id, '# spec');
    const queued = ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(queued.queuedReason).toBe('GATE_QUEUED');

    // 取消边清空
    const cancelled = ctx.service.transition(t2.id, 'CANCELLED', 'user');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.queuedReason).toBeNull();
    expect(cancelled.queuedAt).toBeNull();

    // 放行成功边清空（另起一单）
    const t3 = ctx.service.createTicket({ type: 'TASK', title: '排队2' });
    ctx.service.submitSpec(t3.id, '# spec');
    ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }); // 闸门满 → 排队
    ctx.service.transition(t1.id, 'IN_PROGRESS', { actor: 'system' });
    ctx.service.transition(t1.id, 'DONE', { actor: 'system' }); // 释放闸门
    const dispatched = ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(dispatched.status).toBe('DISPATCHED');
    expect(dispatched.queuedReason).toBeNull();
    expect(dispatched.queuedAt).toBeNull();
  });

  test('双集合口径：闸门=DISPATCHED+IN_PROGRESS；占用集另含排队与 BLOCKED', () => {
    const ctx = createTestContext({ maxConcurrentPerRepo: 1 });
    const mk = (title: string, planned?: string[]) => {
      const t = ctx.service.createTicket({ type: 'TASK', title });
      ctx.service.submitSpec(t.id, '# spec', planned);
      return t.id;
    };
    const exec = mk('执行中', ['src/']);
    const blocked = mk('阻塞', ['lib/']);
    const queued = mk('排队', ['docs/']);
    const idle = mk('未排队', ['misc/']);
    const undeclared = mk('未声明');

    // blocked 先走（闸门空）：DISPATCHED → IN_PROGRESS → BLOCKED
    ctx.service.transition(blocked, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(blocked, 'IN_PROGRESS', { actor: 'system' });
    ctx.service.transition(blocked, 'BLOCKED', { actor: 'system', blockReason: 'x' });
    // exec 占闸
    ctx.service.transition(exec, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(exec, 'IN_PROGRESS', { actor: 'system' });
    // queued：闸门满落队
    ctx.service.transition(queued, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    expect(ctx.service.getTicket(queued).queuedReason).toBe('GATE_QUEUED');

    // 闸门计数：仅 exec（IN_PROGRESS）——排队与 BLOCKED 不占闸门
    expect(ctx.service.gateOccupancy('atd', 'atd')).toBe(1);
    // 占用集：exec（在途声明）+ blocked（BLOCKED 声明）+ queued（排队声明）；
    // idle 未排队 SPEC_READY 不在；undeclared 未声明不占文件集
    const holders = ctx.service.fileSetHolders('atd', 'atd');
    expect(holders.map((h) => h.id).sort((a, b) => a - b)).toEqual([exec, blocked, queued].sort((a, b) => a - b));
    // 排除自身参数
    expect(ctx.service.fileSetHolders('atd', 'atd', exec).map((h) => h.id)).not.toContain(exec);
  });

  test('reopen（终态→DISPATCHED）与 reassign（BLOCKED→DISPATCHED）不入队：瞬时超闸直执行', () => {
    const ctx = createTestContext({ maxConcurrentPerRepo: 1 });
    const t1 = ctx.service.createTicket({ type: 'TASK', title: '占位' });
    ctx.service.submitSpec(t1.id, '# spec');
    ctx.service.transition(t1.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t1.id, 'IN_PROGRESS', { actor: 'system' });

    // reassign 语义边：BLOCKED→DISPATCHED（system）——闸门满仍直执行（校验作用域仅新放行边）
    const t2 = ctx.service.createTicket({ type: 'TASK', title: '改派单', workerId: 'fake' });
    ctx.service.submitSpec(t2.id, '# spec');
    ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }); // 闸门满 → 排队
    expect(ctx.service.getTicket(t2.id).queuedReason).toBe('GATE_QUEUED');
    ctx.service.transition(t2.id, 'CANCELLED', 'user'); // 清场
    ctx.service.transition(t2.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' }); // 重开边（终态→DISPATCHED）
    const reopened = ctx.service.getTicket(t2.id);
    expect(reopened.status).toBe('DISPATCHED'); // 不入队
    expect(reopened.queuedReason).toBeNull();
    // 恢复现场：t2 收敛
    ctx.service.transition(t2.id, 'IN_PROGRESS', { actor: 'system' });
    ctx.service.transition(t2.id, 'DONE', { actor: 'system' });

    // BLOCKED→DISPATCHED（reassign 同款 system 边）
    const t3 = ctx.service.createTicket({ type: 'TASK', title: '卡点单', workerId: 'fake' });
    ctx.service.submitSpec(t3.id, '# spec');
    ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'system' }); // 闸门满 → 排队
    expect(ctx.service.getTicket(t3.id).queuedReason).toBe('GATE_QUEUED');
    ctx.service.transition(t3.id, 'CANCELLED', 'user');
    ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'user', workerId: 'fake' });
    ctx.service.transition(t3.id, 'IN_PROGRESS', { actor: 'system' });
    ctx.service.transition(t3.id, 'BLOCKED', { actor: 'system', blockReason: 'x' });
    const reassigned = ctx.service.transition(t3.id, 'DISPATCHED', { actor: 'system', workerId: 'fake' });
    expect(reassigned.status).toBe('DISPATCHED');
    expect(reassigned.queuedReason).toBeNull();
  });
});
