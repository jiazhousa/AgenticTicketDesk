/**
 * HumanThink 聊天 API 封装（11 端点 + SSE，契约冻结于 impl「API 契约冻结」节）。
 * 错误语义同 tickets.ts：非 2xx 解析 AppError 信封抛 ApiError + toast；
 * 轮询/SSE 相关调用走 silent（错误由调用方行内展示或据此转只读/降级视图）。
 * 复用 tickets.ts 导出的 ApiError（跨模块单一错误类型，调用方统一 catch）。
 */
import { message } from 'antd';
import { ApiError } from './tickets';
import type {
  ApiErrorBody,
  CreateHumanThinkSessionRequest,
  CreateHumanThinkSessionResponse,
  HumanThinkEventFrame,
  HumanThinkOkResponse,
  HumanThinkPermissionListResponse,
  HumanThinkPermissionReplyRequest,
  HumanThinkPermissionRequest,
  HumanThinkPromptResponse,
  HumanThinkSession,
  HumanThinkSessionDetailResponse,
  HumanThinkSessionListResponse,
  PlanConfirmResponse,
  PlanPayload,
  PlanValidateResponse,
} from './types';

/** 会话资源路径前缀（11 端点共用） */
const BASE = '/api/humanthink/sessions';

/** 同 tickets.ts 底层请求：成功=资源 JSON 本体；失败=`{ error: { code, message, details? } }` → ApiError */
async function request<T>(
  path: string,
  init?: RequestInit,
  opts: { silent?: boolean } = {},
): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    const details = err?.details;
    const text = details?.length
      ? `${err?.message ?? '请求失败'}（${details.join('；')}）`
      : (err?.message ?? `请求失败（HTTP ${res.status}）`);
    if (!opts.silent) {
      message.error(text);
    }
    throw err?.code != null ? new ApiError(err.code, text, details) : new ApiError('UNKNOWN', text);
  }
  return body as T;
}

/** POST /api/humanthink/sessions —— 建会话（worker × workspace 开聊），返回 `{ session }` 解包 */
export async function createHtSession(req: CreateHumanThinkSessionRequest): Promise<HumanThinkSession> {
  const res = await request<CreateHumanThinkSessionResponse>(BASE, {
    method: 'POST',
    body: JSON.stringify(req),
  });
  return res.session;
}

/**
 * GET /api/humanthink/sessions?workspaceId=&q= —— 会话列表（排除已删）。
 * deleted=true 查已删会话（「已删除」查看入口：列出 deletedAt 非空会话，点击进只读详情）。
 */
export async function listHtSessions(
  params: { workspaceId?: string; q?: string; deleted?: boolean } = {},
): Promise<HumanThinkSession[]> {
  const qs = new URLSearchParams();
  if (params.workspaceId) qs.set('workspaceId', params.workspaceId);
  if (params.q) qs.set('q', params.q);
  if (params.deleted) qs.set('deleted', '1');
  const suffix = qs.toString() !== '' ? `?${qs.toString()}` : '';
  const res = await request<HumanThinkSessionListResponse>(`${BASE}${suffix}`, undefined, { silent: true });
  return res.items;
}

/** GET /api/humanthink/sessions/:id —— 详情（含已删；内嵌只读历史事件） */
export function getHtSession(id: string): Promise<HumanThinkSessionDetailResponse> {
  return request<HumanThinkSessionDetailResponse>(`${BASE}/${encodeURIComponent(id)}`, undefined, { silent: true });
}

/** POST /api/humanthink/sessions/:id/prompt —— 发消息（admitted=已受理，回复经事件流返回） */
export function promptHtSession(id: string, text: string): Promise<HumanThinkPromptResponse> {
  return request<HumanThinkPromptResponse>(`${BASE}/${encodeURIComponent(id)}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** POST /api/humanthink/sessions/:id/interrupt —— 中断当前生成 */
export function interruptHtSession(id: string): Promise<HumanThinkOkResponse> {
  return request<HumanThinkOkResponse>(`${BASE}/${encodeURIComponent(id)}/interrupt`, {
    method: 'POST',
  });
}

/** DELETE /api/humanthink/sessions/:id —— 删除会话（列表移除、历史仍可查） */
export function deleteHtSession(id: string): Promise<HumanThinkOkResponse> {
  return request<HumanThinkOkResponse>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * GET /api/humanthink/sessions/:id/permission/requests —— 当前待审集合。
 * 2s 轮询高频场景：静默失败，错误由调用方处理（SESSION_TERMINATED → 转只读）。
 */
export async function listHtPermissionRequests(id: string): Promise<HumanThinkPermissionRequest[]> {
  const res = await request<HumanThinkPermissionListResponse>(
    `${BASE}/${encodeURIComponent(id)}/permission/requests`,
    undefined,
    { silent: true },
  );
  return res.items;
}

/** POST /api/humanthink/sessions/:id/permission/:requestID/reply —— 审批裁决（once=当次批准/reject=拒绝） */
export function replyHtPermission(
  id: string,
  requestID: string,
  req: HumanThinkPermissionReplyRequest,
): Promise<HumanThinkOkResponse> {
  return request<HumanThinkOkResponse>(
    `${BASE}/${encodeURIComponent(id)}/permission/${encodeURIComponent(requestID)}/reply`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  );
}

/**
 * POST /api/humanthink/sessions/:id/plan/validate —— 拆单计划预检（200 恒定返回 issues）。
 * 服务端校验单源（repoRef/workerId/局部 id/依赖/文件集形态），issues 空即通过；
 * 卡内编辑后手动触发，字段级标红以响应定位。
 */
export function validateHtPlan(id: string, plan: PlanPayload): Promise<PlanValidateResponse> {
  return request<PlanValidateResponse>(`${BASE}/${encodeURIComponent(id)}/plan/validate`, {
    method: 'POST',
    body: JSON.stringify(plan),
  });
}

/**
 * POST /api/humanthink/sessions/:id/plan/confirm —— 确认建单（200 双态，不走 AppError 信封）。
 * ok=true：原子建 STORY+TASK 链（含依赖与 spec 冻结）并触发根任务放行，返回局部 id→真实单号映射；
 * ok=false：零建单，issues 同 validate 定位标红。
 */
export function confirmHtPlan(id: string, plan: PlanPayload): Promise<PlanConfirmResponse> {
  return request<PlanConfirmResponse>(`${BASE}/${encodeURIComponent(id)}/plan/confirm`, {
    method: 'POST',
    body: JSON.stringify(plan),
  });
}

/* ==================== SSE 订阅（同源 EventSource） ==================== */

/** SSE 订阅句柄：close 后不再重连 */
export interface HtEventSubscription {
  close: () => void;
}

/** 订阅回调集 */
export interface HtEventHandlers {
  /** 每帧回调（durable 带 seq / delta 无 seq） */
  onFrame: (frame: HumanThinkEventFrame) => void;
  /** 连接状态变化（初始 connecting 不回调；重连成功回 connected） */
  onStateChange?: (state: 'connected' | 'reconnecting') => void;
}

/** 断线重建间隔（EventSource 原生重连复用旧 URL 的 after 游标，故关闭自管重建） */
const SSE_RECONNECT_MS = 2000;

/**
 * 订阅会话事件流：`GET .../:id/events?after=<本地 seq>`（先回放镜像再续 live）。
 * 断线重连以最后 durable seq 为 after 重建连接（delta 设计不重放，UI 以镜像全文对齐）；
 * 调用方对 durable 帧按 seq 去重后并入视图。
 */
export function subscribeHtEvents(
  sessionId: string,
  handlers: HtEventHandlers,
  initialAfter?: number,
): HtEventSubscription {
  // 游标：已收到的最后 durable seq（重建连接的 after 依据）
  let after = initialAfter;
  let closed = false;
  let es: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    const qs = after != null ? `?after=${after}` : '';
    es = new EventSource(`${BASE}/${encodeURIComponent(sessionId)}/events${qs}`);
    es.onopen = () => {
      if (!closed) handlers.onStateChange?.('connected');
    };
    es.onmessage = (ev: MessageEvent<string>) => {
      let frame: HumanThinkEventFrame | null = null;
      try {
        frame = JSON.parse(ev.data) as HumanThinkEventFrame;
      } catch {
        return; // 非 JSON 帧（心跳注释行等不会进 onmessage，双保险跳过）
      }
      if (frame == null || typeof frame.event !== 'object' || frame.event == null) return;
      if (typeof frame.seq === 'number') {
        // durable 帧：推进重连游标
        after = frame.seq;
      }
      handlers.onFrame(frame);
    };
    es.onerror = () => {
      // 关闭原生重连（其复用旧 URL，after 游标过期），以最新游标定时重建
      es?.close();
      es = null;
      if (closed) return;
      handlers.onStateChange?.('reconnecting');
      retryTimer = setTimeout(connect, SSE_RECONNECT_MS);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer != null) clearTimeout(retryTimer);
      es?.close();
      es = null;
    },
  };
}
