import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { WorkerRegistry } from '@atd/worker-core';
import type { AppConfig } from './config.js';
import { comments, ticketCommits, ticketDependencies, ticketFiles, ticketReports, tickets } from './db/schema.js';
import type * as schema from './db/schema.js';
import { AppError } from './domain/errors.js';
import { intersectingPaths } from './domain/file-set.js';
import type { Ticket, TicketService } from './domain/ticket-service.js';
import { startRun, renderTemplate, type RoundResult, type StartedRun } from './execution.js';
import { buildPermConfig, buildPermJson } from './perm-config.js';
import { extractTouchedFiles, listNewCommits, readReport } from './report.js';
import type { WorktreeManager } from './worktree.js';
import type { WorkspaceRegistry } from './workspaces.js';

/** 内存调度：单进程 Map 记录在执行轮（无队列，池化随后续版本） */
type RunningRound = { ticketId: number; round: number; pid: number; startedAt: number };

export type DispatcherDeps = {
  db: BetterSQLite3Database<typeof schema>;
  service: TicketService;
  registry: WorkerRegistry;
  config: AppConfig;
  worktree: WorktreeManager;
  /** workspace 注册表：按工单挂载解析目标仓路径（跨仓执行的地基） */
  workspaces: WorkspaceRegistry;
  /** 缺省 true：放行后自动触发 spawn；测试上下文可关闭以确定时序 */
  autoDispatch?: boolean;
  /** 测试注入：覆盖 profile timeoutMin 的超时毫秒数 */
  timeoutOverrideMs?: number;
  /** RETRY_WAIT 到期扫描周期（ms），缺省 5000；测试注入缩短构造确定时序 */
  tickIntervalMs?: number;
  /** 时钟注入（缺省 Date.now）：RETRY_WAIT 退避断言经此构造 */
  now?: () => number;
};

/**
 * dispatch 编排：放行后建/复用 worktree → spawn → 事件流落盘 → IN_PROGRESS →
 * 进程结束按判定表分流（DONE/BLOCKED+BLOCKER/FAILED/L2 重试）；BLOCKER 裁决三路；
 * 服务重启恢复。
 */
export class Dispatcher {
  private readonly running = new Map<number, RunningRound>();
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DispatcherDeps) {}

  get autoDispatch(): boolean {
    return this.deps.autoDispatch ?? true;
  }

  /** 时钟（缺省 Date.now；测试注入构造退避断言） */
  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** RETRY_WAIT 到期扫描周期（ms） */
  private tickIntervalMs(): number {
    return this.deps.tickIntervalMs ?? 5_000;
  }

  /** 启动 RETRY_WAIT 到期扫描（buildServer 装配时挂载；unref 不阻进程退出，清理挂 Fastify onClose） */
  startTick(): void {
    if (this.tickTimer != null) return;
    const t = setInterval(() => this.onTick(), this.tickIntervalMs());
    t.unref?.();
    this.tickTimer = t;
  }

  /** 停止扫描（Fastify onClose 钩子调用） */
  stopTick(): void {
    if (this.tickTimer != null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
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
   * 执行一轮（入口态 DISPATCHED=放行或排队唤醒 / IN_PROGRESS=裁决继续）。
   * 永不 reject（异常内部处置），调用方可安全 fire-and-forget；
   * 报告缺失/schema 错不再原地续跑——转入 BLOCKED(pending:agent) 由 RETRY_WAIT 引擎接管。
   */
  async startRound(ticketId: number): Promise<void> {
    await this.runOnce(ticketId);
  }

  /** 单轮执行；结束按判定表分流（DONE/卡点 BLOCKED/FAILED/RETRY_WAIT） */
  private async runOnce(ticketId: number): Promise<void> {
    const { service, registry, config, worktree, workspaces } = this.deps;
    let run: StartedRun | null = null;
    try {
      const ticket = service.getTicket(ticketId);
      if (ticket.status !== 'DISPATCHED' && ticket.status !== 'IN_PROGRESS') {
        return;
      }
      const profile = ticket.workerId != null ? registry.get(ticket.workerId) : undefined;
      if (!profile) {
        throw new Error(`worker 未注册或未绑定：${ticket.workerId ?? '(null)'}`);
      }
      // 步 0：按工单挂载解析目标仓（yaml 漂移解析失败 → 既有 preSpawnFail→CANCELLED 可重派，
      // 与 user 放行通道的 422 REPO_REF_DRIFTED 分流——系统通道给可重派状态而非人工修复指引）
      const repoPath = workspaces.resolveRepoPath(ticket.workspaceId, ticket.repoRef);
      if (repoPath == null) {
        throw new Error(
          `目标仓解析失败：workspace=${ticket.workspaceId} repoRef=${ticket.repoRef ?? '(null)'}（workspaces yaml 声明已变更，修正后重派）`,
        );
      }

      // 步 1：建/复用 worktree
      const wtPath = worktree.allocate(ticket.workspaceId, ticketId, repoPath);
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
        return;
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
      this.settle(ticketId, { round, baseline, wtPath, rawPath, timeoutMs, result });
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
    } finally {
      this.running.delete(ticketId);
    }
  }

  /**
   * 判定表分流（自上而下首个命中）：
   * 超时 → FAILED；退出码非 0 → FAILED（崩溃不重试）；报告 done → DONE（commits+实测文件落库、
   * 声明交叉预警）；报告 blocked → BLOCKED 卡点；报告缺失/schema 错 → RETRY_WAIT 自愈
   * （先判后等：重试耗尽当次升级 pending:l3）。每个离开执行态的分支尾直调 releaseAndRecheck
   * 唤醒排队单（饥饿免疫：前单非 DONE 也释放闸门）。
   */
  private settle(
    ticketId: number,
    ctx: { round: number; baseline: string; wtPath: string; rawPath: string; timeoutMs: number; result: RoundResult },
  ): void {
    const { service, config } = this.deps;
    const ticket = service.getTicket(ticketId);
    if (ticket.status !== 'IN_PROGRESS') {
      // 防御：已被并发处置（理论不可达）
      return;
    }
    const now = Date.now();

    if (ctx.result.timedOut) {
      service.transition(ticketId, 'FAILED', { actor: 'system', note: `执行超时（第 ${ctx.round} 轮）` });
      service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `执行超时：达到 ${ctx.timeoutMs}ms 上限，进程组已终止（round=${ctx.round}；raw 日志：${ctx.rawPath}）`,
      });
      this.releaseAndRecheck(ticketId);
      return;
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
      this.releaseAndRecheck(ticketId);
      return;
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
      // 实测防线：基线 diff 提取改动文件落 ticket_files，与同仓占用单声明集交叉比对 → 相交双留言预警
      this.recordTouchedFilesAndWarn(ticketId, ctx);
      // 编排链自动流转：解锁下游（有 parent 的 TASK 且其余依赖全 DONE 时自动放行）
      this.onTicketSettled(ticketId);
      this.releaseAndRecheck(ticketId);
      return;
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
      service.transition(ticketId, 'BLOCKED', {
        actor: 'system',
        note: 'worker 报告卡点',
        blockReason: reportRead.report.blockReason ?? reportRead.report.summary,
      });
      // 卡点原因全文留言（时间线可见）
      service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `卡点报告：${reportRead.report.blockReason ?? reportRead.report.summary}`,
      });
      this.releaseAndRecheck(ticketId);
      return;
    }

    // 报告缺失/schema 错 → RETRY_WAIT 自愈（先判后等）：计数递增后超上限当次升级 pending:l3
    // （历次失败摘要入 blockReason + system 留言，无额外 transitions 行）；否则安排指数退避
    const missCount = ticket.retryCount + 1;
    const escalate = missCount > config.maxRetries;
    if (escalate) {
      const firstMissRound = ctx.round - missCount + 1;
      const summary = `报告缺失重试 ${config.maxRetries} 次后仍失败（失败轮次 ${firstMissRound}..${ctx.round}；最后 raw 日志：${ctx.rawPath}）`;
      service.transition(ticketId, 'BLOCKED', {
        actor: 'system',
        note: '报告缺失（重试耗尽，升级人工裁决）',
        pendingLabel: 'l3',
        blockReason: summary,
        retryCount: missCount,
        retryAt: null,
      });
      service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `重试耗尽升级人工裁决：${summary}`,
      });
    } else {
      const backoffSec = Math.min(config.retryBackoffSec * 2 ** (missCount - 1), 240);
      const retryAt = this.now() + backoffSec * 1_000;
      const reason = `第 ${missCount} 次报告缺失（round=${ctx.round}；raw 日志：${ctx.rawPath}）`;
      service.transition(ticketId, 'BLOCKED', {
        actor: 'system',
        note: '报告缺失，安排自愈重试',
        pendingLabel: 'agent',
        blockReason: reason,
        retryCount: missCount,
        retryAt,
      });
      service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `RETRY_WAIT：${reason}；${backoffSec}s 后自动重试（第 ${missCount}/${config.maxRetries} 次）`,
      });
    }
    this.releaseAndRecheck(ticketId);
  }

  /**
   * 实测防线（仅 DONE settle）：改动文件按（轮次,路径）落 ticket_files；
   * 与同 repo 文件集占用单（在途/排队/阻塞）的声明集交叉比对，相交 → 双方各落 system 预警留言
   * （不改状态不阻塞——合并期问题由人工裁决，ATD 不管理合并）。
   */
  private recordTouchedFilesAndWarn(
    ticketId: number,
    ctx: { round: number; baseline: string; wtPath: string },
  ): void {
    let touched: string[] = [];
    try {
      touched = extractTouchedFiles(ctx.wtPath, ctx.baseline);
    } catch (e) {
      console.error('[atd-dispatcher] 实测文件提取失败', ticketId, e);
      return;
    }
    for (const p of touched) {
      this.deps.db
        .insert(ticketFiles)
        .values({ ticketId, round: ctx.round, path: p, createdAt: Date.now() })
        .onConflictDoNothing()
        .run();
    }
    if (touched.length === 0) return;
    const ticket = this.deps.service.getTicket(ticketId);
    const holders = this.deps.service.fileSetHolders(ticket.workspaceId, ticket.repoRef, ticketId);
    for (const holder of holders) {
      const hit = intersectingPaths(touched, holder.plannedFiles);
      if (hit.length === 0) continue;
      const line = hit.join(', ');
      this.deps.service.addComment(ticketId, {
        authorType: 'system',
        authorName: 'atd',
        content: `实测防线预警：本单实测改动与单 #${holder.id}（${holder.title}）声明文件集相交：${line}`,
      });
      this.deps.service.addComment(holder.id, {
        authorType: 'system',
        authorName: 'atd',
        content: `实测防线预警：单 #${ticketId}（${ticket.title}，已 DONE）实测改动与本单声明文件集相交：${line}`,
      });
    }
  }

  /**
   * pre-spawn 运行期失败：DISPATCHED 停留 → CANCELLED + 留言；IN_PROGRESS 停留 → FAILED + 留言。
   * 两分支尾均直调 releaseAndRecheck（离开执行态即释放闸门，唤醒排队单）。
   */
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
        this.releaseAndRecheck(ticketId);
      } else if (t.status === 'IN_PROGRESS') {
        this.deps.service.transition(ticketId, 'FAILED', { actor: 'system', note: '执行处置失败' });
        this.deps.service.addComment(ticketId, {
          authorType: 'system',
          authorName: 'atd',
          content: `执行处置失败：${reason}`,
        });
        this.releaseAndRecheck(ticketId);
      }
    } catch (e) {
      console.error('[atd-dispatcher] 失败处置异常', ticketId, e);
    }
  }

  /**
   * 卡点裁决（内联语义：卡点=原单 BLOCKED 状态，无独立卡点单）：
   * continue=原 worktree 续跑 / reassign=换 worker 续跑 / abort=FAILED 终止。
   */
  resolveTicket(
    ticketId: number,
    input: { resolution: 'continue' | 'reassign' | 'abort'; note?: string; reassignWorkerId?: string },
  ): Ticket {
    const { service, registry } = this.deps;
    const ticket = service.getTicket(ticketId);
    if (ticket.status !== 'BLOCKED') {
      throw new AppError('RESOLUTION_INVALID', `仅 BLOCKED 态可裁决（当前 ${ticket.status}）：#${ticketId}`);
    }
    if (input.resolution === 'reassign') {
      if (!input.reassignWorkerId) {
        throw new AppError('WORKER_REQUIRED', '改派裁决必须指定 reassignWorkerId');
      }
      if (!registry.has(input.reassignWorkerId)) {
        throw new AppError('WORKER_UNKNOWN', `worker 未注册：${input.reassignWorkerId}`);
      }
    }
    // 裁决留言（裁决人=当前用户，落原单时间线）
    if (input.note) {
      service.addComment(ticketId, { authorType: 'user', authorName: '我', content: input.note });
    }
    if (input.resolution === 'abort') {
      const aborted = service.transition(ticketId, 'FAILED', { actor: 'system', note: '卡点裁决：终止' });
      // 终止单释放文件集占用：直调重校验唤醒排队单
      this.releaseAndRecheck(ticketId);
      return aborted;
    }
    if (input.resolution === 'continue') {
      // 人工介入清零 RETRY_WAIT 计数（人工裁决语义与自愈计数不叠加）
      const t = service.transition(ticketId, 'IN_PROGRESS', {
        actor: 'system',
        note: '卡点裁决：继续',
        clearRetry: true,
      });
      void this.startRound(ticketId);
      return t;
    }
    const t = service.transition(ticketId, 'DISPATCHED', {
      actor: 'system',
      workerId: input.reassignWorkerId,
      note: '卡点裁决：改派',
      clearRetry: true,
    });
    void this.startRound(ticketId);
    return t;
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
      clearRetry: true,
      ...(input.workerId ? { workerId: input.workerId } : {}),
    });
    this.onDispatched(reopened);
    return reopened;
  }

  /**
   * 编排链自动流转入口①（以触发票为轴）：单落定（DONE）后枚举以本单为 blockedBy 的下游，
   * 逐票尝试放行。独立单（无 parent）不自动放行（保持人工控制）。
   */
  onTicketSettled(ticketId: number): void {
    const { db } = this.deps;
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
        this.tryReleaseChainTicket(row.id);
      } catch (e) {
        // 单个下游放行失败不阻断其他下游
        console.error('[atd-dispatcher] 自动放行失败', row.id, e);
      }
    }
  }

  /**
   * 编排链自动流转入口②（以 STORY 为轴）：confirm 原子建单事务提交后同步调用，
   * 枚举子单逐票尝试放行——链上无依赖根任务即刻放行（建单完成即触发点），
   * 有依赖任务待上游 DONE 后经入口①接力。与入口①共用放行核心，行为面单一。
   */
  releaseChainReady(storyId: number): void {
    const children = this.deps.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.parentId, storyId))
      .orderBy(asc(tickets.id))
      .all();
    for (const row of children) {
      try {
        this.tryReleaseChainTicket(row.id);
      } catch (e) {
        console.error('[atd-dispatcher] 编排链放行失败', row.id, e);
      }
    }
  }

  /**
   * 编排链放行核心（单票判定，两枚举入口共用）：TASK + SPEC_READY + 有 parent +
   * 预绑定 worker + 其余依赖全 DONE → system 自动放行；闸门满/文件冲突时 transition
   * 内部落 S3 排队（保持 SPEC_READY），无失败面；非放行成功不触发 spawn。
   */
  private tryReleaseChainTicket(ticketId: number): void {
    const { service, db } = this.deps;
    const t = service.getTicket(ticketId);
    // 仅对已预绑定 worker 的编排链节点自动放行——未定谁干活的不自动开工（留人工）
    if (t.type !== 'TASK' || t.status !== 'SPEC_READY' || t.parentId == null || !t.workerId) return;
    // 其余依赖是否全部 DONE
    const deps = db
      .select({ status: tickets.status })
      .from(ticketDependencies)
      .innerJoin(tickets, eq(ticketDependencies.blockedByTicketId, tickets.id))
      .where(eq(ticketDependencies.ticketId, ticketId))
      .all();
    if (!deps.every((d) => d.status === 'DONE')) return;
    const dispatched = service.transition(ticketId, 'DISPATCHED', {
      actor: 'system',
      note: '编排链依赖满足，自动放行',
    });
    if (dispatched.status === 'DISPATCHED') {
      this.onDispatched(dispatched);
    }
  }

  /**
   * 队列重校验（排队唤醒单一实现，三类挂载共用：dispatcher 内八处直调 / service 取消边回调 / 启动扫描）。
   * FIFO 按 queued_at（同刻按 id 兜底）；定向触发=按触发票 workspace+repoRef 过滤（tick/启动扫描不传参走全量）。
   * 排队单=四件套已全过的「随时可放行」单——唤醒仅重查 Registry∈（worker 可能被删）+ 闸门 + 文件集，
   * 不重查 worktree/repoRef（system 语义）；每单 try/catch 隔离（单单失败不影响他单）。
   */
  releaseAndRecheck(triggerTicketId?: number): void {
    const { db } = this.deps;
    let queued = db
      .select()
      .from(tickets)
      .where(and(eq(tickets.status, 'SPEC_READY'), isNotNull(tickets.queuedReason)))
      .orderBy(asc(tickets.queuedAt), asc(tickets.id))
      .all()
      .filter((r) => r.type === 'TASK');
    if (triggerTicketId != null) {
      const trigger = db.select().from(tickets).where(eq(tickets.id, triggerTicketId)).get();
      // 触发票已不可得（理论不可达）时退化为全量扫描
      if (trigger) {
        queued = queued.filter(
          (r) => r.workspaceId === trigger.workspaceId && r.repoRef === trigger.repoRef,
        );
      }
    }
    for (const row of queued) {
      try {
        this.tryReleaseQueued(row);
      } catch (e) {
        console.error('[atd-dispatcher] 排队唤醒失败', row.id, e);
      }
    }
  }

  /** 单个排队单重校验：Registry∈ + 闸门 + 文件集全过 → DISPATCHED（system）+ spawn；任一不满足留队 */
  private tryReleaseQueued(row: typeof tickets.$inferSelect): void {
    const { service, registry, config } = this.deps;
    if (!row.workerId || !registry.has(row.workerId)) {
      // worker 被删或未绑定：留队（下轮触发面再试），不报错
      return;
    }
    if (service.gateOccupancy(row.workspaceId, row.repoRef) >= config.maxConcurrentPerRepo) {
      return;
    }
    const declared = row.plannedFiles != null ? (JSON.parse(row.plannedFiles) as string[]) : [];
    if (declared.length > 0) {
      for (const holder of service.fileSetHolders(row.workspaceId, row.repoRef, row.id)) {
        if (intersectingPaths(declared, holder.plannedFiles).length > 0) {
          return;
        }
      }
    }
    const dispatched = service.transition(row.id, 'DISPATCHED', {
      actor: 'system',
      note: '排队唤醒，自动放行',
    });
    // transition 内部权威复校验后仍可能重新排队（闸门被并发占位）——非放行成功不触发 spawn
    if (dispatched.status === 'DISPATCHED') {
      void this.startRound(row.id);
    }
  }

  /**
   * RETRY_WAIT 到期扫描（5s tick）：逐单 try/catch 隔离（单单失败不影响他单，异常 log 不中断批次）。
   * 恢复顺序写死：先查闸门（自身一直在占用集，文件集不复验——BLOCKED 期间占用保留，占用集单调
   * 无新增冲突面）→ 闸门满则 retry_at 顺延一个 tickInterval 下轮再试（不落 queued 字段不转移状态）
   * → 有位则 BLOCKED→DISPATCHED（actor=system，retry 计数保留）重 spawn round+1。
   */
  private onTick(): void {
    const due = this.deps.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.status, 'BLOCKED'),
          eq(tickets.pendingLabel, 'agent'),
          isNotNull(tickets.retryAt),
          lte(tickets.retryAt, this.now()),
        ),
      )
      .all()
      .filter((r) => r.type === 'TASK');
    for (const row of due) {
      try {
        this.recoverRetryWait(row);
      } catch (e) {
        console.error('[atd-dispatcher] RETRY_WAIT 恢复失败', row.id, e);
      }
    }
  }

  /** 单个到期 RETRY_WAIT 单恢复（幂等：状态已转移则忽略） */
  private recoverRetryWait(row: typeof tickets.$inferSelect): void {
    const { service, config } = this.deps;
    const t = service.getTicket(row.id);
    if (t.status !== 'BLOCKED' || t.pendingLabel !== 'agent' || t.retryAt == null) return;
    if (service.gateOccupancy(t.workspaceId, t.repoRef) >= config.maxConcurrentPerRepo) {
      // 闸门满：顺延一个 tick（不落 queued 字段、不转移状态，保持 BLOCKED(pending:agent)）
      this.deps.db
        .update(tickets)
        .set({ retryAt: this.now() + this.tickIntervalMs(), updatedAt: Date.now() })
        .where(eq(tickets.id, t.id))
        .run();
      return;
    }
    service.transition(t.id, 'DISPATCHED', {
      actor: 'system',
      note: 'RETRY_WAIT 到期，自动重试',
      // 唤醒即清下次唤醒时刻；retryCount 保留（连续失败计数不因唤醒清零）
      retryAt: null,
    });
    void this.startRound(t.id);
  }

  /**
   * 服务重启恢复：
   * ①执行单进程已随重启消亡——IN_PROGRESS→FAILED；DISPATCHED→CANCELLED（均附留言）；
   * ②RETRY_WAIT 在途单——到期即恢复（计时器由 tick 重建，未到期不动）；
   * ③排队单重校验一轮（①释放的闸门位可被②③利用）。
   */
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
    // RETRY_WAIT 到期即恢复（每单 try/catch 隔离，与 tick 同一恢复实现）
    const waiting = this.deps.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.status, 'BLOCKED'),
          eq(tickets.pendingLabel, 'agent'),
          isNotNull(tickets.retryAt),
        ),
      )
      .all()
      .filter((r) => r.type === 'TASK');
    for (const row of waiting) {
      if (row.retryAt == null || row.retryAt > this.now()) continue;
      try {
        this.recoverRetryWait(row);
      } catch (err) {
        console.error('[atd-dispatcher] 重启 RETRY_WAIT 恢复失败', row.id, err);
      }
    }
    // 排队单重校验一轮（全量）
    this.releaseAndRecheck();
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
