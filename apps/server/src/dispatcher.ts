import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { WorkerRegistry } from '@atd/worker-core';
import type { AppConfig } from './config.js';
import { comments, ticketCommits, ticketDependencies, ticketReports, tickets } from './db/schema.js';
import type * as schema from './db/schema.js';
import { AppError } from './domain/errors.js';
import type { Ticket, TicketService } from './domain/ticket-service.js';
import { startRun, renderTemplate, type RoundResult, type StartedRun } from './execution.js';
import { buildPermConfig, buildPermJson } from './perm-config.js';
import { listNewCommits, readReport } from './report.js';
import type { WorktreeManager } from './worktree.js';

/** 内存调度：单进程 Map 记录在执行轮（无队列，池化随后续版本） */
type RunningRound = { ticketId: number; round: number; pid: number; startedAt: number };

export type DispatcherDeps = {
  db: BetterSQLite3Database<typeof schema>;
  service: TicketService;
  registry: WorkerRegistry;
  config: AppConfig;
  worktree: WorktreeManager;
  /** 缺省 true：放行后自动触发 spawn；测试上下文可关闭以确定时序 */
  autoDispatch?: boolean;
  /** 测试注入：覆盖 profile timeoutMin 的超时毫秒数 */
  timeoutOverrideMs?: number;
};

/**
 * dispatch 编排：放行后建/复用 worktree → spawn → 事件流落盘 → IN_PROGRESS →
 * 进程结束按判定表分流（DONE/BLOCKED+BLOCKER/FAILED/L2 重试）；BLOCKER 裁决三路；
 * 服务重启恢复。
 */
export class Dispatcher {
  private readonly running = new Map<number, RunningRound>();

  constructor(private readonly deps: DispatcherDeps) {}

  get autoDispatch(): boolean {
    return this.deps.autoDispatch ?? true;
  }

  isRunning(ticketId: number): boolean {
    return this.running.has(ticketId);
  }

  /** 当前执行轮信息（无执行返回 null） */
  getRunningInfo(ticketId: number): { round: number; pid: number; startedAt: number } | null {
    const r = this.running.get(ticketId);
    return r ? { round: r.round, pid: r.pid, startedAt: r.startedAt } : null;
  }

  /** 放行钩子（user 放行成功后由路由触发，异步执行） */
  onDispatched(_ticket: Ticket): void {
    void this.startRound(_ticket.id);
  }

  /**
   * 执行一轮或按 L2 重试循环执行（入口态 DISPATCHED=放行 / IN_PROGRESS=重试或裁决继续）。
   * 永不 reject（异常内部处置），调用方可安全 fire-and-forget。
   */
  async startRound(ticketId: number): Promise<void> {
    let retry = true;
    while (retry) {
      retry = await this.runOnce(ticketId);
    }
  }

  /** 单轮执行；返回 true=报告缺失且重试未耗尽（L2 重试） */
  private async runOnce(ticketId: number): Promise<boolean> {
    const { service, registry, config, worktree } = this.deps;
    let run: StartedRun | null = null;
    try {
      const ticket = service.getTicket(ticketId);
      if (ticket.status !== 'DISPATCHED' && ticket.status !== 'IN_PROGRESS') {
        return false;
      }
      const profile = ticket.workerId != null ? registry.get(ticket.workerId) : undefined;
      if (!profile) {
        throw new Error(`worker 未注册或未绑定：${ticket.workerId ?? '(null)'}`);
      }

      // 步 1：建/复用 worktree
      const wtPath = worktree.allocate(ticketId);
      // 步 2：清陈旧报告（防复用误读）→ 基线 → prompt 文件
      rmSync(path.join(wtPath, 'atd-report.json'), { force: true });
      const baseline = worktree.baseline(wtPath);
      const round = ticket.round + 1;
      const logsDir = path.join(config.dataDir, 'logs');
      const promptsDir = path.join(config.dataDir, 'prompts');
      const runtimeDir = path.join(config.dataDir, 'runtime');
      for (const d of [logsDir, promptsDir, runtimeDir]) mkdirSync(d, { recursive: true });
      const promptPath = path.join(promptsDir, `t${ticketId}.r${round}.md`);
      // 轮次上下文（round>1：前轮报告 + 重开留言/重试指令）
      let promptCtx: Parameters<typeof buildPrompt>[2];
      if (round > 1) {
        const prevReports = this.deps.db
          .select({
            round: ticketReports.round,
            status: ticketReports.status,
            summary: ticketReports.summary,
            blockReason: ticketReports.blockReason,
          })
          .from(ticketReports)
          .where(eq(ticketReports.ticketId, ticketId))
          .orderBy(asc(ticketReports.round))
          .all();
        const lastUser = this.deps.db
          .select({ content: comments.content })
          .from(comments)
          .where(and(eq(comments.ticketId, ticketId), eq(comments.authorType, 'user')))
          .orderBy(desc(comments.id))
          .limit(1)
          .get();
        promptCtx = { round, prevReports, lastUserComment: lastUser?.content ?? null };
      }
      writeFileSync(promptPath, buildPrompt(ticket, wtPath, promptCtx));

      // 步 3：渲染命令（参数数组）+ 权限注入（主 OPENCODE_CONFIG_CONTENT，fallback OPENCODE_CONFIG 文件）
      // {{prompt}} 注入 prompt 全文（单参数，128KB 上限由 submitSpec 保证），文件路径仅落盘留档
      const argv = renderTemplate(profile.command, { worktree: wtPath, prompt: readFileSync(promptPath, 'utf8') });
      const permJson = buildPermJson();
      const permFile = path.join(runtimeDir, 'opencode-perm.json');
      writeFileSync(permFile, permJson);
      const env: Record<string, string> = {
        OPENCODE_CONFIG_CONTENT: permJson,
        OPENCODE_CONFIG: permFile,
      };
      // profile.timeoutMin 缺省回退 config.defaultTimeoutMin
      const timeoutMs = this.deps.timeoutOverrideMs
        ?? (profile.timeoutMin ?? this.deps.config.defaultTimeoutMin) * 60_000;
      const rawPath = path.join(logsDir, `t${ticketId}.r${round}.raw.jsonl`);
      const eventsPath = path.join(logsDir, `t${ticketId}.r${round}.events.jsonl`);

      run = startRun({
        argv,
        cwd: wtPath,
        env,
        rawPath,
        eventsPath,
        meta: {
          command: argv.join(' '),
          cwd: wtPath,
          round,
          baseline,
          timeoutMs,
          startedAt: Date.now(),
          // MUST-2 审计载体：注入键名 + deny 规则集
          permissionInjection: {
            envKeys: ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG'],
            config: buildPermConfig(),
          },
        },
        timeoutMs,
      });

      // spawn 发起失败（进程从未存在，如命令不存在/无执行权限）：pre-spawn 路径（spec §4）——
      // DISPATCHED→CANCELLED 可重新放行，不落 FAILED 终态
      if (run.pid == null || run.pid <= 0) {
        this.preSpawnFail(ticketId, new Error(`worker 进程无法启动：${argv[0]}（命令不存在或无执行权限）`));
        return false;
      }

      // 步 4：spawn 发起成功即进入执行态（round 写入）
      if (ticket.status === 'DISPATCHED') {
        service.transition(ticketId, 'IN_PROGRESS', { actor: 'system', round });
      } else {
        service.bumpRound(ticketId);
      }
      this.running.set(ticketId, { ticketId, round, pid: run.pid, startedAt: Date.now() });

      // 步 5：进程结束 → 判定表分流
      const result = await run.done;
      return this.settle(ticketId, { round, baseline, wtPath, rawPath, timeoutMs, result });
    } catch (err) {
      // 已 spawn 但状态推进失败（如并发取消）：杀掉进程组防泄漏
      if (run != null && run.pid > 0) {
        try {
          process.kill(-run.pid, 'SIGKILL');
        } catch {
          // 进程已退出
        }
      }
      this.preSpawnFail(ticketId, err);
      return false;
    } finally {
      this.running.delete(ticketId);
    }
  }

  /**
   * 判定表分流（自上而下首个命中）：
   * 超时 → FAILED；退出码非 0 → FAILED（崩溃不重试）；报告 done → DONE（commits 落库）；
   * 报告 blocked → BLOCKED + BLOCKER；报告缺失/schema 错 → L2 重试或 L3。
   * 返回 true=需要 L2 重试。
   */
  private settle(
    ticketId: number,
    ctx: { round: number; baseline: string; wtPath: string; rawPath: string; timeoutMs: number; result: RoundResult },
  ): boolean {
    const { service, config } = this.deps;
    const ticket = service.getTicket(ticketId);
    if (ticket.status !== 'IN_PROGRESS') {
      // 防御：已被并发处置（理论不可达）
      return false;
    }
    const now = Date.now();

    if (ctx.result.timedOut) {
      service.transition(ticketId, 'FAILED', { actor: 'system', note: `执行超时（第 ${ctx.round} 轮）` });
      service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `执行超时：达到 ${ctx.timeoutMs}ms 上限，进程组已终止（round=${ctx.round}；raw 日志：${ctx.rawPath}）`,
      });
      return false;
    }
    if (ctx.result.exitCode !== 0) {
      const detail = ctx.result.spawnError
        ? ctx.result.spawnError
        : `exitCode=${ctx.result.exitCode}${ctx.result.signal != null ? `, signal=${ctx.result.signal}` : ''}`;
      service.transition(ticketId, 'FAILED', { actor: 'system', note: 'worker 异常退出' });
      service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `worker 进程异常退出（${detail}），判定为崩溃不重试（round=${ctx.round}；raw 日志：${ctx.rawPath}）`,
      });
      return false;
    }

    const reportRead = readReport(ctx.wtPath);
    if (reportRead.ok && reportRead.report.status === 'done') {
      // commits 以 git 实测为准：基线 diff 落库（报告 commits 仅交叉校验，多余项留痕不采信）
      for (const sha of listNewCommits(ctx.wtPath, ctx.baseline)) {
        this.deps.db
          .insert(ticketCommits)
          .values({ ticketId, round: ctx.round, sha, createdAt: now })
          .onConflictDoNothing()
          .run();
      }
      this.deps.db
        .insert(ticketReports)
        .values({
          ticketId,
          round: ctx.round,
          status: 'done',
          summary: reportRead.report.summary,
          blockReason: null,
          createdAt: now,
        })
        .run();
      service.transition(ticketId, 'DONE', { actor: 'system', note: 'worker 报告完成' });
      // 编排链自动流转：解锁下游（有 parent 的 TASK 且其余依赖全 DONE 时自动放行）
      this.onTicketSettled(ticketId);
      return false;
    }
    if (reportRead.ok && reportRead.report.status === 'blocked') {
      this.deps.db
        .insert(ticketReports)
        .values({
          ticketId,
          round: ctx.round,
          status: 'blocked',
          summary: reportRead.report.summary,
          blockReason: reportRead.report.blockReason ?? null,
          createdAt: now,
        })
        .run();
      service.transition(ticketId, 'BLOCKED', { actor: 'system', note: 'worker 报告卡点' });
      // 首条留言=blockReason 全文
      service.createBlocker({ parentTicketId: ticketId, reason: reportRead.report.blockReason ?? '' });
      return false;
    }

    // 报告缺失/schema 错 → L2：重试未耗尽则同 worktree 重新 spawn
    if (ctx.round <= config.retryOnReportMiss) {
      return true;
    }
    service.transition(ticketId, 'BLOCKED', { actor: 'system', note: '报告缺失' });
    service.createBlocker({
      parentTicketId: ticketId,
      reason: `报告缺失/格式错误，重试 ${config.retryOnReportMiss} 次后仍失败（round=${ctx.round}）；最后一轮 raw 日志：${ctx.rawPath}`,
    });
    return false;
  }

  /** pre-spawn 运行期失败：DISPATCHED 停留 → CANCELLED + 留言；IN_PROGRESS 停留 → FAILED + 留言 */
  private preSpawnFail(ticketId: number, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      const t = this.deps.service.getTicket(ticketId);
      if (t.status === 'DISPATCHED') {
        this.deps.service.transition(ticketId, 'CANCELLED', { actor: 'system', note: '派发失败' });
        this.deps.service.addComment(ticketId, {
          authorType: 'system',
          authorName: 'atd',
          content: `派发失败：${reason}（本单已取消，为终态；如需重试请基于本单新建工单）`,
        });
      } else if (t.status === 'IN_PROGRESS') {
        this.deps.service.transition(ticketId, 'FAILED', { actor: 'system', note: '执行处置失败' });
        this.deps.service.addComment(ticketId, {
          authorType: 'system',
          authorName: 'atd',
          content: `执行处置失败：${reason}`,
        });
      }
    } catch (e) {
      console.error('[atd-dispatcher] 失败处置异常', ticketId, e);
    }
  }

  /**
   * BLOCKER 裁决：① note 留言落 BLOCKER ② BLOCKER→DONE（system）③ 按裁决转父单——
   * 此时 BLOCKER 已 DONE，父单 blockedBy 依赖门天然放行。
   */
  resolveBlocker(
    blockerId: number,
    input: { resolution: 'continue' | 'reassign' | 'abort'; note?: string; reassignWorkerId?: string },
  ): { blocker: Ticket; parent: Ticket } {    const { service, registry } = this.deps;

    const blockerRow = this.deps.db.select().from(tickets).where(eq(tickets.id, blockerId)).get();
    if (!blockerRow || blockerRow.type !== 'BLOCKER') {
      throw new AppError('RESOLUTION_INVALID', `卡点单不存在或不是 BLOCKER：#${blockerId}`);
    }
    // BLOCKED=现口径；IN_PROGRESS=历史卡点单兼容（修复前创建，裁决后自然消化）
    if (blockerRow.status !== 'BLOCKED' && blockerRow.status !== 'IN_PROGRESS') {
      throw new AppError('RESOLUTION_INVALID', `卡点单已关（当前 ${blockerRow.status}）：#${blockerId}`);
    }
    // 父单=被该 BLOCKER 阻塞的单（依赖行：父.id blockedBy blocker.id）
    const depRow = this.deps.db
      .select({ parentId: ticketDependencies.ticketId })
      .from(ticketDependencies)
      .where(eq(ticketDependencies.blockedByTicketId, blockerId))
      .limit(1)
      .get();
    if (!depRow) {
      throw new AppError('RESOLUTION_INVALID', `未找到被卡点 #${blockerId} 阻塞的父单`);
    }
    const parent = service.getTicket(depRow.parentId);
    if (parent.status !== 'BLOCKED') {
      throw new AppError('RESOLUTION_INVALID', `父单当前为 ${parent.status}，非 BLOCKED，无法裁决`);
    }
    if (input.resolution === 'reassign') {
      if (!input.reassignWorkerId) {
        throw new AppError('WORKER_REQUIRED', '改派裁决必须指定 reassignWorkerId');
      }
      if (!registry.has(input.reassignWorkerId)) {
        throw new AppError('WORKER_UNKNOWN', `worker 未注册：${input.reassignWorkerId}`);
      }
    }

    // ① 留言（裁决人=当前用户）
    if (input.note) {
      service.addComment(blockerId, { authorType: 'user', authorName: '我', content: input.note });
    }
    // ② BLOCKER 关单
    service.transition(blockerId, 'DONE', { actor: 'system', note: `裁决：${input.resolution}` });
    // ③ 父单转移 + 继续执行
    if (input.resolution === 'abort') {
      service.transition(parent.id, 'FAILED', { actor: 'system', note: '卡点裁决：终止' });
    } else if (input.resolution === 'continue') {
      service.transition(parent.id, 'IN_PROGRESS', { actor: 'system', note: '卡点裁决：继续' });
      void this.startRound(parent.id);
    } else {
      service.transition(parent.id, 'DISPATCHED', {
        actor: 'system',
        workerId: input.reassignWorkerId,
        note: '卡点裁决：改派',
      });
      void this.startRound(parent.id);
    }
    return { blocker: service.getTicket(blockerId), parent: service.getTicket(parent.id) };
  }

  /**
   * 终态重开：用户留言（即本轮指令）→ 留言落库 → 终态→DISPATCHED（user 边）→ 异步原 worktree 续跑。
   * 新一轮 prompt 由 buildPrompt 的轮次上下文构造（用户留言 + 前轮报告摘要 + spec）。
   */
  reopen(ticketId: number, input: { message: string; workerId?: string }): Ticket {
    const { service } = this.deps;
    const ticket = service.getTicket(ticketId);
    if (ticket.type !== 'TASK') {
      throw new AppError('RESOLUTION_INVALID', `仅 TASK 可重开（当前类型 ${ticket.type}）`);
    }
    if (!['DONE', 'FAILED', 'CANCELLED'].includes(ticket.status)) {
      throw new AppError('RESOLUTION_INVALID', `仅终态单可重开（当前 ${ticket.status}）`);
    }
    if (!input.message.trim()) {
      throw new AppError('VALIDATION', '重开留言不能为空');
    }
    // 留言即本轮指令（authorType=user，buildPrompt 轮次上下文按此识别）
    service.addComment(ticketId, {
      authorType: 'user',
      authorName: '我',
      content: input.message.trim(),
    });
    const reopened = service.transition(ticketId, 'DISPATCHED', {
      actor: 'user',
      note: '重开：问题未解决',
      ...(input.workerId ? { workerId: input.workerId } : {}),
    });
    this.onDispatched(reopened);
    return reopened;
  }

  /**
   * 编排链自动流转：单落定（DONE）后，检查以本单为 blockedBy 的下游 TASK——
   * 有 parent（编排链节点）且处于 SPEC_READY、其余依赖全部 DONE 时自动放行。
   * 独立单（无 parent）不自动放行（保持人工控制）。
   */
  onTicketSettled(ticketId: number): void {
    const { service, db } = this.deps;
    let downstream: { id: number }[] = [];
    try {
      downstream = db
        .select({ id: ticketDependencies.ticketId })
        .from(ticketDependencies)
        .where(eq(ticketDependencies.blockedByTicketId, ticketId))
        .all();
    } catch {
      return;
    }
    for (const row of downstream) {
      try {
        const t = service.getTicket(row.id);
        // 仅对已预绑定 worker 的编排链节点自动放行——未定谁干活的不自动开工（留人工）
        if (t.type !== 'TASK' || t.status !== 'SPEC_READY' || t.parentId == null || !t.workerId) continue;
        // 其余依赖是否全部 DONE
        const deps = db
          .select({ status: tickets.status })
          .from(ticketDependencies)
          .innerJoin(tickets, eq(ticketDependencies.blockedByTicketId, tickets.id))
          .where(eq(ticketDependencies.ticketId, row.id))
          .all();
        if (deps.every((d) => d.status === 'DONE')) {
          const dispatched = service.transition(row.id, 'DISPATCHED', {
            actor: 'system',
            note: '编排链依赖满足，自动放行',
          });
          this.onDispatched(dispatched);
        }
      } catch (e) {
        // 单个下游放行失败不阻断其他下游
        console.error('[atd-dispatcher] 自动放行失败', row.id, e);
      }
    }
  }

  /** 服务重启恢复：执行单进程已随重启消亡——IN_PROGRESS→FAILED；DISPATCHED→CANCELLED（均附留言） */
  recoverOnStartup(): void {
    const { service } = this.deps;
    const rows = this.deps.db
      .select()
      .from(tickets)
      .where(inArray(tickets.status, ['DISPATCHED', 'IN_PROGRESS']))
      .all()
      .filter((r) => r.type === 'TASK');
    for (const row of rows) {
      try {
        if (row.status === 'IN_PROGRESS') {
          service.transition(row.id, 'FAILED', { actor: 'system', note: '服务重启中断' });
          service.addComment(row.id, {
            authorType: 'system',
            authorName: 'atd',
            content: '服务重启中断：执行进程已消亡，判定为失败（重试语义随后续版本接管）',
          });
        } else {
          service.transition(row.id, 'CANCELLED', { actor: 'system', note: '派发失败（服务重启）' });
          service.addComment(row.id, {
            authorType: 'system',
            authorName: 'atd',
            content: '派发失败：服务重启时停留在派发态（本单已取消，为终态；如需重试请基于本单新建工单）',
          });
        }
      } catch (err) {
        console.error('[atd-dispatcher] 重启恢复失败', row.id, err);
      }
    }
  }
}

/** prompt 构造：工作目录约束 + 轮次上下文 + spec 快照 + 报告要求 + 完成定义 */
function buildPrompt(
  ticket: Ticket,
  worktreePath: string,
  ctx?: {
    round: number;
    prevReports: { round: number; status: string; summary: string | null; blockReason: string | null }[];
    lastUserComment: string | null;
  },
): string {
  const sections: string[] = [
    `# 工单 #${ticket.id}：${ticket.title}`,
    '',
    '## 工作目录（最高优先级约束）',
    `你被派发在独立 worktree 中作业，其绝对路径为：${worktreePath}`,
    '- 所有 shell 命令必须以该路径为 workdir（或先 cd 到该路径）；严禁在其他目录（尤其主仓工作区）执行任何读写或 git 操作',
    '- 该 worktree 的分支与文件即你的作业范围；worktree 根目录下的 .git 是指针文件属正常现象，以 pwd/ls 所见为准',
    '',
  ];
  // 轮次上下文（round>1：重开或 L2 重试——认知连续性靠前轮报告 + 用户最新指令）
  if (ctx && ctx.round > 1) {
    sections.push('## 轮次上下文（本工单已执行过前序轮次）', '');
    for (const r of ctx.prevReports) {
      sections.push(`- 第 ${r.round} 轮（${r.status}）：${r.summary ?? r.blockReason ?? '（无摘要）'}`);
    }
    if (ctx.lastUserComment) {
      sections.push('', `**用户对本轮的指令（重开留言，最高优先执行）**：${ctx.lastUserComment}`);
    } else {
      sections.push('', '**本轮指令**：继续完成工单任务（前轮未产出有效完成报告）。');
    }
    sections.push('', 'worktree 中已存在的文件与 git 历史是前序轮次的工作成果，先检视再行动，避免重复或破坏。', '');
  }
  sections.push(
    '## 任务 spec（快照）',
    ticket.specContent ?? '（无 spec 内容）',
    '',
    '## 执行要求',
    '- 在 worktree 内完成任务，可修改文件并用 git commit 提交；禁止任何形式的 push 或远端操作',
    '- 完成后在 worktree 根目录写入 atd-report.json（UTF-8 JSON）：',
    '  {"status":"done|blocked","summary":"一句话完成摘要（中文）","commits":["<sha>"],"blockReason":"blocked 时必填：上下文+建议选项+影响面"}',
    '- status=done 表示任务完成；status=blocked 表示遇到无法自行解决的卡点，需人工裁决',
    '- 纯调研等零 commit 情况合法，在 summary 中说明即可',
    '',
  );
  return sections.join('\n');
}
