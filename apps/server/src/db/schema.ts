import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * 工单核心域 schema（DB 侧 snake_case，API/TS 侧 camelCase 由 Drizzle 映射）。
 * 注意：text 枚举列不生成 DB CHECK 约束——枚举值域由 zod 入参校验兜底（同步驱动铁则 3）。
 * 无软删列：终态（DONE/CANCELLED）即生命周期终点。
 */
export const tickets = sqliteTable('tickets', {
  /** 单号语义 #N */
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 'STORY' | 'TASK' | 'BLOCKER' | 'DREAM'（S1 实际仅使用 STORY/TASK） */
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  /** M1 六态：DRAFT/SPEC_READY/DISPATCHED/IN_PROGRESS/DONE/CANCELLED */
  status: text('status').notNull(),
  /** 父单（仅 STORY 可为父；STORY 无父），约束在服务层校验 */
  parentId: integer('parent_id').references((): AnySQLiteColumn => tickets.id),
  /** spec 快照：DRAFT 期可编辑，转入 SPEC_READY 即冻结 */
  specContent: text('spec_content'),
  /** 执行 worker 绑定（放行时写入，改派时更新） */
  workerId: text('worker_id'),
  /** 所属 workspace（声明式加载 workspaces/*.yaml）；存量行由 migration DEFAULT 归属 atd */
  workspaceId: text('workspace_id').notNull().default('atd'),
  /** TASK 目标仓 id（∈所属 workspace repos，缺省=主仓 id 落实际值）；非 TASK 无仓语义为 NULL */
  repoRef: text('repo_ref'),
  /** BLOCKED 存续期的卡点等级（'l3'=人工裁决 / 'agent'=RETRY_WAIT 自愈），转出 BLOCKED 时置 NULL */
  pendingLabel: text('pending_label'),
  /** BLOCKED 存续期的卡点原因（内联卡点语义，无独立卡点单）；转出 BLOCKED 时置 NULL */
  blockReason: text('block_reason'),
  /** RETRY_WAIT 自愈失败计数（仅报告缺失/schema 错递增；裁决/重开清零；排队不计入） */
  retryCount: integer('retry_count').notNull().default(0),
  /** RETRY_WAIT 下次唤醒时刻（epoch ms；BLOCKED(pending:agent) 存续期非空） */
  retryAt: integer('retry_at'),
  /** 声明文件集（JSON 数列字符串；随 submitSpec 提交冻结；空数组视同未声明） */
  plannedFiles: text('planned_files'),
  /** 排队原因（'GATE_QUEUED' | 'FILE_CONFLICT'；SPEC_READY 排队存续期非空） */
  queuedReason: text('queued_reason'),
  /** 排队进入时刻（epoch ms；FIFO 唤醒排序依据，重排队保持原值） */
  queuedAt: integer('queued_at'),
  /** 执行轮次（每次 spawn +1；首轮 1） */
  round: integer('round').notNull().default(0),
  /** 毫秒时间戳 */
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** blockedBy 依赖边：ticketId 被 blockedByTicketId 阻塞；DAG 完整性（禁自依赖/禁环）在服务层校验 */
export const ticketDependencies = sqliteTable(
  'ticket_dependencies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id),
    blockedByTicketId: integer('blocked_by_ticket_id')
      .notNull()
      .references(() => tickets.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('uq_ticket_dependency').on(t.ticketId, t.blockedByTicketId)],
);

/** 双向留言流（按时间正序展示） */
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id),
  /** 'user' | 'agent' | 'system' */
  authorType: text('author_type').notNull(),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** 状态转移日志（时间线与后续 L1 留痕共用） */
export const ticketTransitions = sqliteTable('ticket_transitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  operator: text('operator').notNull(),
  note: text('note'),
  createdAt: integer('created_at').notNull(),
});

/** 工单 commit 关联：各轮新增 commit 按（轮次, sha）落库；commit 以 git 实测为准 */
export const ticketCommits = sqliteTable(
  'ticket_commits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id),
    round: integer('round').notNull(),
    sha: text('sha').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('uq_ticket_commit').on(t.ticketId, t.round, t.sha)],
);

/** worker 完成报告（每轮一条；status 'done' | 'blocked'） */
export const ticketReports = sqliteTable('ticket_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id),
  round: integer('round').notNull(),
  status: text('status').notNull(),
  summary: text('summary').notNull(),
  blockReason: text('block_reason'),
  createdAt: integer('created_at').notNull(),
});

/** 实测防线：DONE settle 从基线 diff 提取的实际改动文件（每轮全量落库，与 commit 提取同源） */
export const ticketFiles = sqliteTable(
  'ticket_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id),
    round: integer('round').notNull(),
    path: text('path').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('uq_ticket_file').on(t.ticketId, t.round, t.path)],
);

/**
 * humanthink 会话（S2b1）：id 直接采用 serve 侧 sessionID（ses_*，serve 数据目录持久、
 * 重启不变，ATD 透传）。软删除=deletedAt 置位（列表排除、历史可查、操作端点拒绝）。
 */
export const humanthinkSessions = sqliteTable('humanthink_sessions', {
  /** serve sessionID（ses_ 前缀） */
  id: text('id').primaryKey(),
  workerId: text('worker_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  /** 会话工作目录（workspace 主仓绝对路径，建会话时固化） */
  directory: text('directory').notNull(),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  lastActiveAt: integer('last_active_at').notNull(),
  /** 软删除时刻（NULL=活跃） */
  deletedAt: integer('deleted_at'),
});

/**
 * humanthink 事件镜像（S2b1）：serve 全局流 durable 子集 + ATD 自有权限行 + message 对账行。
 * 幂等键=(session_id, serve_seq)——serve_seq 为 serve 事件信封 durable.seq；
 * 对账/权限等无信封行 serve_seq=NULL（SQLite UNIQUE 对 NULL 不约束，幂等走应用层先查后插）。
 * seq 为本地每会话递增展示序（SSE 回放游标）。
 */
export const humanthinkEvents = sqliteTable(
  'humanthink_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => humanthinkSessions.id),
    /** serve 事件信封 durable.seq（镜像行非空；无信封行为 NULL） */
    serveSeq: integer('serve_seq'),
    /** 本地每会话递增展示序（对外 SSE after 游标） */
    seq: integer('seq').notNull(),
    /** 镜像 type 值域冻结于 routes/types.ts（HumanThinkMirrorType） */
    type: text('type').notNull(),
    /** 事件载荷 JSON（HumanThinkEvent 序列化） */
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_ht_event_serve_seq').on(t.sessionId, t.serveSeq),
    uniqueIndex('uq_ht_event_seq').on(t.sessionId, t.seq),
  ],
);
