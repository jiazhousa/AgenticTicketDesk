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
  /** BLOCKED 存续期的卡点等级（'l3'；后续版本扩 'agent'），转出 BLOCKED 时置 NULL */
  pendingLabel: text('pending_label'),
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
