import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { WorkerRegistry } from '@atd/worker-core';
import { MAX_SPEC_BYTES } from '../domain/ticket-service.js';
import { z } from 'zod';
import type * as schema from '../db/schema.js';
import type { TicketService } from '../domain/ticket-service.js';
import type { Workspace } from '../workspaces.js';

/**
 * 编排计划（S2b2）：PlanPayload zod schema（validate/confirm 两端共用一字面）+
 * 校验单源（validatePlan）+ 原子建单编排（confirmPlan）。
 * 草稿活在会话文本中，服务端不存计划——confirm 提交的即最终态。
 */

/** spec 快照长度上限——单源引自 ticket-service（prompt=spec+执行要求，冻结点拦截） */

/** 计划 payload（契约冻结；形态源头——routes/types.ts 手抄镜像参照） */
export const planPayloadSchema = z.object({
  story: z.object({
    title: z.string(),
    description: z.string(),
  }),
  tasks: z
    .array(
      z.object({
        /** 计划内局部短 id（如 t1），仅用于本计划内依赖引用 */
        id: z.string(),
        title: z.string(),
        spec: z.string(),
        /** 缺省=所属 workspace 主仓 id */
        repoRef: z.string().optional(),
        workerId: z.string(),
        dependsOn: z.array(z.string()).optional(),
        /** 声明文件集形态同 S3 submitSpec（相对 repoRef 路径；`dir/` 尾斜杠=目录递归；空数组视同未声明） */
        plannedFiles: z.array(z.string().min(1, '文件路径不能为空')).optional(),
      }),
    )
    .min(1, '计划至少包含一个任务'),
});

export type PlanPayload = z.infer<typeof planPayloadSchema>;
export type PlanTask = PlanPayload['tasks'][number];

/** 校验问题定位字段（值域冻结七值；taskId 定位计划内任务，story 级问题省略） */
export type PlanIssueField = 'repoRef' | 'workerId' | 'dependsOn' | 'plannedFiles' | 'id' | 'title' | 'spec';

/** 校验问题（message 中文人话；web 计划卡按 taskId+field 标红定位） */
export type PlanIssue = { taskId?: string; field: PlanIssueField; message: string };

/** 校验依赖：会话归属 workspace（repoRef 取值域）+ worker 注册表现状（workerId 取值域） */
export type PlanValidationDeps = { ws: Workspace; registry: WorkerRegistry };

/**
 * 计划校验单源（validate 端点与 confirm 建单前置共用，不另起双轨）：
 * 局部 id 唯一 / 标题与 spec 非空且 spec 不超限 / repoRef ∈ workspace repos（缺省=主仓）/
 * workerId ∈ Registry 现状 / dependsOn ⊆ 本计划 id 集 + 无环无重复 /
 * plannedFiles 相对路径形态（同 S3 尾斜杠语义）。返回空数组=通过。
 */
export function validatePlan(payload: PlanPayload, deps: PlanValidationDeps): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const { ws, registry } = deps;

  if (!payload.story.title.trim()) {
    issues.push({ field: 'title', message: '故事标题不能为空' });
  }

  // 局部 id：非空 + 计划内唯一
  const ids = new Set<string>();
  for (const t of payload.tasks) {
    if (!t.id.trim()) {
      issues.push({ taskId: t.id, field: 'id', message: '任务 id 不能为空' });
    } else if (ids.has(t.id)) {
      issues.push({ taskId: t.id, field: 'id', message: `任务 id 在计划内重复：${t.id}` });
    } else {
      ids.add(t.id);
    }
  }

  const repoIds = ws.repos.map((r) => r.id);
  for (const t of payload.tasks) {
    if (!t.title.trim()) {
      issues.push({ taskId: t.id, field: 'title', message: `任务 ${t.id} 标题不能为空` });
    }
    if (!t.spec.trim()) {
      issues.push({ taskId: t.id, field: 'spec', message: `任务 ${t.id} spec 不能为空` });
    } else if (Buffer.byteLength(t.spec, 'utf8') > MAX_SPEC_BYTES) {
      issues.push({ taskId: t.id, field: 'spec', message: `任务 ${t.id} spec 超过 ${MAX_SPEC_BYTES / 1024}KB 上限（prompt 长度约束）` });
    }
    const ref = t.repoRef ?? ws.primary;
    if (!repoIds.includes(ref)) {
      issues.push({
        taskId: t.id,
        field: 'repoRef',
        message: `任务 ${t.id} 的 repoRef 不在 workspace ${ws.id} 仓清单：${ref}（可选：${repoIds.join(', ') || '（无）'}）`,
      });
    }
    if (!registry.has(t.workerId)) {
      issues.push({
        taskId: t.id,
        field: 'workerId',
        message: `任务 ${t.id} 的 worker 未注册或已移除：${t.workerId}（可选：${registry.ids().join(', ') || '（无）'}）`,
      });
    }
    // dependsOn：仅限本计划 id 集 + 条目不重复
    const seen = new Set<string>();
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) {
        issues.push({ taskId: t.id, field: 'dependsOn', message: `任务 ${t.id} 依赖了本计划外的 id：${dep}` });
      } else if (seen.has(dep)) {
        issues.push({ taskId: t.id, field: 'dependsOn', message: `任务 ${t.id} 的依赖条目重复：${dep}` });
      } else {
        seen.add(dep);
      }
    }
    // plannedFiles：相对路径形态（不含盘符/绝对前缀/../.. 上跳段；尾斜杠目录递归语义合法）
    const badPaths = (t.plannedFiles ?? []).filter((p) => !isRelativeRepoPath(p));
    if (badPaths.length > 0) {
      issues.push({
        taskId: t.id,
        field: 'plannedFiles',
        message: `任务 ${t.id} 的文件路径须为相对仓根路径且不含 .. ：${badPaths.join(', ')}`,
      });
    }
  }

  // 依赖环：沿 dependsOn 邻接表，从每个任务出发能回到自身即成环（含自依赖）
  const graph = new Map<string, string[]>();
  for (const t of payload.tasks) graph.set(t.id, (t.dependsOn ?? []).filter((d) => ids.has(d)));
  for (const t of payload.tasks) {
    if (reachesBack(graph, t.id)) {
      issues.push({ taskId: t.id, field: 'dependsOn', message: `任务 ${t.id} 的依赖成环（含自依赖），环上任务需拆解` });
    }
  }

  return issues;
}

/** 相对仓根路径形态：非绝对（无前导 /、无盘符）、无反斜杠、无 .. 段 */
function isRelativeRepoPath(p: string): boolean {
  if (p.startsWith('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split('/').includes('..');
}

/** 从 start 沿依赖边 DFS 是否回到自身（环成员判定） */
function reachesBack(graph: Map<string, string[]>, start: string): boolean {
  const stack = [...(graph.get(start) ?? [])];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === start) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    stack.push(...(graph.get(cur) ?? []));
  }
  return false;
}

/** confirm 成功结果（局部 id → 真实单号映射） */
export type PlanConfirmOk = { ok: true; story: { id: number }; tasks: Array<{ localId: string; id: number }> };

/** confirm 结果（200 双态：通过=建单映射；失败=问题清单且零建单） */
export type PlanConfirmResult = PlanConfirmOk | { ok: false; issues: PlanIssue[] };

export type ConfirmPlanDeps = PlanValidationDeps & {
  db: BetterSQLite3Database<typeof schema>;
  service: TicketService;
  /** 建单事务提交后的放行触发（confirm 不在事务内放行——闸门满落 S3 排队，不破坏原子性语义） */
  onCommitted: (storyId: number) => void;
};

/**
 * 原子建单：校验（单源）→ 外层事务（建 STORY → 逐任务建 TASK（预绑定 worker+落库实际 repoRef）→
 * addDependency（局部 id→真实 id 映射）→ 逐任务 submitSpec 冻结）→ 提交后同步触发根任务放行。
 * 事务回调内只写同步代码（better-sqlite3 同步语义；嵌套 service 事务走 savepoint，外层抛错全量回滚）。
 */
export function confirmPlan(payload: PlanPayload, deps: ConfirmPlanDeps): PlanConfirmResult {
  const issues = validatePlan(payload, deps);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const built = deps.db.transaction(() => {
    const story = deps.service.createTicket({
      type: 'STORY',
      title: payload.story.title,
      description: payload.story.description,
      workspaceId: deps.ws.id,
    });
    const localToId = new Map<string, number>();
    for (const t of payload.tasks) {
      const task = deps.service.createTicket({
        type: 'TASK',
        title: t.title,
        parentId: story.id,
        workerId: t.workerId,
        workspaceId: deps.ws.id,
        repoRef: t.repoRef ?? deps.ws.primary,
      });
      localToId.set(t.id, task.id);
    }
    for (const t of payload.tasks) {
      for (const dep of t.dependsOn ?? []) {
        deps.service.addDependency(localToId.get(t.id)!, localToId.get(dep)!);
      }
    }
    for (const t of payload.tasks) {
      deps.service.submitSpec(localToId.get(t.id)!, t.spec, t.plannedFiles ?? null);
    }
    return { storyId: story.id, localToId };
  });
  // 事务提交后同步调用（不在事务内）——放行失败面=排队非错误
  deps.onCommitted(built.storyId);
  return {
    ok: true,
    story: { id: built.storyId },
    tasks: payload.tasks.map((t) => ({ localId: t.id, id: built.localToId.get(t.id)! })),
  };
}
