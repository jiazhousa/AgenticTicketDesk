import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { comments, ticketCommits, ticketDependencies, ticketReports, ticketTransitions, tickets } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { AppError } from './errors.js';
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
  pendingLabel: string | null;
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
  blocker: Ticket | null;
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
  /** 同时写 round 列（spawn 轮次推进，由编排层传入） */
  round?: number;
};

/** 放行前置校验依赖（编排层注入：Registry 与 worktree 可建性） */
export type DispatchGuards = {
  knownWorkerIds(): Iterable<string>;
  assertWorktreeReady(ticketId: number): void;
};

/** spec 快照长度上限（prompt=spec+执行要求，超限在冻结点拦截） */
const MAX_SPEC_BYTES = 128 * 1024;

type TicketRow = typeof tickets.$inferSelect;
type TxCallback = Parameters<BetterSQLite3Database<typeof schema>['transaction']>[0];
type Tx = Parameters<TxCallback>[0];

function toTicket(row: TicketRow): Ticket {
  return { ...row, type: row.type as TicketType, status: row.status as Status };
}

/** 依赖/子单未完成明细的统一格式：`#<id> <标题>（<状态>）` */
function pendingLabel(t: Ticket): string {
  return `#${t.id} ${t.title}（${t.status}）`;
}

/**
 * 工单核心域服务：CRUD / 状态机 / DAG 校验 / 留言 / BLOCKER 升级。
 * 同步驱动铁则 1：事务回调内只写同步代码（better-sqlite3）。
 */
export class TicketService {
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
    private readonly guards?: DispatchGuards,
  ) {}

  /** 建单（初始态固定 DRAFT）；parentId 必须指向存在的 STORY，且仅 TASK 可有父 */
  createTicket(input: {
    type: TicketType;
    title: string;
    description?: string | null;
    parentId?: number | null;
    /** 预绑定 worker（仅 TASK；编排链拆单时定 worker 的语义——自动放行的前提） */
    workerId?: string | null;
  }): Ticket {
    return this.db.transaction((tx) => {
      if (input.parentId != null) {
        if (input.type !== 'TASK') {
          throw new AppError(
            'DAG_INVALID',
            `仅 TASK 可指定父单，${input.type} 不支持 parentId`,
            [`type=${input.type}`, `parentId=${input.parentId}`],
          );
        }
        const parent = tx.select().from(tickets).where(eq(tickets.id, input.parentId)).get();
        if (!parent || parent.type !== 'STORY') {
          throw new AppError(
            'DAG_INVALID',
            `父单 #${input.parentId} 不存在或不是 STORY`,
            [`parentId=${input.parentId}`],
          );
        }
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

  /** 列表（默认排序 createdAt DESC，同毫秒按 id DESC 兜底）；附 childrenCount/parentTitle */
  listTickets(filter: { status?: Status; type?: TicketType } = {}): TicketListItem[] {
    const conds = [];
    if (filter.status) conds.push(eq(tickets.status, filter.status));
    if (filter.type) conds.push(eq(tickets.type, filter.type));
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
    // 未关 BLOCKER：blockedBy 目标中类型为 BLOCKER 且未到终态的单（BLOCKED 存续期恰好一张）
    const blockerRow = this.db
      .select({ t: tickets })
      .from(ticketDependencies)
      .innerJoin(tickets, eq(ticketDependencies.blockedByTicketId, tickets.id))
      .where(
        and(
          eq(ticketDependencies.ticketId, id),
          eq(tickets.type, 'BLOCKER'),
          inArray(tickets.status, ['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS', 'BLOCKED']),
        ),
      )
      .orderBy(asc(ticketDependencies.id))
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
      blocker: blockerRow ? toTicket(blockerRow.t) : null,
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
   * 提交 spec：写 specContent + 转 SPEC_READY（冻结快照）。
   * 独立路径，不经 transition()——/transition 端点无法绕开冻结逻辑。
   */
  submitSpec(id: number, specContent: string): Ticket {
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
        .set({ specContent, status: 'SPEC_READY', updatedAt: now })
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
   * 状态转移（白名单 + 通道二分 + blockedBy 门 + STORY 聚合门），事务内落 transitions。
   * 判定优先级：to=SPEC_READY 一律 USE_SPEC_ENDPOINT → 不在边表 INVALID_TRANSITION →
   * blockedBy 门（放行最优先）→ user 请求 system 边 MANUAL_FORBIDDEN →
   * TASK 放行 workerId/Registry/worktree 三件套。
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
    return this.db.transaction((tx) => {
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
      // BLOCKED→DONE 仅限 BLOCKER 关单（resolve 路径）；TASK 的 BLOCKED 出路只有裁决三向+取消
      if (row.status === 'BLOCKED' && to === 'DONE' && row.type !== 'BLOCKER') {
        throw new AppError('INVALID_TRANSITION', `仅 BLOCKER 可从 BLOCKED 直接关单（当前类型 ${row.type}）`);
      }
      // ②③ TASK 放行三件套：workerId 必填 → ∈Registry → worktree 可建
      // （重开场景：未指定新 workerId 时沿用原绑定）
      if (row.type === 'TASK' && to === 'DISPATCHED' && actor === 'user') {
        const effectiveWorkerId = o.workerId ?? row.workerId;
        if (!effectiveWorkerId) {
          throw new AppError('WORKER_REQUIRED', 'TASK 放行必须指定 workerId');
        }
        if (o.workerId && this.guards && !new Set(this.guards.knownWorkerIds()).has(o.workerId)) {
          throw new AppError('WORKER_UNKNOWN', `worker 未注册：${o.workerId}`);
        }
        this.guards?.assertWorktreeReady(id);
      }
      const now = Date.now();
      const updated = tx
        .update(tickets)
        .set({
          status: to,
          updatedAt: now,
          ...(to === 'BLOCKED' ? { pendingLabel: 'l3' } : {}),
          ...(row.status === 'BLOCKED' && to !== 'BLOCKED' ? { pendingLabel: null } : {}),
          ...(o.workerId != null ? { workerId: o.workerId } : {}),
          ...(o.round !== undefined ? { round: o.round } : {}),
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
      return toTicket(updated);
    });
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

  /**
   * L3 升级：创建 BLOCKER 单（初始 IN_PROGRESS，绑定「人」）+ 首条留言（system，reason 全文）
   * + blockedBy 依赖边（父单被 BLOCKER 阻塞）。不建 worktree、不绑 worker。
   */
  createBlocker(input: { parentTicketId: number; reason: string }): Ticket {
    return this.db.transaction((tx) => {
      const parent = tx.select().from(tickets).where(eq(tickets.id, input.parentTicketId)).get();
      if (!parent) throw new AppError('NOT_FOUND', `父单 #${input.parentTicketId} 不存在`);
      const now = Date.now();
      const blocker = tx
        .insert(tickets)
        .values({
          type: 'BLOCKER',
          title: `卡点: ${parent.title}`,
          description: null,
          // 卡点单本质是「被父单的卡点阻塞、等人处理」——呈现 BLOCKED(pending:l3) 而非 IN_PROGRESS
          status: 'BLOCKED',
          parentId: null,
          specContent: null,
          workerId: null,
          pendingLabel: 'l3',
          round: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      tx.insert(ticketTransitions)
        .values({
          ticketId: blocker.id,
          fromStatus: 'DRAFT',
          toStatus: 'BLOCKED',
          operator: 'system',
          note: '卡点升级自动创建',
          createdAt: now,
        })
        .run();
      tx.insert(ticketDependencies)
        .values({ ticketId: parent.id, blockedByTicketId: blocker.id, createdAt: now })
        .run();
      tx.insert(comments)
        .values({
          ticketId: blocker.id,
          authorType: 'system',
          authorName: 'atd',
          content: input.reason,
          createdAt: now,
        })
        .run();
      return toTicket(blocker);
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
