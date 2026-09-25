/**
 * 工单 API fetch 封装（对应 impl §3 八端点）。
 * 统一 error.code 感知 + 失败 toast：非 2xx 时抛出携带 code/details 的 ApiError，
 * 并在此处统一弹出服务端 message（组件层无需重复 toast）。
 */
import { message } from 'antd';
import type {
  ApiErrorBody,
  CreateTicketRequest,
  LogsResponse,
  ReopenRequest,
  ResolveTicketRequest,
  ResolveTicketResponse,
  Ticket,
  TicketComment,
  TicketDetail,
  TicketListItem,
  TicketStatus,
  TicketType,
  UpdateTicketRequest,
  WorkerInfo,
  Workspace,
  WorkspaceDetailResponse,
  WorkspacesResponse,
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
 * opts.silent=true 时不弹 toast（事件流轮询等高频场景，错误由调用方行内展示）。
 * 注：antd 静态 message 无法消费 ConfigProvider 主题上下文，本地单用户工具可接受。
 */
async function request<T>(
  path: string,
  init?: RequestInit,
  opts: { silent?: boolean } = {},
): Promise<T> {
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
    if (!opts.silent) {
      message.error(text);
    }
    if (err?.code) {
      throw new ApiError(err.code, text, details);
    }
    if (!opts.silent) {
      message.error(`请求失败（HTTP ${res.status}）`);
    }
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

/**
 * POST /api/tickets/:id/reopen —— 终态重开（仅 TASK 终态单）。
 * 留言即本轮指令（原 worktree 续跑）；可选换 worker。
 * 返回重开后的工单（DISPATCHED，自动派发）。
 */
export function reopenTicket(id: number, req: ReopenRequest): Promise<Ticket> {
  return request<Ticket>(`/api/tickets/${id}/reopen`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** §3.2 GET /api/tickets?status=&type=&workspaceId= —— 列表（默认 createdAt DESC），含父子摘要；workspaceId 不传=全量 */
export async function listTickets(
  params: { status?: TicketStatus; type?: TicketType; workspaceId?: string } = {},
): Promise<{ items: TicketListItem[] }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  if (params.workspaceId) qs.set('workspaceId', params.workspaceId);
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

/**
 * §3.5 POST /api/tickets/:id/spec —— 提交 spec（独立路径，转入 SPEC_READY 冻结快照）。
 * plannedFiles 可选声明（每行一路径语义由 UI 层解析；空数组视同未声明，此处直接省字段）。
 */
export function submitSpec(id: number, specContent: string, plannedFiles?: string[]): Promise<Ticket> {
  const body = plannedFiles != null && plannedFiles.length > 0 ? { specContent, plannedFiles } : { specContent };
  return request<Ticket>(`/api/tickets/${id}/spec`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** §3.6 POST /api/tickets/:id/transition —— 状态转移（operator 固定 'user'；TASK 放行必带 workerId） */
export function transitionTicket(
  id: number,
  to: TicketStatus,
  note?: string,
  workerId?: string,
): Promise<Ticket> {
  return request<Ticket>(`/api/tickets/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to, note, workerId }),
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

/** GET /api/workers —— Registry worker 档案列表（放行/改派选择数据源） */
export function getWorkers(): Promise<WorkerInfo[]> {
  return request<WorkerInfo[]>('/api/workers');
}

/**
 * GET /api/workspaces —— workspace 列表（含 repos 明细/主仓标识/工单计数）。
 * 响应体 `{ workspaces: [...] }` 在此解包，调用方直接拿数组。
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await request<WorkspacesResponse>('/api/workspaces');
  return res.workspaces;
}

/** GET /api/workspaces/:id —— workspace 详情（未知 id → 404）；响应体 `{ workspace }` 在此解包 */
export async function getWorkspace(id: string): Promise<Workspace> {
  const res = await request<WorkspaceDetailResponse>(`/api/workspaces/${encodeURIComponent(id)}`);
  return res.workspace;
}

/**
 * GET /api/tickets/:id/logs?round=&tail= —— 执行日志尾部（统一事件流）。
 * 轮询高频场景：静默失败（不弹全局 toast），错误由 WorkerCard 行内展示。
 */
export function getLogs(
  id: number,
  params: { round?: number; tail?: number } = {},
): Promise<LogsResponse> {
  const qs = new URLSearchParams();
  if (params.round != null) qs.set('round', String(params.round));
  if (params.tail != null) qs.set('tail', String(params.tail));
  const suffix = qs.toString() !== '' ? `?${qs.toString()}` : '';
  return request<LogsResponse>(`/api/tickets/${id}/logs${suffix}`, undefined, { silent: true });
}

/**
 * POST /api/tickets/:id/resolve —— 卡点裁决（id=阻塞原单；卡点内联语义，无独立卡点单）。
 * continue=原 worktree 续跑 / reassign=换 worker 续跑 / abort=原单 FAILED。
 * 返回转出后的原单；非 BLOCKED 态 422 RESOLUTION_INVALID。
 */
export function resolveTicket(id: number, req: ResolveTicketRequest): Promise<ResolveTicketResponse> {
  return request<ResolveTicketResponse>(`/api/tickets/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** DELETE /api/tickets/:id/worktree?keepBranch= —— 回收 worktree（执行中/非终态 422 WORKTREE_ACTIVE） */
export function reclaimWorktree(id: number, keepBranch: boolean): Promise<void> {
  return request<void>(`/api/tickets/${id}/worktree?keepBranch=${keepBranch}`, {
    method: 'DELETE',
  });
}
