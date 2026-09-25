# Spec: S2b1 HumanThink 聊天框（interactive 长会话）

- **topic**：atd-s2b1-humanthink
- **状态**：v3（r1 审查修订：事件通道改双通道/创建端点改 instance 面/权限规则表述修正/镜像集口径纠偏；待 r2 审查）
- **日期**：2026-09-25（v1 草案 / v2 澄清收敛 / v3 r1 修订）
- **上游**：Epic `agentic-ticket-desk` §4.3/§4.4/§9（S2b1 行，决策 C/D）；S2w1 spec §5 边界移交项
- **澄清记录**（2026-09-25 用户拍板）：① task 模式切共享 serve 拆独立 Story（探针结论记档）② UnifiedEvent 扩展取最小两类（+reasoning +permission_request）③ serve 数据目录不做深度隔离——独立端口+密码即视为零干扰达标（App 层定位）
- **对 Epic 的偏离清单**：① 决策 C「消息镜像」落地为 durable 事件镜像而非逐消息镜像（delta 不落库，全文由 durable text.ended 承载——与 opencode 官方 durable/live 分层语义对齐）
- **调研支撑**：Explorer 报告（2026-09-25）+ r1 审查源码核对（通道/端点/集合三处口径修正的锚点见业务规则）

## 背景

Epic 定位：聊天框（HumanThink）= 某个 worker 的 interactive 模式会话——用户选 worker（opencode 首实现）× workspace 对话，流式渲染，产出 spec 草稿放行提单（放行链归 S2b2）。S2a 的 task 模式是 spawn-CLI 一次性执行，无法承载长会话。

调研与 r1 核对的契约事实：① `opencode serve` 常驻 headless（127.0.0.1、无守护）；per-session directory 创建时固化（两面 API 均生效）② permission 注入在 **instance 面**（`POST /session` CreateInput.permission / `PATCH /session/:id`；v2 面 `/api/session` payload 无 permission）③ **事件分层**：per-session SSE（`?after` 可重放）**仅推 durable 集**；delta（text.delta/reasoning.delta 等）与 permission 事件仅在**全局 `GET /api/event`**（无 `?after`，live-only）④ durable 集（DurableDefinitions）= SessionV1+SessionEvent 型，**不含任何 permission 事件** ⑤ SDK 双 surface 覆盖；鉴权默认无（须显式设密码）。

## 范围

**做**：

- **serve 生命周期**（apps/server 新模块 humanthink/，挂载面=app.ts 装配 + index.ts 启动时序）：ATD server 启动拉起 `opencode serve`（127.0.0.1 + 独立端口；`OPENCODE_SERVER_PASSWORD` 由 ATD 生成注入子进程环境——MUST-6）；健康监测（`/global/health`）+ 崩溃自动重启 + 随 ATD 退出销毁
- **WorkerProfile 扩展**：capabilities 增 `interactive`；profile 增 interactive 段（serveCommand 模板，变量 `{port}`，缺省 `opencode serve --port {port}`）；Registry 校验（serveCommand 必含 `{port}` 且无 push/remote token）
- **会话面（ATD server，会话列表/详情读自有镜像表不透传）**：创建（见业务规则 2 端点契约）/ prompt / interrupt / 删除 / 权限审批中转 / 历史读镜像
- **权限模型（interactive 专用）**：per-session ruleset=**read 工具 catch-all deny + 各 workspace repo 前缀 allow**（findLast：repo 内读最后命中 allow 胜出、repo 外仅命中 deny 硬拒）；**其余工具不设规则**（默认 ask→审批 UI）
- **事件双通道**（见业务规则 4）：durable 镜像通道 + 全局 live 通道；web 经 ATD 统一 SSE 端点消费（不直连 serve）
- **UnifiedEvent 扩展**：+`reasoning` +`permission_request` 两类；**task 模式映射器零改动**（新事件型仅 interactive 消费面使用）；其余 serve 新型丢弃+debug 日志
- **重启恢复**：serve 重启后按 history `?after` 补拉镜像 + live 重连；ATD 重启后从镜像恢复
- **DB migration**（编号占位，实际以合并时 journal 序号为准——S3 已占 0004，本 Story 预期 0005；两 Story 同窗合流时由调度者统一 generate）：`humanthink_sessions`（id TEXT PK、worker_id、workspace_id、directory、title、created_at、last_active_at）+ `humanthink_events`（session_id、seq、type、payload JSON、created_at，UNIQUE(session_id, seq)）
- **web 聊天页**（`/humanthink`）：会话列表（workspace 过滤+标题 LIKE 检索）+ 聊天窗——流式文本（delta 逐字）、reasoning 折叠、工具调用卡片、审批弹卡、中断按钮、建会话弹窗（worker×workspace）
- **API 面**（9 端点，请求/响应概要）：
  - `POST /api/humanthink/sessions` body `{workerId, workspaceId, title?}` → `{session}`（session=id/title/workerId/workspaceId/directory/createdAt）
  - `GET /api/humanthink/sessions?workspaceId=&q=` → `{items: Session[]}`（读镜像表）
  - `GET /api/humanthink/sessions/:id` → `{session, events?}`（durable 回放）
  - `GET /api/humanthink/sessions/:id/events`（SSE：`?after` 回放镜像 + 实时双通道增量；载荷=ATD 统一事件型）
  - `POST /api/humanthink/sessions/:id/prompt` body `{text}` → `{admitted: true}`
  - `POST /api/humanthink/sessions/:id/interrupt` → `{ok: true}`
  - `DELETE /api/humanthink/sessions/:id` → `{ok: true}`（serve 会话删除+镜像保留标记）
  - `GET /api/humanthink/sessions/:id/permission/requests` → `{items: PermissionRequest[]}`（requestID/tool/pattern）
  - `POST /api/humanthink/sessions/:id/permission/:requestID/reply` body `{approve: boolean}` → `{ok: true}`

**不做**：

- 对话→spec 草稿→放行提单链（S2b2）；task 模式切换共享 serve（拆独立 Story——澄清①）
- 每 workspace 独立 serve；serve 数据目录隔离（澄清③）
- 全文搜索引擎、会话导出/分享、多 worker 混合会话、pi worker interactive
- UnifiedEvent 全集（tool.progress/成本，S4 如需再扩——澄清②）

## 验收标准（终版）

1. **聊天闭环**：web 选 opencode×workspace 建会话 → 发消息 → **text-delta 流式逐字渲染**（经 ATD 转发的 live 通道）→ 回复完整落镜像库（durable 全文）；reasoning 折叠展示；工具调用卡片展示
2. **历史可回溯**：会话列表按 workspace 过滤、标题检索；旧会话历史完整还原（镜像 durable 事件）；重启 ATD server + serve 后会话可续聊（history `?after` 补拉+live 重连，无重复无丢失——delta 不参与重放）
3. **standalone 零干扰**：ATD 托管 serve 与用户自用 background service 并存（不同端口互不影响）
4. **可读范围白名单**：诱导读 workspace 外路径 → read 硬 deny（catch-all deny 生效，不弹审批）；workspace 内读正常；敏感操作（bash/edit 等）→ ask 弹审批卡 → 批准继续/拒绝停止，会话不挂死
5. **中断生效**：生成中 interrupt → 停止输出，会话可续下一轮
6. **凭据卫生**：serve 密码仅存 ATD 进程环境与内存，不落任何仓内文件
7. **回归**：task 模式 spawn 链与映射器零改动；fence 全绿（schema 扩展/镜像/双通道转发单测含）

## 业务规则

1. **serve 拓扑**：单 serve 进程承载全部 workspace 会话（per-session directory 隔离）；端口 ATD 配置 `humanthinkPort`（缺省 4900 段）或自动分配；密码启动时生成（crypto random），仅内存与子进程 env
2. **会话创建契约（端点面显式化）**：创建走 **instance 面** `POST /session?directory=<workspace 主仓绝对路径>`（body：permission ruleset + title；directory 经 query 创建时固化——两面 API 均固化，选 instance 面因 permission 仅在该面且单次调用完成注入）；prompt/interrupt 走 v2 面（`POST /api/session/:id/prompt|interrupt`，durable-admit 语义）；删除走 instance 面 `DELETE /session/:id`；**ATD 会话列表/详情/检索读自有镜像表**，serve 侧 list 仅恢复对账用
3. **权限规则构造**：ruleset=[`{op:'deny', tool:[{name:'read', pattern:'**'}]}`] + 每 repo 一条 `{op:'allow', tool:[{name:'read', pattern:'<repoPath>/**'}]}`（findLast last-match-wins：repo 内读命中后置 allow，repo 外仅命中 catch-all deny）；edit/bash 等其余工具零规则（默认 ask）；审批闭环走 ATD 中转（轮询+live 提示双触发）
4. **事件双通道**：
   - **镜像通道（durable）**：per-session SSE `GET /api/session/:id/event?after=<seq>`（仅 durable 集）持续订阅落 `humanthink_events`；重启恢复用 `GET /api/session/:id/history?after` 分页补拉
   - **live 通道（delta+permission）**：全局 `GET /api/event` **一条**订阅（全 serve 共享），按 sessionID 分发到各会话的转发缓冲；delta 不落库不重放（全文由 durable `text.ended` 承载）
   - **web 转发**：`/api/humanthink/sessions/:id/events` 合并两路——`?after` 时先回放镜像再续实时；SSE 断线由 web 带 `?after` 重连
5. **permission 请求通道**（r1 纠偏：durable 集无 permission 事件）：pending 请求轮询 `GET /api/permission/request`（按会话过滤，间隔 2s）+ 全局 live 流 permission 事件即时提示；ATD 收到后**自行写入** `humanthink_events`（type=permission_request/resolved，ATD 自有型非 serve durable）——审批历史随镜像可回溯
6. **UnifiedEvent 新型**：`reasoning`（{text, phase: started/delta/ended}——镜像仅 started/ended，live 含 delta）；`permission_request`（{requestID, tool, pattern}）；映射按 serve 事件型分发，未知型丢弃+debug 日志
7. **恢复语义**：serve 崩溃 → ATD 健康检测失败 → 重启 serve → 活跃镜像会话 history `?after=<max seq>` 补拉 → live 全局流重连；ATD 重启 → serve 随之重启（serve 侧会话 SQLite 持久，sessionID 不变，镜像续写）
8. **API 鉴权内聚**：web 全走 ATD 端点（同源）；ATD→serve 用密码（env 注入）；不使用 `?auth_token=` 形态（ATD 代理后无必要）
9. **检索**：`q=` 对 title 与 durable 文本事件 payload LIKE（SQLite 单用户量级足够）

## 关键风险

| 风险 | 缓解 |
|---|---|
| 全局 live 流单订阅的分发正确性（错序/会话串扰） | 按 sessionID 分发+per-session 有界缓冲；用例覆盖双会话并发收流互不串扰 |
| serve 崩溃恢复窗口丢 live delta | delta 设计上可丢（durable 全文兜底）；恢复后 UI 以镜像全文对齐 |
| read catch-all deny 的 pattern 表达力（路径规范化/相对绝对） | 探针用例先行（验收 4 构造 repo 内/外/嵌套三路径）；不足则补 bash cd deny 兜底（不同键但同为越界防线，记档） |
| 两面 API 混用的版本耦合（instance 面标记 experimental） | SDK pin 版本；端点面选择集中声明于规则 2（单一事实源）；升级窗口测试 |
| web SSE 中转背压/断线 | 有界队列+`?after` 重连；参照既有 logs tail 模式 |
| 与 S3 migration 编号冲突 | 编号占位声明（S3=0004 在前）；同窗合流由调度者统一 generate |
