import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { loadRegistry } from '@atd/worker-core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import type { Dispatcher } from '../../src/dispatcher.js';
import type { TicketService } from '../../src/domain/ticket-service.js';
import type { PlanIssue } from '../../src/humanthink/plan.js';
import { buildWorkspaceFixture, makeTempRepo } from '../helpers.js';
import { createFakeServe, type FakeServe } from './fake-serve.js';

/**
 * S2b2 计划端点（validate/confirm）：校验单源全规则 + 原子建单 + 根任务放行触发 +
 * 排队衔接 + 跨仓 + 多轮成链 + 端点门卫 + 泳道数据回归。
 * 经 buildServer 全装配（enabled:true + 假 serve 注入），HTTP inject 驱动；
 * 放行断言以状态转移留痕为准（autoDispatch 旁路态下 spawn 异步推进不参与断言）。
 */

type PlanContext = {
  app: FastifyInstance;
  fake: FakeServe;
  start: () => Promise<void>;
  service: TicketService;
  dispatcher: Dispatcher;
};

/** interactive worker（oc，兼任计划任务执行者）+ atd workspace（主仓+可读仓 docs） */
function createPlanContext(opts: { maxConcurrentPerRepo?: number } = {}): PlanContext {
  const db = createDatabase(':memory:');
  const workersDir = mkdtempSync(path.join(tmpdir(), 'plwk-'));
  writeFileSync(
    path.join(workersDir, 'oc.yaml'),
    [
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
      dataDir: mkdtempSync(path.join(tmpdir(), 'pldd-')),
      defaultTimeoutMin: 5,
      maxConcurrentPerRepo: opts.maxConcurrentPerRepo ?? 2,
      maxRetries: 3,
      retryBackoffSec: 60,
      humanthinkPort: 4981,
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
  return {
    app: built.app,
    fake,
    start: built.humanthinkStart!,
    service: built.runtime.service,
    dispatcher: built.runtime.dispatcher,
  };
}

/** 建会话（worker=oc，workspace=atd）并启动 serve */
async function newSession(ctx: PlanContext): Promise<string> {
  await ctx.start();
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/humanthink/sessions',
    payload: { workerId: 'oc', workspaceId: 'atd', title: '拆单会话' },
  });
  return (res.json() as { session: { id: string } }).session.id;
}

/** 计划缺省形态：t1 无依赖（根任务），t2 依赖 t1 */
function plan(overrides: {
  story?: { title?: string; description?: string };
  tasks?: Array<Record<string, unknown>>;
} = {}): Record<string, unknown> {
  return {
    story: { title: overrides.story?.title ?? '登录重构', description: overrides.story?.description ?? '把登录流程改为统一身份服务' },
    tasks:
      overrides.tasks ??
      [
        { id: 't1', title: '梳理登录链路', spec: '梳理现有登录链路并产出业务口径说明', workerId: 'oc' },
        { id: 't2', title: '切换身份服务', spec: '将登录切换到统一身份服务', workerId: 'oc', dependsOn: ['t1'] },
      ],
  };
}

async function validate(ctx: PlanContext, sessionId: string, payload: Record<string, unknown>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/humanthink/sessions/${sessionId}/plan/validate`,
    payload: payload as object,
  });
  return { status: res.statusCode, body: res.json() as { issues?: PlanIssue[]; error?: { code: string } } };
}

async function confirm(ctx: PlanContext, sessionId: string, payload: Record<string, unknown>) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/humanthink/sessions/${sessionId}/plan/confirm`,
    payload: payload as object,
  });
  return res;
}

describe('计划校验单源（validate 端点，200 恒定）【S2b2】', () => {
  test('合法计划通过：repoRef 缺省/显式、尾斜杠目录、跨仓 readable 均合法', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r = await validate(ctx, sid, plan({
      tasks: [
        { id: 't1', title: 'A', spec: '做 A', workerId: 'oc', plannedFiles: ['src/', 'a.ts'] },
        { id: 't2', title: 'B', spec: '做 B', workerId: 'oc', repoRef: 'docs', dependsOn: ['t1'] },
      ],
    }));
    expect(r.status).toBe(200);
    expect(r.body.issues).toEqual([]);
    await ctx.app.close();
  });

  test('repoRef 越界 → field=repoRef（message 含可选值域）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r = await validate(ctx, sid, plan({ tasks: [{ id: 't1', title: 'A', spec: '做 A', workerId: 'oc', repoRef: 'nope' }] }));
    expect(r.body.issues).toEqual([
      { taskId: 't1', field: 'repoRef', message: expect.stringContaining('repoRef 不在 workspace atd 仓清单：nope') },
    ]);
    expect(r.body.issues![0]!.message).toContain('可选：atd, docs');
    await ctx.app.close();
  });

  test('worker 未注册/已移除 → field=workerId', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r = await validate(ctx, sid, plan({ tasks: [{ id: 't1', title: 'A', spec: '做 A', workerId: 'ghost' }] }));
    expect(r.body.issues).toHaveLength(1);
    expect(r.body.issues![0]).toMatchObject({ taskId: 't1', field: 'workerId' });
    await ctx.app.close();
  });

  test('局部 id 重复/为空 → field=id；标题与 spec 空 → field=title/spec', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r = await validate(ctx, sid, plan({
      story: { title: '   ' },
      tasks: [
        { id: 't1', title: '', spec: '做 A', workerId: 'oc' },
        { id: 't1', title: 'B', spec: ' ', workerId: 'oc' },
      ],
    }));
    const fields = r.body.issues!.map((i) => `${i.field}:${i.taskId ?? 'story'}`).sort();
    expect(fields).toEqual(['id:t1', 'spec:t1', 'title:story', 'title:t1']);
    await ctx.app.close();
  });

  test('dependsOn 引用计划外 id / 条目重复 / 成环（含自依赖）→ field=dependsOn', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r1 = await validate(ctx, sid, plan({ tasks: [{ id: 't1', title: 'A', spec: '做 A', workerId: 'oc', dependsOn: ['t9'] }] }));
    expect(r1.body.issues).toEqual([{ taskId: 't1', field: 'dependsOn', message: expect.stringContaining('本计划外的 id：t9') }]);
    const r2 = await validate(ctx, sid, plan({ tasks: [{ id: 't1', title: 'A', spec: '做 A', workerId: 'oc', dependsOn: ['t1', 't1'] }] }));
    expect(r2.body.issues!.every((i) => i.field === 'dependsOn')).toBe(true);
    expect(r2.body.issues!.some((i) => i.message.includes('重复'))).toBe(true);
    const r3 = await validate(ctx, sid, plan({
      tasks: [
        { id: 't1', title: 'A', spec: '做 A', workerId: 'oc', dependsOn: ['t2'] },
        { id: 't2', title: 'B', spec: '做 B', workerId: 'oc', dependsOn: ['t1'] },
      ],
    }));
    expect(r3.body.issues).toHaveLength(2);
    expect(r3.body.issues!.every((i) => i.field === 'dependsOn' && i.message.includes('成环'))).toBe(true);
    await ctx.app.close();
  });

  test('plannedFiles 形态：绝对路径/.. 上跳/反斜杠 → field=plannedFiles（相对路径合法）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r = await validate(ctx, sid, plan({
      tasks: [{ id: 't1', title: 'A', spec: '做 A', workerId: 'oc', plannedFiles: ['/etc/passwd', '../x.ts', 'a\\b.ts', 'src/'] }],
    }));
    expect(r.body.issues).toEqual([
      { taskId: 't1', field: 'plannedFiles', message: expect.stringContaining('/etc/passwd, ../x.ts, a\\b.ts') },
    ]);
    await ctx.app.close();
  });

  test('spec 超过 128KB 上限 → field=spec（冻结点前置拦截）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const r = await validate(ctx, sid, plan({ tasks: [{ id: 't1', title: 'A', spec: 'x'.repeat(128 * 1024 + 1), workerId: 'oc' }] }));
    expect(r.body.issues).toEqual([{ taskId: 't1', field: 'spec', message: expect.stringContaining('128KB') }]);
    await ctx.app.close();
  });

  test('body 形态错走 400 VALIDATION 信封（空任务数组/缺 workerId/类型错）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    for (const bad of [plan({ tasks: [] }), { story: { title: 's' }, tasks: [{ id: 't1', title: 'A', spec: 's' }] }, { story: null, tasks: [] }]) {
      const r = await validate(ctx, sid, bad);
      expect(r.status).toBe(400);
      expect(r.body.error?.code).toBe('VALIDATION');
    }
    await ctx.app.close();
  });
});

describe('confirm 原子建单与根任务放行【S2b2】', () => {
  test('建单全链落库：STORY+TASK+依赖+worker 预绑定+spec/plannedFiles 冻结+跨仓 repoRef 落实际值', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const res = await confirm(ctx, sid, plan({
      tasks: [
        { id: 't1', title: '梳理', spec: '梳理登录链路', workerId: 'oc', plannedFiles: ['src/'] },
        { id: 't2', title: '切仓改造', spec: '在 docs 仓落地说明文档', workerId: 'oc', repoRef: 'docs', dependsOn: ['t1'] },
      ],
    }));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; story: { id: number }; tasks: Array<{ localId: string; id: number }> };
    expect(body.ok).toBe(true);
    const story = ctx.service.getTicket(body.story.id);
    expect(story.type).toBe('STORY');
    expect(story.status).toBe('DRAFT');
    expect(story.description).toBe('把登录流程改为统一身份服务');
    expect(story.workspaceId).toBe('atd');
    const byLocal = new Map(body.tasks.map((t) => [t.localId, t.id]));
    // t1：repoRef 缺省=主仓 id 落库实际值；t2：跨仓 readable 落 docs
    const t1 = ctx.service.getTicket(byLocal.get('t1')!);
    const t2 = ctx.service.getTicket(byLocal.get('t2')!);
    expect([t1.repoRef, t2.repoRef]).toEqual(['atd', 'docs']);
    expect(t1.parentId).toBe(story.id);
    expect(t2.parentId).toBe(story.id);
    expect(t1.workerId).toBe('oc');
    // spec/文件集冻结（根任务已同步放行、异步 spawn 推进中——冻结字段与状态无关，活状态以转移留痕断言）
    expect(t1.specContent).toBe('梳理登录链路');
    expect(t1.plannedFiles).toEqual(['src/']);
    expect(ctx.service.getTicketDetail(t1.id).transitions.some((x) => x.toStatus === 'SPEC_READY')).toBe(true);
    expect(ctx.service.getTicket(t2.id).status).toBe('SPEC_READY');
    // 依赖边：t2 blockedBy t1（真实单号）
    const d2 = ctx.service.getTicketDetail(t2.id);
    expect(d2.dependencies.map((d) => d.id)).toEqual([t1.id]);
    await ctx.app.close();
  });

  test('根任务放行触发：无依赖任务 DISPATCHED 留痕（编排链依赖满足），有依赖任务保持 SPEC_READY', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const res = await confirm(ctx, sid, plan());
    const body = res.json() as { ok: boolean; tasks: Array<{ localId: string; id: number }> };
    expect(body.ok).toBe(true);
    const byLocal = new Map(body.tasks.map((t) => [t.localId, t.id]));
    const t1 = byLocal.get('t1')!;
    const t2 = byLocal.get('t2')!;
    // 根任务：事务提交后同步放行——transitions 留痕（后续异步 spawn 推进不参与断言）
    const d1 = ctx.service.getTicketDetail(t1);
    expect(d1.transitions.some((x) => x.toStatus === 'DISPATCHED' && x.note === '编排链依赖满足，自动放行')).toBe(true);
    expect(ctx.service.getTicket(t1).queuedReason).toBeNull();
    // 有依赖任务：上游未 DONE 不放行
    const t2row = ctx.service.getTicket(t2);
    expect(t2row.status).toBe('SPEC_READY');
    expect(ctx.service.getTicketDetail(t2).transitions.every((x) => x.toStatus !== 'DISPATCHED')).toBe(true);
    await ctx.app.close();
  });

  test('校验失败 → 200 双态 {ok:false, issues} 且零建单', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const res = await confirm(ctx, sid, plan({ tasks: [{ id: 't1', title: 'A', spec: '做 A', workerId: 'ghost' }] }));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; issues: PlanIssue[] };
    expect(body.ok).toBe(false);
    expect(body.issues).toEqual([{ taskId: 't1', field: 'workerId', message: expect.stringContaining('ghost') }]);
    expect(ctx.service.listTickets()).toHaveLength(0);
    await ctx.app.close();
  });

  test('原子性：建单中途失败全量回滚（addDependency 抛错 → 500 + 零残留）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const spy = vi.spyOn(ctx.service, 'addDependency').mockImplementation(() => {
      throw new Error('注入失败');
    });
    const res = await confirm(ctx, sid, plan());
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INTERNAL');
    expect(ctx.service.listTickets()).toHaveLength(0);
    await ctx.app.close();
  });

  test('排队衔接：闸门满（maxConcurrentPerRepo=1 被占）→ 根任务落 GATE_QUEUED 排队非失败', async () => {
    const ctx = createPlanContext({ maxConcurrentPerRepo: 1 });
    const sid = await newSession(ctx);
    // 预占闸门：同仓独立 TASK 直推 DISPATCHED（service 直调不触发 spawn）
    const occupant = ctx.service.createTicket({ type: 'TASK', title: '占位单' });
    ctx.service.submitSpec(occupant.id, '# spec');
    ctx.service.transition(occupant.id, 'DISPATCHED', { actor: 'user', workerId: 'oc' });
    const res = await confirm(ctx, sid, plan({ tasks: [{ id: 't1', title: '根任务', spec: '做 A', workerId: 'oc' }] }));
    const body = res.json() as { ok: boolean; tasks: Array<{ localId: string; id: number }> };
    expect(body.ok).toBe(true);
    const root = ctx.service.getTicket(body.tasks[0]!.id);
    expect(root.status).toBe('SPEC_READY');
    expect(root.queuedReason).toBe('GATE_QUEUED');
    expect(root.workerId).toBe('oc');
    expect(ctx.service.getTicketDetail(root.id).transitions.every((x) => x.toStatus !== 'DISPATCHED')).toBe(true);
    await ctx.app.close();
  });

  test('多轮各自成链：同一会话两次 confirm 独立 STORY、局部 id 互不串（验收 6）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const first = ((await confirm(ctx, sid, plan())).json() as { story: { id: number }; tasks: Array<{ localId: string; id: number }> });
    const second = ((await confirm(ctx, sid, plan({
      story: { title: '导出功能', description: '支持导出工单' },
      tasks: [{ id: 't1', title: '实现导出', spec: '实现工单导出', workerId: 'oc' }],
    }))).json() as { story: { id: number }; tasks: Array<{ localId: string; id: number }> });
    expect(first.story.id).not.toBe(second.story.id);
    // 两轮各自的 t1 映射到不同真实单号
    const t1a = first.tasks.find((t) => t.localId === 't1')!.id;
    const t1b = second.tasks.find((t) => t.localId === 't1')!.id;
    expect(t1a).not.toBe(t1b);
    // 互不影响：第一轮 STORY 子单数仍为 2，且子单归属正确
    const d1 = ctx.service.getTicketDetail(first.story.id);
    const d2 = ctx.service.getTicketDetail(second.story.id);
    expect(d1.children).toHaveLength(2);
    expect(d2.children.map((c) => c.id)).toEqual([t1b]);
    expect(d1.children.every((c) => c.id !== t1b)).toBe(true);
    await ctx.app.close();
  });

  test('泳道数据回归：STORY 详情含子单与依赖分层（验收 5 既有能力）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    const body = ((await confirm(ctx, sid, plan())).json() as { story: { id: number }; tasks: Array<{ localId: string; id: number }> });
    const res = await ctx.app.inject({ method: 'GET', url: `/api/tickets/${body.story.id}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as { children: Array<{ id: number; status: string }>; dependencies: unknown[] };
    expect(detail.children.map((c) => c.id)).toEqual(body.tasks.map((t) => t.id));
    // 下游任务详情的 dependencies 呈现链分层（泳道数据源）
    const t2 = body.tasks.find((t) => t.localId === 't2')!.id;
    const t1 = body.tasks.find((t) => t.localId === 't1')!.id;
    const d2 = (await ctx.app.inject({ method: 'GET', url: `/api/tickets/${t2}` })).json() as { dependencies: Array<{ id: number }> };
    expect(d2.dependencies.map((d) => d.id)).toEqual([t1]);
    await ctx.app.close();
  });
});

describe('plan 端点门卫（degraded 503 / 已删 422 三分 / 未知 404）【S2b2】', () => {
  test('serve 未就绪（idle）→ validate/confirm 503 WORKER_UNAVAILABLE', async () => {
    const ctx = createPlanContext();
    // 不调 start()——serve 停留 idle，全端点 degraded
    for (const url of ['/api/humanthink/sessions/ses_x/plan/validate', '/api/humanthink/sessions/ses_x/plan/confirm']) {
      const res = await ctx.app.inject({ method: 'POST', url, payload: plan() });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('WORKER_UNAVAILABLE');
    }
    await ctx.app.close();
  });

  test('已删会话 → validate/confirm 一律 422 SESSION_TERMINATED（历史详情仍可查）', async () => {
    const ctx = createPlanContext();
    const sid = await newSession(ctx);
    await ctx.app.inject({ method: 'DELETE', url: `/api/humanthink/sessions/${sid}` });
    for (const [url, payload] of [
      [`/api/humanthink/sessions/${sid}/plan/validate`, plan()],
      [`/api/humanthink/sessions/${sid}/plan/confirm`, plan()],
    ] as const) {
      const res = await ctx.app.inject({ method: 'POST', url, payload: payload as object });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe('SESSION_TERMINATED');
    }
    expect(ctx.service.listTickets()).toHaveLength(0);
    await ctx.app.close();
  });

  test('未知会话 → 404 SESSION_NOT_FOUND', async () => {
    const ctx = createPlanContext();
    await ctx.start();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/humanthink/sessions/ses_ghost/plan/validate', payload: plan() });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('SESSION_NOT_FOUND');
    await ctx.app.close();
  });
});
