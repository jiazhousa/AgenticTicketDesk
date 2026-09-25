/**
 * API 契约类型（与 impl §3 字段级契约一致）。
 * 手抄同步自 apps/server/src/routes/types.ts（不跨包 import）——
 * 契约变更时两侧需同步修改。
 *
 * 统一包裹：成功 = 资源 JSON 本体；失败 = `{ error: { code, message, details? } }`。
 * 时间戳字段均为毫秒数（DB 层 INTEGER ms，Drizzle 映射为 API 层 camelCase）。
 */

/** 工单类型（§1：实际仅使用 STORY / TASK；BLOCKER 类型已废除——卡点=原单 BLOCKED 状态，枚举位保留与 server 契约镜像；DREAM 为全集占位） */
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

/** 工单实体（§3 契约底部定义；S2a 增 round 执行轮次/pendingLabel 卡点层级；S2w1 增 workspace 挂载；S3 增排队/重试自愈五字段——排队不走状态机，保持 SPEC_READY） */
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
  /** 卡点层级标签（'l3'=人工裁决卡点；'agent'=自动重试等待；仅 BLOCKED 态非空） */
  pendingLabel: string | null;
  /** 卡点原因全文（内联卡点语义：仅 BLOCKED 态非空，转出自动清空；用户裁决依据/自动重试失败摘要） */
  blockReason: string | null;
  /** 排队原因（放行前置未过落入排队：闸门满两通道一律/文件集冲突仅 system 通道；仅 SPEC_READY 排队中非空，成功放行或取消清空） */
  queuedReason: 'GATE_QUEUED' | 'FILE_CONFLICT' | null;
  /** 排队时刻（毫秒时间戳；FIFO 唤醒位依据，唤醒后仍不满足则保持原值重排队） */
  queuedAt: number | null;
  /** 自动重试计数（RETRY_WAIT 进入即递增，达 maxRetries 升级 l3；continue/reassign/reopen 清零） */
  retryCount: number;
  /** 下次自动重试时刻（毫秒时间戳；BLOCKED(pending:agent) 等待中非空，升级 l3 后不再排期） */
  retryAt: number | null;
  /** 计划改动文件声明（相对 repoRef 路径，尾斜杠=目录递归包含；随 submitSpec 提交冻结，未声明为 null） */
  plannedFiles: string[] | null;
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

/** 详情响应（§3.3；S2a 增量：执行/报告/commit 关联；卡点内联于 ticket.blockReason，无独立聚合） */
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
  /**
   * 声明能力的可承载性（S2b1：Registry 校验——interactive 能力但协议不支撑 serve 常驻时 false，
   * 聊天框新建会话下拉过滤依据）；缺省视为可用。
   */
  available?: boolean;
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
    /** S2b1 扩展：推理块（humanthink 面映射，{text, phase}） */
    | 'reasoning'
    /** S2b1 扩展：审批请求/裁决（含历史回溯并入同型，status 区分待审与已裁决） */
    | 'permission_request'
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
  /** reasoning：推理阶段标记 */
  phase?: string;
  /** permission_request：审批请求 id */
  requestID?: string;
  /** permission_request：动作词汇（shell/read/external_directory/…） */
  action?: string;
  /** permission_request：资源路径列表 */
  resources?: string[];
  /** permission_request：审批状态（pending=待审，resolved=已裁决） */
  status?: 'pending' | 'resolved';
}

/** 执行日志响应（GET /api/tickets/:id/logs） */
export interface LogsResponse {
  /** 实际返回的轮次（请求缺省时为当前轮） */
  round: number;
  events: UnifiedEvent[];
}

/** 卡点裁决请求（POST /api/tickets/:id/resolve，id=阻塞原单——卡点内联于原单，无独立卡点单） */
export interface ResolveTicketRequest {
  /** continue=继续（原 worktree 换轮重跑）/ reassign=改派（复用 worktree 换 worker）/ abort=终止（原单 FAILED） */
  resolution: 'continue' | 'reassign' | 'abort';
  /** 裁决留言（落原单留言时间线） */
  note?: string;
  /** resolution=reassign 时必填：新 worker id（缺失 422 WORKER_REQUIRED / 未注册 422 WORKER_UNKNOWN） */
  reassignWorkerId?: string;
}

/** 卡点裁决响应：转出后的原单（continue/reassign → IN_PROGRESS/DISPATCHED；abort → FAILED） */
export interface ResolveTicketResponse {
  ticket: Ticket;
}

/** 建单请求（§3.1；DREAM 暂不接受创建，BLOCKER 类型已废除；S2w1 增 workspace 挂载可选参数） */
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

/* ==================== S2b1 HumanThink 聊天面（手抄同步，对齐 impl「API 契约冻结」节） ==================== */

/**
 * HumanThink 会话（humanthink_sessions 的 API 形态）。
 * 三分语义：列表排除已删；详情恒可读（内嵌历史事件）；已删（deletedAt 非空）会话的
 * prompt/interrupt/delete/reply/SSE 一律 422 SESSION_TERMINATED——前端转只读视图。
 */
export interface HumanThinkSession {
  /** 会话 id（serve 侧 sessionID，SSE/操作端点定位符） */
  id: string;
  workerId: string;
  workspaceId: string;
  /** 会话工作目录（serve 侧 location.directory） */
  directory: string;
  title: string;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 删除时刻（毫秒）；非空=已删除只读 */
  deletedAt: number | null;
}

/** POST /api/humanthink/sessions 建会话请求体 */
export interface CreateHumanThinkSessionRequest {
  workerId: string;
  workspaceId: string;
  title?: string;
}

/** POST /api/humanthink/sessions 响应（`{ session }` 包裹） */
export interface CreateHumanThinkSessionResponse {
  session: HumanThinkSession;
}

/** GET /api/humanthink/sessions?workspaceId=&q= 响应（排除已删；q=title+文本 payload LIKE） */
export interface HumanThinkSessionListResponse {
  items: HumanThinkSession[];
}

/** 镜像行信封（GET /api/humanthink/sessions/:id 详情 events 数组项——server 序列化形态） */
export interface HumanThinkMirrorRow {
  seq: number;
  serveSeq: number | null;
  type: string;
  event: HumanThinkEvent;
  createdAt: number;
}

/** GET /api/humanthink/sessions/:id 响应（详情内嵌只读历史事件——已删会话历史的唯一读通道） */
export interface HumanThinkSessionDetailResponse {
  session: HumanThinkSession;
  events: HumanThinkMirrorRow[];
}

/** 待审权限请求项（GET .../:id/permission/requests 列表项，items=当前待审集合） */
export interface HumanThinkPermissionRequest {
  requestID: string;
  /** 动作词汇（shell/read/external_directory/…） */
  action: string;
  resources: string[];
}

/** GET .../:id/permission/requests 响应 */
export interface HumanThinkPermissionListResponse {
  items: HumanThinkPermissionRequest[];
}

/** POST .../permission/:requestID/reply 请求体（once=当次批准；always 不开放——防静默授权扩散） */
export interface HumanThinkPermissionReplyRequest {
  decision: 'once' | 'reject';
  message?: string;
}

/** prompt 响应（消息已受理，回复经事件流返回） */
export interface HumanThinkPromptResponse {
  admitted: true;
}

/** interrupt / delete / reply 共用 `{ ok: true }` 响应 */
export interface HumanThinkOkResponse {
  ok: true;
}

/**
 * 镜像事件 type 值域：durable 镜像行（serve 事件派生 + ATD 自有审批两型）+ live delta 转发帧。
 * durable 帧带 seq（断线重连游标）；delta 帧无 seq（不重放，UI 以镜像全文对齐）。
 */
export type HumanThinkEventType =
  /** 助手消息全文（镜像主源，载荷 text） */
  | 'text.ended'
  | 'reasoning.started'
  /** 思考全文（载荷缺全文时仅标记） */
  | 'reasoning.ended'
  | 'tool.called'
  | 'tool.success'
  | 'tool.failed'
  | 'tool.progress'
  | 'step.started'
  | 'step.ended'
  | 'permission.asked'
  | 'permission.rejected'
  /** ATD 自有：审批请求落镜像（恢复后回溯依据） */
  | 'permission_request'
  /** ATD 自有：审批裁决落镜像 */
  | 'permission_resolved'
  /** 以下为 live 转发帧（不落镜像、不重放） */
  | 'session.text.delta'
  | 'session.reasoning.delta';

/**
 * HumanThink 事件（humanthink_events 行/转发帧的 API 形态；字段按 UI 消费最小集宽松展开，
 * 同 UnifiedEvent 惯例——payload 字段平铺在事件对象上）。
 */
export interface HumanThinkEvent {
  type: HumanThinkEventType | (string & {});
  /** 本地展示序（每会话递增）；durable 镜像行必有，delta 转发帧无（断线重连以最后 durable seq 为 after） */
  seq?: number;
  /** 事件时间戳（毫秒，字段缺失时不展示时间） */
  timestamp?: number;
  /** text.ended / reasoning.ended / session.*.delta：文本全文或增量 */
  text?: string;
  /** 对账行若携带角色信息，user 消息渲染为用户气泡（镜像不含用户消息型，此为防御位） */
  role?: 'user' | 'assistant';
  /** tool.*：工具名 */
  tool?: string;
  /** permission.* / permission_request / permission_resolved：审批请求 id */
  requestID?: string;
  /** permission.*：动作词汇 */
  action?: string;
  /** permission.*：资源路径列表 */
  resources?: string[];
  /** permission_request：审批状态（pending=待审，resolved=已裁决） */
  status?: 'pending' | 'resolved';
  /** permission_resolved：裁决值（once=当次批准，reject=拒绝） */
  decision?: 'once' | 'reject';
}

/** SSE 帧：`data: {seq?, event}`——durable 事件带 seq、delta 帧无 seq */
export interface HumanThinkEventFrame {
  seq?: number;
  event: HumanThinkEvent;
}
