import type { Status, TicketType } from '../domain/status.js';
import type {
  Comment,
  Ticket,
  TicketDetail,
  TicketListItem,
  Transition,
  TicketCommitInfo,
  TicketReportInfo,
} from '../domain/ticket-service.js';

/** §3 API 契约的 TypeScript 形态——块 B（前端）以此为参照手抄同步，不跨包 import。
 * 统一包裹：成功=资源 JSON 本体；失败=ApiErrorEnvelope。
 * S3 起 Ticket 携带排队/自愈/声明五字段（queuedReason/queuedAt/retryCount/retryAt/plannedFiles），
 * 列表与详情随 Ticket 透出；submitSpec 入参扩 plannedFiles（routes 层内联 zod，无独立 Body 类型）。
 */
export type { Status as TicketStatus, TicketType };
export type { Ticket, TicketListItem, Comment, Transition, TicketDetail, TicketCommitInfo, TicketReportInfo };
export type TicketListResponse = { items: TicketListItem[] };
export type ApiErrorBody = { code: string; message: string; details?: string[] };
export type ApiErrorEnvelope = { error: ApiErrorBody };

/** workspace 声明视图（path=解析后绝对路径；primary=主仓 repo id 冗余便于前端） */
export type WorkspaceRepo = { id: string; path: string; role: 'primary' | 'readable' };
export type WorkspaceInfo = {
  id: string;
  name: string;
  repos: WorkspaceRepo[];
  primary: string;
  ticketCount: number;
};
/** GET /api/workspaces / GET /api/workspaces/:id 响应（未知 id → 404） */
export type WorkspacesResponse = { workspaces: WorkspaceInfo[] };
export type WorkspaceDetailResponse = { workspace: WorkspaceInfo };

/** POST /api/tickets 建单请求体（workspaceId/repoRef 均可选；校验规则见 spec FR-3/FR-4） */
export type CreateTicketBody = {
  type: TicketType;
  title: string;
  description?: string;
  parentId?: number;
  workerId?: string;
  workspaceId?: string;
  repoRef?: string;
};

/** GET /api/tickets 查询参数（workspaceId 可选过滤，不传=全量） */
export type TicketListQuery = { status?: Status; type?: TicketType; workspaceId?: string };

/** POST /api/tickets/:id/dependencies 成功响应 */
export type AddDependencyResponse = { ok: true };

/** GET /api/workers 响应（注册表列表，放行弹层/改派弹层数据源） */
export type WorkerInfo = { id: string; name: string; protocol: string; capabilities: string[] };
export type WorkersResponse = WorkerInfo[];

/** POST /api/tickets/:id/transition 请求体（TASK 放行必带 workerId） */
export type TransitionBody = { to: Status; note?: string; workerId?: string };

/**
 * GET /api/tickets/:id 响应：领域详情 + 编排层补充
 * （workerName=注册表展示名；execution.startedAt=当前/最近轮 spawn 时间，未执行过为 null）
 */
export type TicketDetailResponse = TicketDetail & {
  workerName: string | null;
  execution: { startedAt: number } | null;
};

/** 统一事件流（@atd/worker-core 同构镜像，块 B 手抄参照） */
export type UnifiedEvent =
  | { type: 'turn-start' | 'turn-end' | 'text-start' | 'text-end'; timestamp?: number; reason?: string }
  | { type: 'text-delta'; timestamp?: number; text: string }
  | { type: 'tool-call' | 'tool-result'; timestamp?: number; tool: string; errored?: boolean }
  | { type: 'finish'; timestamp?: number; success: boolean };

/** GET /api/tickets/:id/logs?round=&tail= 响应（tail 缺省 50、上限 500） */
export type LogsResponse = { round: number; events: UnifiedEvent[] };

/** DELETE /api/tickets/:id/worktree?keepBranch= 响应（执行中/非终态 422 WORKTREE_ACTIVE） */
export type ReclaimWorktreeResponse = { ok: true };

/** POST /api/tickets/:id/resolve 请求体与响应（卡点裁决，目标即原单 BLOCKED 态） */
export type ResolveTicketBody = {
  resolution: 'continue' | 'reassign' | 'abort';
  note?: string;
  reassignWorkerId?: string;
};
export type ResolveTicketResponse = { ticket: Ticket };
