import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { comments, ticketCommits, ticketDependencies, ticketReports, ticketTransitions, tickets } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { WorkspaceRegistry } from '../workspaces.js';
import { AppError } from './errors.js';
import { intersectingPaths } from './file-set.js';
import { TRANSITIONS, isUserEdge, type Status, type TicketType } from './status.js';

/** 工单视图（API/TS 侧 camelCase） */
export type Ticket = {
  id: number;
  type: TicketType;
  title: string;
  description: string | null;
  status: Status;
  parentId: number | null;
  specContent: string | null;
  workerId: string | null;
  /** 所属 workspace（建单落库；存量行由 migration DEFAULT 归属 atd） */
  workspaceId: string;
  /** TASK 目标仓 id（缺省=所属 workspace 主仓 id，落实际值）；非 TASK 恒 null */
  repoRef: string | null;
  pendingLabel: string | null;
  /** BLOCKED 存续期的卡点原因（内联卡点语义，无独立卡点单）；非 BLOCKED 恒 null */
  blockReason: string | null;
  /** RETRY_WAIT 自愈失败计数（仅报告缺失/schema 错递增；裁决/重开清零；排队不计入） */
  retryCount: number;
  /** RETRY_WAIT 下次唤醒时刻（epoch ms；BLOCKED(pending:agent) 存续期非空） */
  retryAt: number | null;
  /** 声明文件集（随 submitSpec 提交冻结；空数组视同未声明 → null） */
  plannedFiles: string[] | null;
  /** 排队原因（SPEC_READY 排队存续期 'GATE_QUEUED' | 'FILE_CONFLICT'，其余恒 null） */
  queuedReason: 'GATE_QUEUED' | 'FILE_CONFLICT' | null;
  /** 排队进入时刻（epoch ms，FIFO 唤醒排序；重排队保持原值） */
  queuedAt: number | null;
  round: number;
  createdAt: number;
  updatedAt: number;
};

/** 列表项：附父子关系便于树展示 */
export type TicketListItem = Ticket & { childrenCount: number; parentTitle: string | null };

export type Comment = {
  id: number;
  ticketId: number;
  authorType: string;
  authorName: string;
  content: string;
  createdAt: number;
};

export type Transition = {
  id: number;
  ticketId: number;
  fromStatus: Status;
  toStatus: Status;
  operator: string;
  note: string | null;
  createdAt: number;
};

/** commit 关联（按轮次落库，工单级=各轮并集） */
export type TicketCommitInfo = { round: number; sha: string };

/** worker 报告（详情取最大轮） */
export type TicketReportInfo = {
  round: number;
  status: string;
  summary: string;
  blockReason: string | null;
};

/** GET /api/tickets/:id 响应体；hasCancelledChildren 为前端告警锚点 */
export type TicketDetail = {
  ticket: Ticket;
  children: Ticket[];
  dependencies: Ticket[];
  blocks: Ticket[];
  comments: Comment[];
  transitions: Transition[];
  hasCancelledChildren: boolean;
  commits: TicketCommitInfo[];
  report: TicketReportInfo | null;
};

/** 转移通道与可选载荷；字符串形态（operator）保留兼容旧调用点 */
export type TransitionOptions = {
  /** 转移通道：user（人工）/ system（编排）；缺省 user */
  actor?: 'user' | 'system';
  /** 落库操作者名，缺省=actor */
  operator?: string;
  note?: string | null;
  /** TASK 放行时绑定的 worker（事务内落 worker_id 列）；改派时更新 */
  workerId?: string;
  /** 转 BLOCKED 时落库的卡点原因（worker 报告或系统判定描述）；转出 BLOCKED 自动清空 */
  blockReason?: string | null;
  /** 转 BLOCKED 时落库的卡点等级（'l3'=人工裁决 / 'agent'=RETRY_WAIT 自愈）；缺省 'l3' */
  pendingLabel?: string;
  /** RETRY_WAIT 记账：递增后的重试计数（仅 system 通道自愈路径使用） */
  retryCount?: number;
  /** RETRY_WAIT 记账：下次唤醒时刻（null=清除，唤醒转出与升级路径使用） */
  retryAt?: number | null;
  /** 清零重试记账（人工裁决 continue/reassign 与重开路径；RETRY_WAIT 计数不跨越人工介入） */
  clearRetry?: boolean;
  /** 同时写 round 列（spawn 轮次推进，由编排层传入） */
  round?: number;
};

/** 放行前置校验依赖（编排层注入：Registry 与 worktree 可建性） */
export type DispatchGuards = {
  knownWorkerIds(): Iterable<string>;
  /** repoPath 为按工单挂载解析出的目标仓绝对路径（放行四件套之④ worktree 前置沿用此 hook） */
  assertWorktreeReady(ticketId: number, repoPath: string): void;
};

/** 并发治理参数（闸门限流阈值；与 config.yaml 三键之一对应） */
export type DispatchLimits = { maxConcurrentPerRepo: number };

/** 缺省 workspace id（与 tickets.workspace_id 列 DEFAULT 一致；atd.yaml 为仓内自带声明） */
const DEFAULT_WORKSPACE_ID = 'atd';

/** spec 快照长度上限（prompt=spec+执行要求，超限在冻结点拦截） */
const MAX_SPEC_BYTES = 128 * 1024;

type TicketRow = typeof tickets.$inferSelect;
type TxCallback = Parameters<BetterSQLite3Database<typeof schema>['transaction']>[0];
type Tx = Parameters<TxCallback>[0];

function toTicket(row: TicketRow): Ticket {
  return {
    ...row,
    type: row.type as TicketType,
    status: row.status as Status,
    plannedFiles: parsePlannedFiles(row.plannedFiles),
    queuedReason: (row.queuedReason as Ticket['queuedReason']) ?? null,
  };
}

/** planned_files 列（JSON 数列字符串）读侧还原；空串/损坏 JSON 视同未声明 */
function parsePlannedFiles(raw: string | null): string[] | null {
  if (raw == null || raw === '') return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length > 0 ? (v as string[]) : null;
  } catch {
    return null;
  }
}

/** 依赖/子单未完成明细的统一格式：`#<id> <标题>（<状态>）` */
function pendingLabel(t: Ticket): string {
  return `#${t.id} ${t.title}（${t.status}）`;
}

/**
 * 工单核心域服务：CRUD / 状态机 / DAG 校验 / 留言（卡点内联为原单 BLOCKED 状态，无独立卡点单）。
 * 同步驱动铁则 1：事务回调内只写同步代码（better-sqlite3）。
 */
export class TicketService {
  /**
   * 离开执行态/释放占用后的队列重校验回调（app.ts 装配注入 dispatcher.releaseAndRecheck）。
   * 枚举挂载面：仅两条 user 取消边（DISPATCHED→CANCELLED / BLOCKED→CANCELLED）在此触发；
   * dispatcher 内部转移（settle/preSpawnFail/abort）由调用侧直调 releaseAndRecheck，不经本回调。
   * 契约：转移 DB 提交成功后 fire-and-forget 调用，回调异常 log 不抛（不阻塞 user 请求路径）。
   */
  onInflightReleased: ((triggerTicketId?: number) => void) | null = null;

  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly workspaces: WorkspaceRegistry,
    private readonly guards?: DispatchGuards,
    private readonly limits: DispatchLimits = { maxConcurrentPerRepo: 2 },
  ) {}

  /**
   * 建单（初始态固定 DRAFT）；parentId 必须指向存在的 STORY，且仅 TASK 可有父。
   * workspaceId 缺省 atd；带 parentId 的 TASK 强制继承父单 workspace（异值 422）。
   * repoRef 仅 TASK 可传，缺省=所属 workspace 主仓 id 且落库实际值（DB 无 NULL 歧义）。
   */
  createTicket(input: {
    type: TicketType;
    title: string;
    description?: string | null;
    parentId?: number | null;
    /** 预绑定 worker（仅 TASK；编排链拆单时定 worker 的语义——自动放行的前提） */
    workerId?: string | null;
    /** 所属 workspace（缺省 atd；带父单时强制继承父值，显式异值拒绝） */
    workspaceId?: string;
    /** TASK 目标仓 id（∈所属 workspace repos；缺省=主仓 id） */
    repoRef?: string;
  }): Ticket {
    return this.db.transaction((tx) => {
      // 预绑定校验：worker 必须已注册（防自动放行链 spawn 时才失败）
      if (input.workerId && this.guards && !new Set(this.guards.knownWorkerIds()).has(input.workerId)) {
        throw new AppError('WORKER_UNKNOWN', `worker 未注册：${input.workerId}`);
      }
      let parent: TicketRow | undefined;
      if (input.parentId != null) {
        if (input.type !== 'TASK') {
          throw new AppError(
            'DAG_INVALID',
            `仅 TASK 可指定父单，${input.type} 不支持 parentId`,
            [`type=${input.type}`, `parentId=${input.parentId}`],
          );
        }
        parent = tx.select().from(tickets).where(eq(tickets.id, input.parentId)).get();
        if (!parent || parent.type !== 'STORY') {
          throw new AppError(
            'DAG_INVALID',
            `父单 #${input.parentId} 不存在或不是 STORY`,
            [`parentId=${input.parentId}`],
          );
        }
        // 归属传播：子单强制继承父单 workspace（显式传入不同值拒绝）
        if (input.workspaceId != null && input.workspaceId !== parent.workspaceId) {
          throw new AppError(
            'CROSS_WORKSPACE',
            `子单必须继承父单 workspace：父单 #${parent.id} 属 ${parent.workspaceId}，传入 ${input.workspaceId}`,
            [`父 #${parent.id}（${parent.workspaceId}）`, `入参 workspaceId=${input.workspaceId}`],
          );
        }
      }
      const workspaceId = parent != null ? parent.workspaceId : (input.workspaceId ?? DEFAULT_WORKSPACE_ID);
      const ws = this.workspaces.get(workspaceId);
      if (!ws) {
        throw new AppError(
          'WORKSPACE_UNKNOWN',
          `workspace 未声明：${workspaceId}`,
          [`可选：${this.workspaces.list().map((w) => w.id).join(', ') || '（无）'}`],
        );
      }
      // repoRef 落库语义：TASK 缺省=主仓 id 且落实际值；非 TASK 传入拒绝（无仓语义）
      let repoRef: string | null = null;
      if (input.type === 'TASK') {
        const ref = input.repoRef ?? ws.primary;
        if (!ws.repos.some((r) => r.id === ref)) {
          throw new AppError(
            'REPO_REF_INVALID',
            `repoRef 不在 workspace ${ws.id} 的仓列表：${ref}`,
            [`可选：${ws.repos.map((r) => r.id).join(', ')}`],
          );
        }
        repoRef = ref;
      } else if (input.repoRef != null) {
        throw new AppError('REPO_REF_INVALID', `仅 TASK 可指定 repoRef（当前类型 ${input.type}）`);
      }
      const now = Date.now();
      const row = tx
        .insert(tickets)
        .values({
          type: input.type,
          title: input.title,
          description: input.description ?? null,
          status: 'DRAFT',
          parentId: input.parentId ?? null,
          specContent: null,
          workerId: input.workerId ?? null,
          workspaceId,
          repoRef,
          pendingLabel: null,
          round: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return toTicket(row);
    });
  }

  /** 列表（默认排序 createdAt DESC，同毫秒按 id DESC 兜底）；附 childrenCount/parentTitle；workspaceId 可选过滤 */
  listTickets(filter: { status?: Status; type?: TicketType; workspaceId?: string } = {}): TicketListItem[] {
    const conds = [];
    if (filter.status) conds.push(eq(tickets.status, filter.status));
    if (filter.type) conds.push(eq(tickets.type, filter.type));
    if (filter.workspaceId) conds.push(eq(tickets.workspaceId, filter.workspaceId));
    const rows = this.db
      .select()
      .from(tickets)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .all();

    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((v): v is number => v != null))];
    const parentTitleById = new Map<number, string>();
    if (parentIds.length > 0) {
      for (const p of this.db
        .select({ id: tickets.id, title: tickets.title })
        .from(tickets)
        .where(inArray(tickets.id, parentIds))
        .all()) {
        parentTitleById.set(p.id, p.title);
      }
    }
    const childrenCountById = new Map<number, number>();
    for (const c of this.db
      .select({ parentId: tickets.parentId })
      .from(tickets)
      .where(isNotNull(tickets.parentId))
      .all()) {
      childrenCountById.set(c.parentId!, (childrenCountById.get(c.parentId!) ?? 0) + 1);
    }
    return rows.map((r) => ({
      ...toTicket(r),
      childrenCount: childrenCountById.get(r.id) ?? 0,
      parentTitle: r.parentId != null ? (parentTitleById.get(r.parentId) ?? null) : null,
    }));
  }

  /** 读单（不存在 → 404 NOT_FOUND） */
  getTicket(id: number): Ticket {
    const row = this.db.select().from(tickets).where(eq(tickets.id, id)).get();
    if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
    return toTicket(row);
  }

  /** 详情聚合：子单 / blockedBy 依赖 / 留言（正序）/ 转移历史（插入序）/ commit 关联 / 报告（最大轮）/ 未关 BLOCKER */
  getTicketDetail(id: number): TicketDetail {
    const ticket = this.getTicket(id);
    const children = this.db
      .select()
      .from(tickets)
      .where(eq(tickets.parentId, id))
      .orderBy(asc(tickets.id))
      .all()
      .map(toTicket);
    const dependencies = this.db
      .select({ t: tickets })
      .from(ticketDependencies)
      .innerJoin(tickets, eq(ticketDependencies.blockedByTicketId, tickets.id))
      .where(eq(ticketDependencies.ticketId, id))
      .orderBy(asc(ticketDependencies.id))
      .all()
      .map((r) => toTicket(r.t));
    // 反向查询：本单阻塞了哪些单（BLOCKER 单详情的父单入口数据源）
    const blocks = this.db
      .select({ t: tickets })
      .from(ticketDependencies)
      .innerJoin(tickets, eq(ticketDependencies.ticketId, tickets.id))
      .where(eq(ticketDependencies.blockedByTicketId, id))
      .orderBy(asc(ticketDependencies.id))
      .all()
      .map((r) => toTicket(r.t));
    const commentRows = this.db
      .select()
      .from(comments)
      .where(eq(comments.ticketId, id))
      .orderBy(asc(comments.id))
      .all();
    const transitionRows = this.db
      .select()
      .from(ticketTransitions)
      .where(eq(ticketTransitions.ticketId, id))
      .orderBy(asc(ticketTransitions.id))
      .all();
    const commits = this.db
      .select({ round: ticketCommits.round, sha: ticketCommits.sha })
      .from(ticketCommits)
      .where(eq(ticketCommits.ticketId, id))
      .orderBy(asc(ticketCommits.round), asc(ticketCommits.id))
      .all();
    const reportRow = this.db
      .select()
      .from(ticketReports)
      .where(eq(ticketReports.ticketId, id))
      .orderBy(desc(ticketReports.round), desc(ticketReports.id))
      .limit(1)
      .get();
    return {
      ticket,
      children,
      dependencies,
      comments: commentRows.map((r) => ({ ...r })),
      transitions: transitionRows.map((r) => ({
        ...r,
        fromStatus: r.fromStatus as Status,
        toStatus: r.toStatus as Status,
      })),
      hasCancelledChildren: children.some((c) => c.status === 'CANCELLED'),
      blocks,
      commits,
      report: reportRow
        ? {
            round: reportRow.round,
            status: reportRow.status,
            summary: reportRow.summary,
            blockReason: reportRow.blockReason,
          }
        : null,
    };
  }

  /** 编辑（仅 DRAFT 态；至少一项校验在路由 zod） */
  updateTicket(
    id: number,
    patch: { title?: string; description?: string; specContent?: string },
  ): Ticket {
    return this.db.transaction((tx) => {
      const row = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
      if (row.status !== 'DRAFT') {
        throw new AppError('NOT_DRAFT', `仅 DRAFT 态可编辑，当前为 ${row.status}`);
      }
      const updated = tx
        .update(tickets)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.specContent !== undefined ? { specContent: patch.specContent } : {}),
          updatedAt: Date.now(),
        })
        .where(eq(tickets.id, id))
        .returning()
        .get();
      return toTicket(updated);
    });
  }

  /**
   * 提交 spec：写 specContent + plannedFiles（随本入口冻结，DRAFT 期不走 updateTicket）+ 转 SPEC_READY。
   * 独立路径，不经 transition()——/transition 端点无法绕开冻结逻辑。
   */
  submitSpec(id: number, specContent: string, plannedFiles?: string[] | null): Ticket {
    return this.db.transaction((tx) => {
      const row = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
      if (row.status !== 'DRAFT') {
        throw new AppError('NOT_DRAFT', `仅 DRAFT 态可提交 spec，当前为 ${row.status}`);
      }
      if (Buffer.byteLength(specContent, 'utf8') > MAX_SPEC_BYTES) {
        throw new AppError('PROMPT_TOO_LONG', `spec 内容超过 ${MAX_SPEC_BYTES / 1024}KB 上限（prompt 长度约束）`);
      }
      const now = Date.now();
      const updated = tx
        .update(tickets)
        .set({
          specContent,
          status: 'SPEC_READY',
          // 空数组视同未声明（落 NULL，不参与文件集占用）
          plannedFiles: plannedFiles && plannedFiles.length > 0 ? JSON.stringify(plannedFiles) : null,
          updatedAt: now,
        })
        .where(eq(tickets.id, id))
        .returning()
        .get();
      tx.insert(ticketTransitions)
        .values({
          ticketId: id,
          fromStatus: 'DRAFT',
          toStatus: 'SPEC_READY',
          operator: 'user',
          note: 'submit spec',
          createdAt: now,
        })
        .run();
      return toTicket(updated);
    });
  }

  /**
   * 状态转移（白名单 + 通道二分 + blockedBy 门 + STORY 聚合门 + 并发治理），事务内落 transitions。
   * 判定优先级：to=SPEC_READY 一律 USE_SPEC_ENDPOINT → 不在边表 INVALID_TRANSITION →
   * blockedBy 门（放行最优先）→ user 请求 system 边 MANUAL_FORBIDDEN →
   * TASK 放行四件套（workerId/Registry/repoRef 复校/worktree）→
   * 闸门/文件集（仅新放行边 SPEC_READY→DISPATCHED；reopen/裁决恢复语义直执行——D8）。
   * 排队不走状态机：闸门满（两通道）/文件冲突（仅 system 通道）保持 SPEC_READY，
   * 落 worker_id+queued_reason+queued_at（重排队保持原 queued_at 维持 FIFO 位），无 transitions 行。
   */
  transition(
    id: number,
    to: Status,
    opts?: TransitionOptions | string,
    legacyNote?: string | null,
  ): Ticket {
    const o: TransitionOptions =
      typeof opts === 'string' ? { operator: opts, note: legacyNote } : (opts ?? {});
    const actor = o.actor ?? 'user';
    const operator = o.operator ?? actor;
    const result = this.db.transaction((tx) => {
      const row = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
      if (to === 'SPEC_READY') {
        throw new AppError('USE_SPEC_ENDPOINT', 'SPEC_READY 只能经 POST /api/tickets/:id/spec 进入');
      }
      if (!TRANSITIONS[row.status as Status].includes(to)) {
        throw new AppError('INVALID_TRANSITION', `非法转移：${row.status} → ${to}`);
      }
      // ① blockedBy 门最优先（放行前置，保持既有期望码稳定）
      if (to === 'DISPATCHED') {
        this.assertDependenciesDone(tx, id);
      }
      // 通道二分：在边表内但 user 不可达（按 type 分流）→ MANUAL_FORBIDDEN
      if (actor === 'user' && !isUserEdge(row.type as TicketType, row.status as Status, to)) {
        throw new AppError(
          'MANUAL_FORBIDDEN',
          `人工通道禁止转移：${row.type} 单 ${row.status} → ${to} 由系统通道执行`,
        );
      }
      if (to === 'DONE' && row.type === 'STORY') {
        this.assertChildrenSettled(tx, id);
      }
      // ②③④⑤ TASK 放行四件套（仅 user 通道）：workerId 必填 → ∈Registry → repoRef 复校 → worktree 可建
      // （重开场景：未指定新 workerId 时沿用原绑定；system 自动放行链不做 repoRef 复校——
      //  spawn 期解析失败走既有 preSpawnFail→CANCELLED 可重派语义，与人工通道分流）
      let effectiveWorkerId: string | null = o.workerId ?? row.workerId;
      if (row.type === 'TASK' && to === 'DISPATCHED' && actor === 'user') {
        if (!effectiveWorkerId) {
          throw new AppError('WORKER_REQUIRED', 'TASK 放行必须指定 workerId');
        }
        if (o.workerId && this.guards && !new Set(this.guards.knownWorkerIds()).has(o.workerId)) {
          throw new AppError('WORKER_UNKNOWN', `worker 未注册：${o.workerId}`);
        }
        // repoRef 复校（防建单后 yaml 变更漂移）：workspace 或仓声明已不在注册表即拒
        const repoPath = this.workspaces.resolveRepoPath(row.workspaceId, row.repoRef);
        if (repoPath == null) {
          throw new AppError(
            'REPO_REF_DRIFTED',
            `repoRef 已失效：workspace=${row.workspaceId} repoRef=${row.repoRef ?? '(null)'}（workspaces yaml 声明已变更）`,
            ['修正 workspaces/*.yaml 恢复该仓声明后重试放行', '或裁决终止本单，另建指向现存仓的新工单'],
          );
        }
        this.guards?.assertWorktreeReady(id, repoPath);
      }
      // ⑥ 并发治理（仅新放行边 SPEC_READY→DISPATCHED；校验作用域外的恢复/重开直执行）：
      // 四件套全过后先闸门后文件集；不满足按通道分流（闸门满两通道一律排队；文件冲突 user 拒绝/system 排队）
      if (row.type === 'TASK' && to === 'DISPATCHED' && row.status === 'SPEC_READY') {
        const gateCount = this.gateOccupancy(row.workspaceId, row.repoRef);
        if (gateCount >= this.limits.maxConcurrentPerRepo) {
          return this.enqueue(tx, row, effectiveWorkerId, 'GATE_QUEUED');
        }
        if (row.plannedFiles != null) {
          const declared = parsePlannedFiles(row.plannedFiles) ?? [];
          if (declared.length > 0) {
            const conflict = this.findFileConflict(tx, row.workspaceId, row.repoRef, id, declared);
            if (conflict != null) {
              if (actor === 'user') {
                throw new AppError(
                  'FILE_SET_CONFLICT',
                  'plannedFiles 与同仓在途/排队/阻塞单的声明文件集相交',
                  conflict,
                );
              }
              return this.enqueue(tx, row, effectiveWorkerId, 'FILE_CONFLICT');
            }
          }
        }
      }
      const now = Date.now();
      const updated = tx
        .update(tickets)
        .set({
          status: to,
          updatedAt: now,
          ...(to === 'BLOCKED'
            ? { pendingLabel: o.pendingLabel ?? 'l3', ...(o.blockReason != null ? { blockReason: o.blockReason } : {}) }
            : {}),
          ...(row.status === 'BLOCKED' && to !== 'BLOCKED' ? { pendingLabel: null, blockReason: null } : {}),
          ...(row.status === 'SPEC_READY' ? { queuedReason: null, queuedAt: null } : {}),
          ...(o.workerId != null ? { workerId: o.workerId } : {}),
          ...(o.round !== undefined ? { round: o.round } : {}),
          ...(o.retryCount !== undefined ? { retryCount: o.retryCount } : {}),
          ...(o.retryAt !== undefined ? { retryAt: o.retryAt } : {}),
          ...(o.clearRetry ? { retryCount: 0, retryAt: null } : {}),
        })
        .where(eq(tickets.id, id))
        .returning()
        .get();
      tx.insert(ticketTransitions)
        .values({
          ticketId: id,
          fromStatus: row.status,
          toStatus: to,
          operator,
          note: o.note ?? null,
          createdAt: now,
        })
        .run();
      return { ticket: toTicket(updated), fromStatus: row.status as Status };
    });
    // user 取消边（DISPATCHED/BLOCKED→CANCELLED）释放闸门/文件集占用：提交成功后 fire-and-forget 通知重校验
    if (
      this.onInflightReleased != null &&
      actor === 'user' &&
      to === 'CANCELLED' &&
      (result.fromStatus === 'DISPATCHED' || result.fromStatus === 'BLOCKED')
    ) {
      try {
        this.onInflightReleased(id);
      } catch (e) {
        console.error('[atd-service] onInflightReleased 回调异常', id, e);
      }
    }
    return result.ticket;
  }

  /**
   * 排队落库：保持 SPEC_READY（不走状态机、无 transitions 行），写 worker_id 早绑定 + queued 两字段。
   * 重排队（唤醒后仍不满足）保持原 queued_at 维持 FIFO 位。
   */
  private enqueue(
    tx: Tx,
    row: TicketRow,
    workerId: string | null,
    reason: 'GATE_QUEUED' | 'FILE_CONFLICT',
  ): { ticket: Ticket; fromStatus: Status } {
    const updated = tx
      .update(tickets)
      .set({
        ...(workerId != null ? { workerId } : {}),
        queuedReason: reason,
        ...(row.queuedAt == null ? { queuedAt: Date.now() } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(tickets.id, row.id))
      .returning()
      .get();
    return { ticket: toTicket(updated), fromStatus: row.status as Status };
  }

  /**
   * 闸门计数集大小：同 repo（workspace+repoRef）执行中的 TASK 数（DISPATCHED+IN_PROGRESS）。
   * 排队与 BLOCKED 不占闸门（未在执行）；STORY/DREAM 无执行语义不计入；
   * repoRef 为 null（非 TASK 语境）无匹配面，恒 0。
   */
  gateOccupancy(workspaceId: string, repoRef: string | null): number {
    if (repoRef == null) return 0;
    const r = this.db
      .select({ n: sql<number>`count(*)` })
      .from(tickets)
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          eq(tickets.repoRef, repoRef),
          eq(tickets.type, 'TASK'),
          inArray(tickets.status, ['DISPATCHED', 'IN_PROGRESS']),
        ),
      )
      .get();
    return Number(r?.n ?? 0);
  }

  /**
   * 文件集占用集：同 repo 非终态占用声明的 TASK（DISPATCHED/IN_PROGRESS/SPEC_READY 排队中/BLOCKED 任何
   * pendingLabel——阻塞单恢复后不得与后来者冲突），仅含已声明 plannedFiles 的单（未声明不占文件集）。
   */
  fileSetHolders(
    workspaceId: string,
    repoRef: string | null,
    excludeTicketId?: number,
  ): Array<{ id: number; title: string; plannedFiles: string[] }> {
    if (repoRef == null) return [];
    const rows = this.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          eq(tickets.repoRef, repoRef),
          eq(tickets.type, 'TASK'),
          inArray(tickets.status, ['DISPATCHED', 'IN_PROGRESS', 'BLOCKED']),
        ),
      )
      .all();
    // SPEC_READY 排队中：排队单保留声明占用（放行前概念，与 BLOCKED 同为占用面）
    const queuedRows = this.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          eq(tickets.repoRef, repoRef),
          eq(tickets.type, 'TASK'),
          eq(tickets.status, 'SPEC_READY'),
          isNotNull(tickets.queuedReason),
        ),
      )
      .all();
    const holders: Array<{ id: number; title: string; plannedFiles: string[] }> = [];
    for (const r of [...rows, ...queuedRows]) {
      if (excludeTicketId != null && r.id === excludeTicketId) continue;
      const declared = parsePlannedFiles(r.plannedFiles);
      if (declared == null) continue;
      holders.push({ id: r.id, title: r.title, plannedFiles: declared });
    }
    return holders;
  }

  /** 声明集与占用集相交明细（放行前置校验）：相交行列表（`单 N 与单 M 文件集相交: a.ts, dir/`），null=无冲突 */
  private findFileConflict(
    tx: Tx,
    workspaceId: string,
    repoRef: string | null,
    selfId: number,
    declared: string[],
  ): string[] | null {
    if (repoRef == null) return null;
    const rows = tx
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.workspaceId, workspaceId),
          eq(tickets.repoRef, repoRef),
          eq(tickets.type, 'TASK'),
          inArray(tickets.status, ['DISPATCHED', 'IN_PROGRESS', 'BLOCKED', 'SPEC_READY']),
        ),
      )
      .all();
    const details: string[] = [];
    for (const r of rows) {
      if (r.id === selfId) continue;
      if (r.status === 'SPEC_READY' && r.queuedReason == null) continue;
      const other = parsePlannedFiles(r.plannedFiles);
      if (other == null) continue;
      const hit = intersectingPaths(declared, other);
      if (hit.length > 0) {
        details.push(`单 ${selfId} 与单 ${r.id} 文件集相交: ${hit.join(', ')}`);
      }
    }
    return details.length > 0 ? details : null;
  }

  /** 轮次推进（L2 重试/裁决继续：状态保持 IN_PROGRESS，仅 round+1），返回新轮次 */
  bumpRound(id: number): number {
    return this.db.transaction((tx) => {
      const row = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
      const updated = tx
        .update(tickets)
        .set({ round: row.round + 1, updatedAt: Date.now() })
        .where(eq(tickets.id, id))
        .returning()
        .get();
      return updated.round;
    });
  }

  /** 留言（正序按 id 排序展示） */
  addComment(
    id: number,
    input: { authorType: string; authorName: string; content: string },
  ): Comment {
    return this.db.transaction((tx) => {
      const row = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
      const inserted = tx
        .insert(comments)
        .values({
          ticketId: id,
          authorType: input.authorType,
          authorName: input.authorName,
          content: input.content,
          createdAt: Date.now(),
        })
        .returning()
        .get();
      return { ...inserted };
    });
  }

  /** 加 blockedBy 依赖边：禁自依赖 / 禁重复 / 禁成环（沿 blockedBy 链 DFS） */
  addDependency(id: number, blockedByTicketId: number): void {
    this.db.transaction((tx) => {
      const self = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!self) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
      const target = tx.select().from(tickets).where(eq(tickets.id, blockedByTicketId)).get();
      if (!target) throw new AppError('NOT_FOUND', `blockedBy 目标工单 #${blockedByTicketId} 不存在`);
      if (id === blockedByTicketId) {
        throw new AppError('DAG_INVALID', '禁止自依赖', [`#${id}`]);
      }
      // 同 workspace 约束：blockedBy 边限 workspace 内（跨项目群依赖无法协同放行门）
      if (self.workspaceId !== target.workspaceId) {
        throw new AppError(
          'CROSS_WORKSPACE',
          '依赖边两侧工单必须属于同一 workspace',
          [`#${id}（${self.workspaceId}）`, `#${blockedByTicketId}（${target.workspaceId}）`],
        );
      }
      const dup = tx
        .select()
        .from(ticketDependencies)
        .where(
          and(
            eq(ticketDependencies.ticketId, id),
            eq(ticketDependencies.blockedByTicketId, blockedByTicketId),
          ),
        )
        .get();
      if (dup) {
        throw new AppError('DAG_INVALID', '依赖已存在', [`#${id} blockedBy #${blockedByTicketId}`]);
      }
      // 环检测：新边 id→blockedByTicketId 成环 ⟺ 从 blockedByTicketId 沿既有边可回到 id
      const edges = new Map<number, number[]>();
      for (const d of tx
        .select({ ticketId: ticketDependencies.ticketId, blockedByTicketId: ticketDependencies.blockedByTicketId })
        .from(ticketDependencies)
        .all()) {
        const list = edges.get(d.ticketId) ?? [];
        list.push(d.blockedByTicketId);
        edges.set(d.ticketId, list);
      }
      const visited = new Set<number>();
      const stack = [blockedByTicketId];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur === id) {
          throw new AppError('DAG_INVALID', '依赖成环', [`#${id} ⇄ #${blockedByTicketId}`]);
        }
        if (visited.has(cur)) continue;
        visited.add(cur);
        stack.push(...(edges.get(cur) ?? []));
      }
      tx.insert(ticketDependencies)
        .values({ ticketId: id, blockedByTicketId, createdAt: Date.now() })
        .run();
    });
  }

  /** 删依赖边（幂等：边不存在时静默 204） */
  removeDependency(id: number, blockedByTicketId: number): void {
    const row = this.db.select().from(tickets).where(eq(tickets.id, id)).get();
    if (!row) throw new AppError('NOT_FOUND', `工单 #${id} 不存在`);
    this.db
      .delete(ticketDependencies)
      .where(
        and(
          eq(ticketDependencies.ticketId, id),
          eq(ticketDependencies.blockedByTicketId, blockedByTicketId),
        ),
      )
      .run();
  }

  /** 各 workspace 工单计数（workspace 列表/详情 API 数据源；无工单的 workspace 不出现键） */
  countByWorkspace(): Map<string, number> {
    const rows = this.db
      .select({ ws: tickets.workspaceId, n: sql<number>`count(*)` })
      .from(tickets)
      .groupBy(tickets.workspaceId)
      .all();
    return new Map(rows.map((r) => [r.ws, Number(r.n)]));
  }

  /** 放行前置门：所有 blockedBy 单须 DONE（CANCELLED 不视为完成，可先删依赖边解除） */
  private assertDependenciesDone(tx: Tx, id: number): void {
    const depTickets = tx
      .select({ t: tickets })
      .from(ticketDependencies)
      .innerJoin(tickets, eq(ticketDependencies.blockedByTicketId, tickets.id))
      .where(eq(ticketDependencies.ticketId, id))
      .all()
      .map((r) => toTicket(r.t));
    const pending = depTickets.filter((t) => t.status !== 'DONE');
    if (pending.length > 0) {
      throw new AppError(
        'BLOCKED_BY_PENDING',
        '存在未完成的 blockedBy 依赖单，禁止放行',
        pending.map(pendingLabel),
      );
    }
  }

  /** STORY 聚合门：子单须全部 DONE/CANCELLED（CANCELLED 视为已收敛，不阻塞） */
  private assertChildrenSettled(tx: Tx, id: number): void {
    const children = tx
      .select()
      .from(tickets)
      .where(eq(tickets.parentId, id))
      .all()
      .map(toTicket);
    const pending = children.filter((c) => c.status !== 'DONE' && c.status !== 'CANCELLED');
    if (pending.length > 0) {
      throw new AppError(
        'CHILDREN_PENDING',
        '子单未全部完成，父单禁止关单',
        pending.map(pendingLabel),
      );
    }
  }
}
