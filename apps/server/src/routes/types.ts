import type { Status, TicketType } from '../domain/status.js';
import type {
  Comment,
  Ticket,
  TicketDetail,
  TicketListItem,
  Transition,
} from '../domain/ticket-service.js';

/**
 * §3 API 契约的 TypeScript 形态——块 B（前端）以此为参照手抄同步，不跨包 import。
 * 统一包裹：成功=资源 JSON 本体；失败=ApiErrorEnvelope。
 */
export type { Status as TicketStatus, TicketType };
export type { Ticket, TicketListItem, Comment, Transition, TicketDetail };
export type TicketListResponse = { items: TicketListItem[] };
export type TicketDetailResponse = TicketDetail;
export type ApiErrorBody = { code: string; message: string; details?: string[] };
export type ApiErrorEnvelope = { error: ApiErrorBody };

/** POST /api/tickets/:id/dependencies 成功响应 */
export type AddDependencyResponse = { ok: true };
