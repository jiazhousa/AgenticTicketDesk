import { AppError } from '../domain/errors.js';
import type { ServeHandle } from './serve-manager.js';

/**
 * humanthink 会话面（S2b1 技术方案 3+5）：ATD ↔ serve 的 HTTP 中转。
 * v2 端点族（探针实证契约）；serve 404 → 统一 SESSION_NOT_FOUND 兜底；
 * serve 未就绪/网络失败 → WORKER_UNAVAILABLE。fetch seam 供测试注入。
 */

export type SessionMessage = {
  id: string;
  type: string;
  time: { created: number };
  /** user 消息全文 */
  text?: string;
  /** assistant 消息分段（text/reasoning/tool） */
  content?: Array<Record<string, unknown>>;
};

export type MessagePage = {
  data: SessionMessage[];
  cursor: { previous: string | null; next: string | null };
};

export type PendingPermission = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
};

export class SessionFacade {
  constructor(
    private readonly deps: {
      serve: () => ServeHandle | null;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    const handle = this.deps.serve();
    if (handle == null) throw new AppError('WORKER_UNAVAILABLE', 'humanthink 服务不可用（serve 未就绪或已降级）');
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(`${handle.baseUrl}${path}`, {
        ...init,
        headers: { authorization: handle.authHeader, 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
    } catch (err) {
      throw new AppError('WORKER_UNAVAILABLE', `humanthink 服务连接失败：${(err as Error).message}`);
    }
    if (res.status === 404) throw new AppError('SESSION_NOT_FOUND', '会话在 agent 服务侧不存在');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError('WORKER_UNAVAILABLE', `agent 服务返回 HTTP ${res.status}${body ? `：${body.slice(0, 200)}` : ''}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (text === '') return null;
    // 返回整体 JSON——v2 端点信封不一致（多数 {location?, data}，message 列表 {data, cursor}，
    // interrupt 裸形），取形由各方法自行完成
    return JSON.parse(text);
  }

  /** 创建会话：目录=workspace 主仓；agent=atd-ht-{workspaceId}；返回 serve sessionID */
  async createSession(agent: string, directory: string, title?: string): Promise<{ id: string }> {
    const parsed = (await this.call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ agent, location: { directory }, ...(title != null ? { title } : {}) }),
    })) as { data?: { id?: string } };
    const id = parsed?.data?.id;
    if (typeof id !== 'string') throw new AppError('WORKER_UNAVAILABLE', 'agent 服务会话创建响应异常');
    return { id };
  }

  /** 发送 prompt（请求体字段=text，探针漂移 1）；返回 serve 侧用户消息 id */
  async prompt(sessionId: string, text: string): Promise<{ messageId: string }> {
    const parsed = (await this.call(`/api/session/${sessionId}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })) as { data?: { id?: string } };
    const id = parsed?.data?.id;
    if (typeof id !== 'string') throw new AppError('WORKER_UNAVAILABLE', 'agent 服务 prompt 响应异常');
    return { messageId: id };
  }

  /** 中断当前执行（openapi 实证存在；空转时 interrupted=false；响应裸形无信封） */
  async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
    const parsed = (await this.call(`/api/session/${sessionId}/interrupt`, { method: 'POST', body: '{}' })) as {
      interrupted?: boolean;
    };
    return { interrupted: parsed?.interrupted === true };
  }

  /** 删除会话（v2 面 DELETE，实测 204；ATD 侧另有软删除行） */
  async deleteSession(sessionId: string): Promise<void> {
    await this.call(`/api/session/${sessionId}`, { method: 'DELETE' });
  }

  /** 会话级待审列表（弹审卡兜底轮询源） */
  async listPermissions(sessionId: string): Promise<PendingPermission[]> {
    const parsed = (await this.call(`/api/session/${sessionId}/permission`)) as { data?: PendingPermission[] };
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  /** 审批决策：只透传 once/reject 两档（always 不开放——saved 与用户自用共享，防静默授权扩散） */
  async replyPermission(sessionId: string, requestID: string, decision: 'once' | 'reject', message?: string): Promise<void> {
    await this.call(`/api/session/${sessionId}/permission/${requestID}/reply`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(message != null ? { message } : {}) }),
    });
  }

  /** 会话消息分页——serve 约束：cursor 不能与 order 同传（cursor 沿首页方向续翻），仅首页带 order */
  async listMessages(sessionId: string, opts: { limit?: number; order?: 'asc' | 'desc'; cursor?: string } = {}): Promise<MessagePage> {
    const qs = new URLSearchParams();
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.cursor != null) qs.set('cursor', opts.cursor);
    else qs.set('order', opts.order ?? 'desc');
    const parsed = (await this.call(`/api/session/${sessionId}/message?${qs.toString()}`)) as Partial<MessagePage>;
    return {
      data: Array.isArray(parsed?.data) ? parsed.data : [],
      cursor: parsed?.cursor ?? { previous: null, next: null },
    };
  }

  /** 单消息详情（文本权威兜底的核对源） */
  async getMessage(sessionId: string, messageID: string): Promise<SessionMessage> {
    const parsed = (await this.call(`/api/session/${sessionId}/message/${messageID}`)) as { data?: SessionMessage };
    if (parsed?.data == null) throw new AppError('WORKER_UNAVAILABLE', 'agent 服务消息详情响应异常');
    return parsed.data;
  }
}

/** assistant 消息全文提取：content 内 type=text 分段按序拼接（对账行权威文本） */
export function assistantText(msg: SessionMessage): string {
  const parts = msg.content ?? [];
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n');
}
