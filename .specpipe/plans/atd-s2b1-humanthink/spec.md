# Spec: S2b1 HumanThink 聊天框（interactive 长会话）

- **topic**：atd-s2b1-humanthink
- **状态**：v4（r2 审查修订：权限机制改 V2 agent 级-动态 agent 注入路径；待 r3 审查）
- **日期**：2026-09-25（v1 草案 / v2 澄清 / v3 r1 / v4 r2 修订）
- **上游**：Epic `agentic-ticket-desk` §4.3/§4.4/§9（S2b1 行，决策 C/D）；S2w1 spec §5 移交项
- **澄清记录**（2026-09-25 用户拍板）：① task 模式切共享 serve 拆独立 Story ② UnifiedEvent 最小两类 ③ serve 数据目录不深度隔离（App 层定位）
- **对 Epic 的偏离清单**：① 决策 C「消息镜像」=durable 事件镜像（delta 不落库）② 决策 D「standalone 实例池」演进为**单常驻 serve 多会话**（非 per-session 实例池；Epic 措辞随修订同步）③ 权限机制=V2 agent 级（per-workspace 动态 agent），非 session 级 ruleset（r2 发现两套权限系统互不通用，选型见业务规则 3）④ s2w1 §5「task 一并切换」拆独立 Story（澄清①）
- **调研支撑**：Explorer 报告 + r1/r2 审查源码核对（两套权限系统的事实锚点见背景）

## 背景

Epic 定位：聊天框（HumanThink）= worker interactive 会话——选 worker×workspace 对话、流式渲染、产出 spec 草稿（放行链归 S2b2）。

契约事实（含 r2 核对修正）：① `opencode serve` 常驻 headless；per-session directory 创建时固化 ② **两套权限系统互不通用**：session 级 V1（instance 面 CreateInput.permission，仅 app 工具消费）与 agent 级 V2（v2 面 prompt→SessionRunner→materialize(agent.permissions)，core read 走 PermissionV2.assert，从不读 session V1）——v2 prompt 面只有 agent 级生效 ③ 事件分层：per-session SSE（`?after`）仅 durable；delta 与 `permission.v2.*` 仅全局 `GET /api/event` ④ durable 集无 permission 事件 ⑤ 全局流上游 `allBounded(256)`，溢出 fail-closed 断流 ⑥ v2 面 create payload 含 agent/location；无 delete（delete 在 instance 面）。

## 范围

**做**：

- **serve 生命周期**（新模块 humanthink/，挂载 app.ts 装配+index.ts 启动时序）：ATD 启动拉起 `opencode serve`（127.0.0.1+独立端口+`OPENCODE_SERVER_PASSWORD` 内存生成注入）；健康监测+崩溃重启+随 ATD 退出销毁；**启动失败降级**：重试 3 次后 humanthink 模块标 degraded（聊天页提示「worker 服务不可用」），不阻塞工单主功能
- **serve 启动配置注入（权限载体）**：`OPENCODE_CONFIG_CONTENT` 注入 per-workspace 动态 agent 定义（见业务规则 3）
- **WorkerProfile 扩展**：capabilities +`interactive`；profile interactive 段（serveCommand 模板变量 `{port}`，缺省 `opencode serve --port {port}`）；Registry 校验
- **会话面（列表/详情/检索读 ATD 镜像表）**：创建（v2 面，见规则 2）/prompt（v2 面 durable-admit）/interrupt（v2 面）/删除（instance 面 DELETE + 镜像 deleted_at 标记）/权限审批中转
- **事件双通道**（规则 4）+ web 经 ATD 统一 SSE（不直连 serve）
- **UnifiedEvent 扩展**：+`reasoning` +`permission_request`；task 模式映射器零改动；未知型丢弃+debug 日志
- **重启恢复**：history `?after` 补拉镜像+live 重连；ATD 重启从镜像恢复
- **DB migration**（编号占位，S3 占 0004 本 Story 预期 0005；同窗合流由调度者统一 generate）：`humanthink_sessions`（id TEXT PK、worker_id、workspace_id、directory、title、created_at、last_active_at、**deleted_at 可空**）+ `humanthink_events`（session_id、**seq（ATD 本地每会话递增）**、type、payload JSON、created_at，UNIQUE(session_id, seq)）
- **web 聊天页** `/humanthink`（会话列表/聊天窗/审批弹卡/中断/建会话弹窗）+ `api/types.ts` 手抄契约同步义务
- **API 面**（9 端点概要，错误形态对齐仓内 AppError 信封）：
  - `POST /api/humanthink/sessions` `{workerId, workspaceId, title?}` → `{session}`
  - `GET ...?workspaceId=&q=` → `{items}`（镜像表）；`GET .../:id` → `{session, events?}`
  - `GET .../:id/events`（SSE：`?after` 回放镜像+实时增量；帧=`data: {<UnifiedEvent JSON>}`）
  - `POST .../:id/prompt` `{text}` → `{admitted:true}`；`POST .../:id/interrupt` → `{ok:true}`
  - `DELETE .../:id` → `{ok:true}`（serve 删除+镜像 deleted_at）
  - `GET .../:id/permission/requests` → `{items}`（V2 形字段，探针定案）
  - `POST .../:id/permission/:requestID/reply` `{approve}` → `{ok:true}`

**不做**：S2b2 放行链；task 模式切换（拆独立 Story）；per-workspace serve 进程；数据目录隔离；全文搜索/导出/多 worker 混合/pi interactive；UnifiedEvent 全集。

**前置探针（impl 前置，二进制实测，探针报告归 plans/）**：
- P1：V2 agent permission 的字面 shape 与 read 强制路径（动态 agent permissions 定义→v2 面 prompt→core read 越界被拒的端到端实证）
- P2：未配置规则的工具默认行为（期望 ask→审批流；若默认非 ask 则补 catch-all ask 规则入 agent 定义）
- P3：`permission.v2.*` 事件在 `/api/event` 的载荷字段（PermissionRequest 形状定案）

## 验收标准（终版）

1. **聊天闭环**：建会话→发消息→text-delta 流式逐字渲染（live 通道经 ATD 转发）→回复全文落镜像（durable）；reasoning 折叠；工具卡片
2. **历史可回溯**：列表过滤/检索；旧会话完整还原；重启 ATD+serve 后续聊（history 补拉+live 重连，无重复无丢失）
3. **standalone 零干扰**：ATD serve 与用户自用 background service 并存互不影响
4. **可读范围白名单**（经动态 agent V2 权限）：workspace 外 read 硬拒；workspace 内读正常；未配置工具（bash/edit）ask 弹审批卡→批准/拒绝后会话继续（P2 探针结论落地）
5. **中断生效**；6. **凭据卫生**（密码仅进程 env+内存）；7. **回归**：task spawn 链与映射器零改动；fence 全绿

## 业务规则

1. **serve 拓扑**：单 serve 多会话（per-session directory 隔离）；`humanthinkPort`（4900 段）或自动分配；密码 crypto random 仅内存+子进程 env
2. **会话创建（端点面定案）**：v2 面 `POST /api/session`——`agent='atd-ht-{workspaceId}'`（动态 agent，见规则 3）+ `location.directory`=workspace 主仓绝对路径；**permission 不经会话注入**（V2 链不读它——r2 事实），经 agent 定义预注入；删除=instance 面 `DELETE /session/:id`；ATD 列表/详情读镜像
3. **权限构造（动态 agent 路径）**：serve 启动时 `OPENCODE_CONFIG_CONTENT` 注入 agents 定义——每 workspace 一个 `atd-ht-{workspaceId}`：permissions=V2 规则集（语义：read 越界 deny + 各 repo 前缀 allow；未配置工具期望默认 ask——P2 若否补 catch-all ask）；**字面 shape 以 P1 探针定案**（spec 冻结语义不冻结字段拼写）；agent 模型沿用 serve 全局默认（ATD 不另配 model）；serve 为 ATD 自有进程，进程级注入零污染（与 task 模式 MUST-2 同机制）
4. **事件双通道**：镜像=per-session SSE `?after`（durable 落 `humanthink_events`，**seq=ATD 本地每会话递增分配**（serve 原序存 payload 元数据）——serve 行与 ATD 自写行（permission 型）同一 seq 空间，回放排序=本地 seq 单调，r2 混装问题消除）；恢复=history `?after` 分页补拉（按镜像最大本地 seq 对应的 serve 游标——payload 元数据携带）；live=全局 `GET /api/event` 一条共享订阅按 sessionID 分发（delta 不落库不重放）
5. **permission 通道**：轮询 v2 会话级 `/api/session/:id/permission`（2s）+live `permission.v2.*` 即时提示；ATD 收到后写镜像（type=permission_request/resolved，ATD 自有型）——审批历史随镜像回溯；reply 透传 v2 端点
6. **UnifiedEvent 新型**：`reasoning`（{text, phase}——镜像 started/ended，live 含 delta）；`permission_request`（{requestID, …V2 载荷字段，P3 定案}）
7. **恢复语义**：serve 崩溃→健康检测→重启→补拉+live 重连；全局流断流（含 allBounded 溢出 fail-closed）→**重连+durable 对齐**（delta 设计可丢，UI 以镜像全文对齐）；ATD 重启→serve 随之重启（sessionID 持久）
8. **API 鉴权内聚**：web 全走 ATD（同源）；ATD→serve 密码 env；不用 `?auth_token=`
9. **检索**：`q=` 对 title+durable 文本 payload LIKE
10. **web 手抄契约**：`apps/web/src/api/types.ts` 同步义务（humanthink 面 Session/事件/审批类型）入 web 任务块

## 关键风险

| 风险 | 缓解 |
|---|---|
| V2 权限 shape/强制路径与预期不符（P1 探针失败） | 探针前置阻塞 impl；fallback=路径③（prompt 改 instance 面+V1 session ruleset+事件通道重定义——架构推翻预案，探针后 24h 内重审） |
| 未配置工具默认非 ask（P2） | agent 定义补 catch-all ask 规则（V2 形） |
| 全局流 allBounded(256) 溢出断流 | ATD 消费转发为进程内低延迟路径（现实难以触顶）；断流自愈=重连+durable 对齐（delta 可丢设计兜底） |
| 两面 API 混用版本耦合 | SDK pin+端点面集中声明（规则 2/5 单一事实源）+升级窗口测试 |
| 动态 agent 与用户 serve 配置冲突 | serve 为 ATD 自有进程（独立端口/密码/数据面），无共享配置 |
| web SSE 背压/断线 | 有界队列+`?after` 重连（logs tail 同款） |
| migration 编号（S3=0004 在前） | 占位声明；同窗合流调度者统一 generate |
