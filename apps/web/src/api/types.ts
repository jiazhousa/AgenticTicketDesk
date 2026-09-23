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

/** 工单状态（S2a 八态：六态之上扩展 BLOCKED(pending:l3)/FAILED，转移边见 server 状态机） */
export type TicketStatus =
  | 'DRAFT'
  | 'SPEC_READY'
  | 'DISPATCHED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'DONE'
  | 'CANCELLED'
  | 'FAILED';

/**
 * workspace 内的仓声明（workspaces/*.yaml 声明式接入，只读——改 yaml 重启生效）。
 * role=primary 主仓（每 workspace 恰一个：工单缺省目标）；readable 可读仓（TASK 可指定为目标）。
 */
export interface WorkspaceRepo {
  id: string;
  /** 解析后绝对路径（声明相对仓根或 `~` 展开） */
  path: string;
  role: 'primary' | 'readable';
}

/** Workspace（项目群容器）：GET /api/workspaces 列表项（含主仓标识与工单计数） */
export interface Workspace {
  id: string;
  /** 显示名 */
  name: string;
  repos: WorkspaceRepo[];
  /** 主仓 repo id（冗余便于前端） */
  primary: string;
  /** 该 workspace 工单计数 */
  ticketCount: number;
}

/** GET /api/workspaces 响应（workspaces 数组包裹） */
export interface WorkspacesResponse {
  workspaces: Workspace[];
}

/** GET /api/workspaces/:id 响应（单资源 `{ workspace }` 包裹；未知 id → 404） */
export interface WorkspaceDetailResponse {
  workspace: Workspace;
}

/** 工单实体（§3 契约底部定义；S2a 增 round 执行轮次/pendingLabel 卡点层级；S2w1 增 workspace 挂载） */
export interface Ticket {
  id: number;
  type: TicketType;
  title: string;
  description: string | null;
  status: TicketStatus;
  parentId: number | null;
  specContent: string | null;
  workerId: string | null;
  /** 所属 workspace id（恒有；存量单由 migration DEFAULT 归属 atd） */
  workspaceId: string;
  /** 目标仓 id（仅 TASK 非 null；缺省=所属 workspace 主仓，落库为实际值） */
  repoRef: string | null;
  /** 执行轮次（spawn 起算，首轮 1；未执行为 0） */
  round: number;
  /** 卡点层级标签（'l3'，仅 BLOCKED 态非空；S3 扩 'agent'） */
  pendingLabel: string | null;
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

/** 详情响应（§3.3；S2a 增量：执行/报告/commit 关联/卡点单） */
export interface TicketDetail {
  ticket: Ticket;
  /** 子单列表 */
  children: Ticket[];
  /** blockedBy 指向的依赖单列表 */
  dependencies: Ticket[];
  blocks: Ticket[];
  /** 时间正序留言 */
  comments: TicketComment[];
  /** 转移历史（时间线数据源） */
  transitions: TicketTransition[];
  /** 存在 CANCELLED 子单时 true——A7 提示锚点，前端据此渲染告警条 */
  hasCancelledChildren: boolean;
  /** 当前绑定 worker 的展示名（Registry 注册名；未绑定为 null） */
  workerName: string | null;
  /** 当前轮执行信息（spawn 发起后非 null，进程结束置 null；null 不代表无历史轮） */
  execution: TicketExecution | null;
  /** 工单级 commit 关联（各轮新增并集，按轮落库） */
  commits: TicketCommit[];
  /** 最大轮完成报告（从未产出报告为 null） */
  report: TicketReport | null;
  /** 未关 BLOCKER 单（BLOCKED 存续期间恰好关联一张；其余态为 null） */
  blocker: Ticket | null;
}

/** 当前轮执行信息 */
export interface TicketExecution {
  /** 当前轮 spawn 时间（毫秒时间戳） */
  startedAt: number;
}

/** commit 关联（worker 各轮 git 实测归集；报告 commits 仅作交叉校验不直接采信） */
export interface TicketCommit {
  /** 产出该 commit 的执行轮次 */
  round: number;
  sha: string;
}

/** 完成报告（worker 在 worktree 根写 atd-report.json，编排层 zod 校验后落库） */
export interface TicketReport {
  round: number;
  /** 'done' 正常完成 / 'blocked' 卡点升级 */
  status: 'done' | 'blocked';
  /** 一句话完成摘要（done 时非空） */
  summary: string | null;
  /** 卡点说明（blocked 时非空）：上下文+建议选项+影响面 */
  blockReason: string | null;
}

/** Registry 中的 worker 档案（GET /api/workers 列表项） */
export interface WorkerInfo {
  /** profile 唯一标识（放行/改派时的 workerId） */
  id: string;
  /** 展示名 */
  name: string;
  /** 协议（S2a 仅 spawn-cli） */
  protocol: string;
  /** 能力集（S2a 仅 task；interactive 随 S2b） */
  capabilities: string[];
}

/** 统一事件流（@atd/worker-core events.ts 的 API 形态，手抄同步；字段按 UI 消费最小集宽松定义） */
export interface UnifiedEvent {
  type:
    | 'text-start'
    | 'text-delta'
    | 'text-end'
    | 'tool-call'
    | 'tool-result'
    | 'finish'
    | 'turn-start'
    | 'turn-end'
    | (string & {});
  /** 事件时间戳（毫秒，字段缺失时不展示时间） */
  timestamp?: number;
  /** text-delta：文本增量 */
  text?: string;
  /** tool-call / tool-result：工具名（不展开参数） */
  tool?: string;
  /** tool-result：工具执行出错标记 */
  errored?: boolean;
  /** finish：进程正常结束标记 */
  success?: boolean;
}

/** 执行日志响应（GET /api/tickets/:id/logs） */
export interface LogsResponse {
  /** 实际返回的轮次（请求缺省时为当前轮） */
  round: number;
  events: UnifiedEvent[];
}

/** 卡点裁决请求（POST /api/tickets/:blockerId/resolve） */
export interface ResolveBlockerRequest {
  /** continue=继续（原 worktree 换轮重跑）/ reassign=改派（复用 worktree 换 worker）/ abort=终止（父单 FAILED） */
  resolution: 'continue' | 'reassign' | 'abort';
  /** 裁决留言（落 BLOCKER 单） */
  note?: string;
  /** resolution=reassign 时必填：新 worker id */
  reassignWorkerId?: string;
}

/** 建单请求（§3.1；BLOCKER/DREAM 暂不接受创建；S2w1 增 workspace 挂载可选参数） */
export interface CreateTicketRequest {
  type: 'STORY' | 'TASK';
  title: string;
  description?: string;
  parentId?: number;
  /** 预绑定 worker（仅 TASK；编排链拆单场景——依赖满足后自动放行的前提） */
  workerId?: string;
  /** 所属 workspace（可选；缺省 atd，未知 id → 422 WORKSPACE_UNKNOWN；带 parentId 时强制继承父单） */
  workspaceId?: string;
  /** 目标仓 id（仅 TASK 可选；必须 ∈ 所属 workspace 的 repos id，缺省=主仓，非法值 → 422 REPO_REF_INVALID） */
  repoRef?: string;
}

/** 终态重开请求（POST /api/tickets/:id/reopen）：留言即本轮指令，原 worktree 续跑 */
export interface ReopenRequest {
  /** 重开留言（必填，作为新一轮执行的最高优先指令） */
  message: string;
  /** 换 worker（可选；缺省沿用当前绑定） */
  workerId?: string;
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
