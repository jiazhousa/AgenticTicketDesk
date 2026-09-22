/**
 * 工单 API fetch 封装（对应 impl §3 八端点）。
 * 统一 error.code 感知 + 失败 toast：非 2xx 时抛出携带 code/details 的 ApiError，
 * 并在此处统一弹出服务端 message（组件层无需重复 toast）。
 */
import { message } from 'antd';
import type {
  ApiErrorBody,
  CreateTicketRequest,
  Ticket,
  TicketComment,
  TicketDetail,
  TicketListItem,
  TicketStatus,
  TicketType,
  UpdateTicketRequest,
} from './types';

/** 携带契约错误码的请求异常（code 见 impl §2.4 错误码全集） */
export class ApiError extends Error {
  readonly code: string;
  readonly details?: string[];

  constructor(code: string, msg: string, details?: string[]) {
    super(msg);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 底层请求：解析统一错误包裹体 `{ error: { code, message, details? } }`。
 * 204 无响应体（DELETE 依赖）。
 * 注：antd 静态 message 无法消费 ConfigProvider 主题上下文，本地单用户工具可接受。
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 204) {
    return undefined as T;
  }
  // 成功 = 资源 JSON 本体；失败 = 错误包裹体
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    const details = err?.details;
    const text = details?.length ? `${err?.message ?? '请求失败'}（${details.join('；')}）` : (err?.message ?? '请求失败');
    if (err?.code) {
      message.error(text);
      throw new ApiError(err.code, text, details);
    }
    message.error(`请求失败（HTTP ${res.status}）`);
    throw new ApiError('UNKNOWN', `请求失败（HTTP ${res.status}）`);
  }
  return body as T;
}

/** §3.1 POST /api/tickets —— 建单（S1 仅 STORY/TASK），返回 201 Ticket */
export function createTicket(req: CreateTicketRequest): Promise<Ticket> {
  return request<Ticket>('/api/tickets', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** §3.2 GET /api/tickets?status=&type= —— 列表（默认 createdAt DESC），含父子摘要 */
export async function listTickets(
  params: { status?: TicketStatus; type?: TicketType } = {},
): Promise<{ items: TicketListItem[] }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  const suffix = qs.toString() !== '' ? `?${qs.toString()}` : '';
  return request<{ items: TicketListItem[] }>(`/api/tickets${suffix}`);
}

/** §3.3 GET /api/tickets/:id —— 详情（含子单/依赖/留言/转移历史/A7 锚点） */
export function getTicket(id: number): Promise<TicketDetail> {
  return request<TicketDetail>(`/api/tickets/${id}`);
}

/** §3.4 PATCH /api/tickets/:id —— 编辑（仅 DRAFT 态，至少一项） */
export function updateTicket(id: number, req: UpdateTicketRequest): Promise<Ticket> {
  return request<Ticket>(`/api/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  });
}

/** §3.5 POST /api/tickets/:id/spec —— 提交 spec（独立路径，转入 SPEC_READY 冻结快照） */
export function submitSpec(id: number, specContent: string): Promise<Ticket> {
  return request<Ticket>(`/api/tickets/${id}/spec`, {
    method: 'POST',
    body: JSON.stringify({ specContent }),
  });
}

/** §3.6 POST /api/tickets/:id/transition —— 状态转移（operator 固定 'user'） */
export function transitionTicket(id: number, to: TicketStatus, note?: string): Promise<Ticket> {
  return request<Ticket>(`/api/tickets/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to, note }),
  });
}

/** §3.7 POST /api/tickets/:id/comments —— 留言（authorType/authorName 由 server 固定） */
export function addComment(id: number, content: string): Promise<TicketComment> {
  return request<TicketComment>(`/api/tickets/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

/** §3.8 POST /api/tickets/:id/dependencies —— 添加 blockedBy 依赖 */
export function addDependency(id: number, blockedByTicketId: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/tickets/${id}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ blockedByTicketId }),
  });
}

/** §3.8 DELETE /api/tickets/:id/dependencies/:blockedById —— 移除依赖（204） */
export function removeDependency(id: number, blockedById: number): Promise<void> {
  return request<void>(`/api/tickets/${id}/dependencies/${blockedById}`, {
    method: 'DELETE',
  });
}
