/**
 * API 契约类型（与 impl §3 字段级契约一致）。
 * 手抄同步自 apps/server/src/routes/types.ts（不跨包 import）——
 * 契约变更时两侧需同步修改。
 *
 * 统一包裹：成功 = 资源 JSON 本体；失败 = `{ error: { code, message, details? } }`。
 * 时间戳字段均为毫秒数（DB 层 INTEGER ms，Drizzle 映射为 API 层 camelCase）。
 */

/** 工单类型（§1：S1 实际仅使用 STORY / TASK；BLOCKER/DREAM 为枚举全集占位） */
export type TicketType = 'STORY' | 'TASK' | 'BLOCKER' | 'DREAM';

/** 工单状态（M1 六态，§2.1 转移白名单为唯一合法边集） */
export type TicketStatus =
  | 'DRAFT'
  | 'SPEC_READY'
  | 'DISPATCHED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'CANCELLED';

/** 工单实体（§3 契约底部定义） */
export interface Ticket {
  id: number;
  type: TicketType;
  title: string;
  description: string | null;
  status: TicketStatus;
  parentId: number | null;
  specContent: string | null;
  workerId: string | null;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 毫秒时间戳 */
  updatedAt: number;
}

/** 列表项（§3.2：Ticket 追加父子关系摘要） */
export interface TicketListItem extends Ticket {
  childrenCount: number;
  parentTitle: string | null;
}

/** 留言（§1 comments 表的 API 形态；authorType 枚举值域由 server zod 校验兜底） */
export interface TicketComment {
  id: number;
  ticketId: number;
  authorType: 'user' | 'agent' | 'system';
  authorName: string;
  content: string;
  /** 毫秒时间戳 */
  createdAt: number;
}

/** 状态转移记录（§1 ticket_transitions 表的 API 形态） */
export interface TicketTransition {
  id: number;
  ticketId: number;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  operator: string;
  note: string | null;
  /** 毫秒时间戳 */
  createdAt: number;
}

/** 详情响应（§3.3） */
export interface TicketDetail {
  ticket: Ticket;
  /** 子单列表 */
  children: Ticket[];
  /** blockedBy 指向的依赖单列表 */
  dependencies: Ticket[];
  /** 时间正序留言 */
  comments: TicketComment[];
  /** 转移历史（时间线数据源） */
  transitions: TicketTransition[];
  /** 存在 CANCELLED 子单时 true——A7 提示锚点，前端据此渲染告警条 */
  hasCancelledChildren: boolean;
}

/** 建单请求（§3.1；BLOCKER/DREAM 暂不接受创建） */
export interface CreateTicketRequest {
  type: 'STORY' | 'TASK';
  title: string;
  description?: string;
  parentId?: number;
}

/** 编辑请求（§3.4：仅 DRAFT 态可用，至少一项） */
export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  specContent?: string;
}

/** 错误包裹体（§3 统一失败格式） */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
}
