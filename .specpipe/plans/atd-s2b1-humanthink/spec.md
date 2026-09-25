# Spec: S2b1 HumanThink 聊天框（interactive 长会话）

- **topic**：atd-s2b1-humanthink
- **状态**：v2（三项澄清落定，待审查）
- **日期**：2026-09-25（v1 草案 / v2 澄清收敛）
- **上游**：Epic `agentic-ticket-desk` §4.3/§4.4/§9（S2b1 行，决策 C/D）；S2w1 spec §5 边界移交项
- **澄清记录**（2026-09-25 用户拍板）：① task 模式切共享 serve **拆独立 Story**（探针结论记档：per-session directory/permission 源码级成立 + 实际二进制 `run --server <url>`/`--auto` flag 在位，切换路径清晰；Epic 修订时立项）② UnifiedEvent 扩展取**最小两类**（+reasoning +permission_request，其余丢弃记档）③ serve 数据目录**不做深度隔离**——独立端口+密码即视为零干扰达标（用户定位：ATD 是 App 层应用，OpenCode 自身 TUI/GUI 亦是 App 层，数据面混合可接受；ATD 只需保证能调用 worker）
- **调研支撑**：Explorer 报告（2026-09-25，opencode serve/session/permission/SSE/SDK 契约）+ 调度者二进制探针（`--standalone` 存在、`serve` 明示 v2 API）

## 背景

Epic 定位：聊天框（HumanThink）= 某个 worker 的 interactive 模式会话——用户选 worker（opencode 首实现）× workspace 对话，流式渲染，产出 spec 草稿放行提单（放行链归 S2b2）。S2a 的 task 模式是 spawn-CLI 一次性执行，无法承载长会话。

调研关键事实（源码级背书）：① `opencode serve` 常驻 headless（默认 127.0.0.1、无守护需接入方管理）；**per-session directory 是 V2 一等字段**（session 落库固化，AGENTS.md/项目 config/LSP 随 per-directory 实例切换）② **per-session 权限 ruleset 原生支持**（创建注入+运行中 PATCH；findLast last-match-wins；无命中默认 ask）；审批闭环 API 齐备 ③ SSE `?after` 游标重放；**durable 事件集不含 delta**（`text.ended` 载全文）——镜像吃 durable、live 渲染吃 delta 有官方语义背书 ④ 会话持久化 serve 侧，`history?after` 支持断线续流 ⑤ SDK v2 surface 全覆盖；鉴权默认无（须显式设密码）。

## 范围

**做**：

- **serve 生命周期**（apps/server 新模块 humanthink/）：ATD server 启动拉起 `opencode serve`（127.0.0.1 + 独立端口，避开用户自用 background service；`OPENCODE_SERVER_PASSWORD` 由 ATD 生成注入子进程环境——MUST-6）；健康监测（`/global/health`）+ 崩溃自动重启 + 随 ATD 退出销毁
- **WorkerProfile 扩展**：capabilities 增 `interactive`；profile 增 interactive 段（serveCommand 模板，变量 `{port}`，缺省 `opencode serve --port {port}`）；Registry 校验
- **会话面（ATD server）**：创建（workerId+workspaceId → serve `POST /api/session`：`location.directory`=workspace 主仓绝对路径 + per-session permission ruleset）/ 列表（workspace 过滤+标题 LIKE）/ 详情 / prompt 透传（durable-admit）/ interrupt / 删除（instance 面 DELETE 透传）
- **权限模型（interactive 专用）**：per-session ruleset = workspace 外路径 read **硬 deny** + 其余默认 ask；审批经 ATD 中转（pending request 拉取 + reply）——人在环是 interactive 特性（与 task 模式 catch-all allow 相反）
- **事件镜像与转发**：ATD 消费 serve SSE（`?after` 游标），durable 事件落 `humanthink_events`；web 经 ATD SSE 端点拿 live delta + durable 回放（web 不直连 serve）
- **UnifiedEvent 扩展**：+`reasoning` +`permission_request` 两类；其余（tool.progress/tool.input.delta/step.ended 成本等）丢弃记档
- **重启恢复**：serve 重启后按 history `?after` 补拉镜像；ATD 重启后从镜像恢复会话列表与历史
- **DB migration 0005**：`humanthink_sessions`（id TEXT PK=serve sessionID、worker_id、workspace_id、directory、title、created_at、last_active_at）+ `humanthink_events`（session_id、seq、type、payload JSON、created_at，UNIQUE(session_id, seq)）
- **web 聊天页**（`/humanthink`）：会话列表（workspace 过滤）+ 聊天窗——流式文本、reasoning 折叠、工具调用卡片、审批弹卡、中断按钮、建会话弹窗（worker×workspace）
- **API 面**：`POST /api/humanthink/sessions`、`GET ...?workspaceId=&q=`、`GET .../:id`、`GET .../:id/events`（SSE）、`POST .../:id/prompt`、`POST .../:id/interrupt`、`DELETE .../:id`、`GET .../:id/permission/requests`、`POST .../:id/permission/:requestID/reply`

**不做**：

- 对话→spec 草稿→放行提单链（S2b2 消费场景）
- task 模式切换共享 serve（拆独立 Story——澄清①）
- 每 workspace 独立 serve 进程；serve 数据目录隔离（澄清③：端口+密码即达标）
- 全文搜索引擎（标题+内容 LIKE）、会话导出/分享、多 worker 混合会话
- pi worker interactive（协议形态位预留）
- UnifiedEvent 事件型全集（tool.progress/成本等，S4 如需再扩——澄清②）

## 验收标准（终版）

1. **聊天闭环**：web 选 opencode×workspace 建会话 → 发消息 → text-delta 流式逐字渲染 → 回复完整落库；reasoning 折叠展示；工具调用卡片展示
2. **历史可回溯**：会话列表按 workspace 过滤、标题检索；旧会话历史完整还原；重启 ATD server + serve 后会话可续聊（游标续流，无重复无丢失）
3. **standalone 零干扰**：ATD 托管 serve 与用户自用 background service 并存（不同端口互不影响；用户自用侧无感知扰动）
4. **可读范围白名单**：诱导读 workspace 外路径 → 硬 deny（不弹审批）；workspace 内敏感操作 → ask 弹审批卡 → 批准继续/拒绝停止，会话不挂死
5. **中断生效**：生成中 interrupt → 停止输出，会话可续下一轮
6. **凭据卫生**：serve 密码仅存 ATD 进程环境与内存，不落任何仓内文件（profile 凭据扫描用例扩 interactive 段）
7. **回归**：task 模式 spawn 链零改动；fence 全绿（schema 扩展/镜像/转发单测含）

## 业务规则

1. **serve 拓扑**：单 serve 进程承载全部 workspace 会话（per-session directory 隔离）；端口从 ATD 配置 `humanthinkPort`（缺省 4900 段独立位）或自动分配；密码启动时生成（crypto random），仅在内存与子进程 env
2. **会话创建契约**：directory=workspace 主仓绝对路径（resolveRepoPath）；permission ruleset=deny read 越界 pattern（workspace repos 之外路径）+ 显式 allow 各 repo 前缀（后置 allow 胜出）+ 不设 catch-all（保留默认 ask）
3. **镜像口径**：只落 durable 事件（`DurableDefinitions` 集：prompted/step.*/text.started-ended/tool.called-success-failed/reasoning.started-ended/permission 相关 durable 型）；delta 仅 live 转发不落库；seq 严格递增按 serve 事件序
4. **转发通道**：web SSE 经 ATD `/api/humanthink/sessions/:id/events`——ATD 侧维护 per-session 订阅（serve SSE 消费复用镜像通道，一份数据两用：镜像写库+live 转发）；`?after` 支持 web 重连回放
5. **审批中转**：pending 审批按 session 聚合拉取（轮询或 serve 事件流内的 permission 事件触发）；reply 透传 serve 对应端点；拒绝后 worker 收到拒绝继续对话（不挂死）
6. **UnifiedEvent 新型**：`reasoning`（{text 增量或全文, phase: started/delta/ended}——镜像仅 started/ended 全文，live 含 delta）；`permission_request`（{requestID, tool, pattern}）；映射器按 serve `session.next.*` 事件型分发，未识别型丢弃（记 debug 日志）
7. **恢复语义**：serve 崩溃重启 → ATD 检测健康失败 → 重启 serve → 对全部活跃镜像会话按 `history?after=<max seq>` 补拉 → live 通道自动重连；ATD 重启 → serve 随之重启（会话在 serve 侧 SQLite 持久，sessionID 不变，镜像表续写）
8. **API 鉴权内聚**：web 全部走 ATD 端点（同源）；ATD→serve 用密码（env 注入）；`?auth_token=` 形态不使用（token 入 URL 有日志面风险，ATD 侧代理后无必要）
9. **检索**：`q=` 参数对 title 与 durable 文本事件 payload 做 LIKE（SQLite 单用户量级足够）
10. **profile 校验**：interactive 段 serveCommand 必须含 `{port}` 变量且不含 push/remote token（复用既有扫描）；capabilities 含 interactive 才出现在聊天框 worker 下拉

## 关键风险

| 风险 | 缓解 |
|---|---|
| serve 崩溃恢复的窗口丢事件 | SSE `?after` 游标 + history 补拉双通道；用例覆盖「崩溃-重启-补拉-续聊」全链 |
| per-session permission ruleset 的 pattern 表达力不足（read 越界 deny 是否精确） | 探针用例先行（验收 4 构造越界/内界双路径）；ruleset 不够则 fallback：目录级 deny（bash cd 越界）补充 |
| web SSE 经 ATD 中转的背压/断线 | ATD 侧订阅缓存有界队列 + web `?after` 重连；参照既有 logs tail 端点模式 |
| 事件型演进（serve 版本升级新增型） | 映射器未知型丢弃+debug 日志，不 fail；SDK pin 版本 |
| 与用户自用 opencode 的资源竞争（同机多 opencode 进程） | 独立端口+独立密码+独立进程组；health 监测隔离 |
