# Spec: S2b1 HumanThink 聊天框（interactive 长会话）

- **topic**：atd-s2b1-humanthink
- **状态**：v5（r3 审查修订：注入载体换 OPENCODE_CONFIG_DIR 生成文件链（core 唯一可读通道）/权限规则按 read 相对路径+external_directory 语义重构/探针拆分 P1a-c 各配 fallback；待 r4 审查）
- **日期**：2026-09-25（v1 草案 / v2 澄清 / v3 r1 / v4 r2 / v5 r3 修订）
- **上游**：Epic `agentic-ticket-desk` §4.3/§4.4/§9（S2b1 行，决策 C/D）；S2w1 spec §5 移交项
- **澄清记录**（2026-09-25 用户拍板）：① task 模式切共享 serve 拆独立 Story ② UnifiedEvent 最小两类 ③ serve 数据目录不深度隔离（App 层定位）
- **对 Epic 的偏离清单**：① 决策 C「消息镜像」=durable 事件镜像（delta 不落库）② 决策 D「standalone 实例池」演进为单常驻 serve 多会话 ③ 权限机制=V2 agent 级（per-workspace 动态 agent，载体=私有配置目录生成文件，非 session ruleset）④ s2w1 §5「task 一并切换」拆独立 Story
- **调研支撑**：Explorer 报告 + r1/r2/r3 审查源码核对（关键事实链见背景）

## 背景

Epic 定位：聊天框 = worker interactive 会话——选 worker×workspace 对话、流式渲染、产出 spec 草稿（放行链 S2b2）。

契约事实链（r1-r3 逐轮核定的最终口径）：① `opencode serve` 常驻 headless；per-session directory 创建时固化 ② **权限双系统互不通用**：v2 prompt 面（SessionRunner）只消费 **core AgentV2 权限**；session 级 V1 仅 app 工具链 ③ **core 配置是纯文件加载，只读 `OPENCODE_CONFIG_DIR`**（`OPENCODE_CONFIG_CONTENT` 仅 V1 链消费，到不了 core）——动态 agent 的唯一可行载体=私有配置目录+生成 opencode.json（core V2 键形 `agents`）④ **agent 未注册是静默 fail-closed**（不报错→全工具 deny→审批事件永不产生）——载体正确性必须探针先行 ⑤ read 的 resource 为**相对路径**，越界动作=`external_directory`；用户全局顶层 permissions 会前置注入（单向覆盖风险）⑥ 事件分层：per-session SSE（`?after`）仅 durable；delta 与 `permission.v2.*` 仅全局 `GET /api/event`（上游 allBounded(256)，溢出 fail-closed 断流）⑦ v2 面 create 含 agent/location，无 delete（delete 在 instance 面）⑧ location 配置打开时读一次并缓存（serve 生命周期内 workspace 集不变——与「workspace 热更新不做」一致）。

## 范围

**做**：

- **serve 生命周期**（新模块 humanthink/，挂载 app.ts+index.ts）：ATD 启动**先生成配置目录再拉起** `opencode serve`（127.0.0.1+独立端口+`OPENCODE_SERVER_PASSWORD` 内存生成注入+**`OPENCODE_CONFIG_DIR` 指向私有目录**）；健康监测+崩溃重启+随 ATD 销毁；启动失败重试 3 次后 degraded（聊天页提示不可用，不阻塞工单主功能）；**serve 生命周期内 workspace 集不变**（新增 workspace 需重启 ATD——记档边界）
- **配置生成（权限载体，r3-critical 修正）**：启动时生成 `{dataDir}/opencode-config/opencode.json`——① agents 段（core V2 键形）：每 workspace 一个 `atd-ht-{workspaceId}`（permissions 见规则 3）② **合并用户全局配置的 model/provider 段**（读 `~/.config/opencode/opencode.json` 相关键集——CONFIG_DIR 为整体替换语义，不并入则 ModelNotSelectedError；具体键集 P1a 定案）；生成文件随启动重写（幂等）
- **WorkerProfile**：opencode.yaml capabilities 声明启用 `interactive` 能力位（worker-core schema 枚举已含该值，仅 profile 加值非 schema 扩展——r3-l4 措辞修正）；interactive 段（serveCommand 模板变量 `{port}`）；Registry 校验
- **会话面**：创建（v2 面：agent+directory 双锚定）/prompt（v2 面）/interrupt（v2 面）/删除（instance 面+镜像 deleted_at）/审批中转；列表/详情/检索读镜像
- **事件双通道**+web 经 ATD 统一 SSE（ATD 本 Story 引入 SSE 端点形态——非既有模式复用，r3-l4 措辞修正）
- **UnifiedEvent**：+`reasoning` +`permission_request`；task 模式映射器零改动；未知型丢弃+debug 日志
- **重启恢复**：history `?after` 补拉（serve 游标独立持久化，见规则 4）+live 重连
- **DB migration**（编号占位，S3 占 0004 本 Story 预期 0005）：`humanthink_sessions`（id TEXT PK、worker_id、workspace_id、directory、title、created_at、last_active_at、deleted_at 可空、**serve_cursor**（serve 侧 durable 游标持久化——r3-l1））+ `humanthink_events`（session_id、seq（ATD 本地每会话递增）、type、payload JSON、created_at，UNIQUE(session_id, seq)）
- **web 聊天页** `/humanthink` + `api/types.ts` 手抄契约同步义务
- **API 面**（9 端点，错误码枚举：`WORKER_UNAVAILABLE`（degraded，503）/`SESSION_NOT_FOUND`（404）/`SESSION_TERMINATED`（422，已删除会话操作）/`VALIDATION`（422，复用））：
  - `POST /api/humanthink/sessions` `{workerId, workspaceId, title?}` → `{session}`
  - `GET ...?workspaceId=&q=` → `{items}`（默认排除 deleted_at 非空行）；`GET .../:id` → `{session, events?}`
  - `GET .../:id/events`（SSE：`?after` 回放+实时；帧=`data: {<UnifiedEvent JSON>}`）
  - `POST .../:id/prompt` `{text}` → `{admitted:true}`；`POST .../:id/interrupt` → `{ok:true}`
  - `DELETE .../:id` → `{ok:true}`
  - `GET .../:id/permission/requests` → `{items}`；`POST .../:id/permission/:requestID/reply` `{approve}` → `{ok:true}`

**不做**：S2b2 放行链；task 模式切换（拆 Story）；per-workspace serve；数据目录隔离；serve 生命周期内 workspace 热增；全文搜索/导出/多 worker/pi；UnifiedEvent 全集。

**前置探针（impl 前置阻塞，二进制实测，报告归 plans/；r3-m2 拆分各配 fallback）**：
- **P1a 载体注册**：OPENCODE_CONFIG_DIR+生成文件（含合并 model/provider）→ serve 起 → v2 create agent=`atd-ht-x` → `agents.select` 命中（会话事件流可见 agent 生效、无静默 deny）。**fallback：无**（载体为源码事实级唯一路径，失败即重审整体路径③）
- **P1b 规则 shape**：permissions 键形/相对 pattern 形态/`external_directory` 动作名/首条 `{*:*,ask}` 收口与 readable-allow 的次序——探明后冻结规则字面。**fallback：调整规则形态，不动架构**
- **P1c 端到端**：越界读硬拒/主仓与 readable 仓读通/敏感工具 ask→审批事件可轮询可回复。**fallback：审批 UI 降级为纯轮询（无 live 提示）**
- P2（并入 P1c）默认行为验证；P3：`permission.v2.*` 载荷字段定案

## 验收标准（终版）

1. **聊天闭环**：建会话→发消息→text-delta 流式逐字渲染（live 通道经 ATD 转发）→回复全文落镜像（durable）；reasoning 折叠；工具卡片
2. **历史可回溯**：列表过滤/检索；旧会话完整还原；重启 ATD+serve 后续聊（补拉+重连，无重复无丢失）
3. **standalone 零干扰**：与用户自用 background service 并存互不影响；ATD 生成的配置目录在 ATD dataDir 内不触碰用户配置
4. **可读范围白名单**：读 workspace 外路径硬拒（external_directory deny 生效）；主仓与 readable 仓读正常；敏感工具（bash/edit）ask 弹审批卡→批准/拒绝后会话继续
5. **中断生效**；6. **凭据卫生**（密码仅进程 env+内存；生成配置不含凭据）；7. **回归**：task spawn 链零改动；fence 全绿

## 业务规则

1. **serve 拓扑**：单 serve 多会话；`humanthinkPort`（4900 段）或自动分配；密码 crypto random
2. **会话创建**：v2 面 `POST /api/session`——`agent='atd-ht-{workspaceId}'` + `location.directory`=主仓绝对路径；删除=instance 面；ATD 列表/详情读镜像
3. **权限构造（语义冻结，字面 P1b 定案）**：agent permissions 序列语义=①首条通配 ask 收口（防用户全局顶层 permissions 前置注入把敏感工具变 allow——r3-m3）②`external_directory` deny（workspace 外硬拒）③主仓内 read allow ④各 readable 仓前缀 allow（**相对主仓的路径形态**——read resource 为相对路径，绝对前缀永不命中，r3-m1）；bash/edit 等其余工具落回首条 ask→审批流
4. **事件双通道与游标**：镜像=per-session SSE `?after`（durable 落 `humanthink_events`，seq=ATD 本地每会话递增）；**serve 游标独立持久化于 `humanthink_sessions.serve_cursor`（每次 durable 落库同步更新）——恢复补拉直接用该列，不依赖镜像行反推（r3-l1）**；恢复=history 分页补拉+live 重连；live=全局 `GET /api/event` 一条共享订阅按 sessionID 分发（delta 不落库不重放）
5. **permission 通道**：轮询 v2 会话级 `/api/session/:id/permission`（2s）+live `permission.v2.*` 即时提示（P3 定案字段）；ATD 写镜像（permission_request/resolved 自有型）；reply 透传
6. **UnifiedEvent 新型**：`reasoning`（{text, phase}——镜像 started/ended，live 含 delta）；`permission_request`（{requestID, …P3 字段}）
7. **恢复语义**：serve 崩溃→健康检测→重启（配置目录已持久，直接复用）→serve_cursor 补拉+live 重连；全局流溢出断流→重连+durable 对齐（delta 可丢设计兜底）；ATD 重启→serve 随之重启
8. **API 鉴权内聚**：web 全走 ATD；ATD→serve 密码 env；不用 `?auth_token=`
9. **检索**：`q=` 对 title+durable 文本 payload LIKE
10. **web 手抄契约**：humanthink 面类型入 web 任务块

## 关键风险

| 风险 | 缓解 |
|---|---|
| P1a 载体探针失败 | 源码事实级唯一路径已核定（core 纯文件加载）；失败=重审路径③（prompt 改 instance 面+V1+事件通道重定义），24h 内重审 |
| P1b 规则 shape 与语义预期不符 | 形态级 fallback（调规则不动架构）；探针报告冻结字面后 impl 照抄 |
| 全局流溢出断流 | 进程内低延迟消费+断流自愈（重连+durable 对齐） |
| 配置合并面（model/provider 键集）不全 | P1a 探针覆盖 ModelNotSelectedError 反例；生成器按键集白名单合并并留 debug 日志 |
| 两面 API 混用版本耦合 | SDK pin+端点面集中声明（规则 2/5） |
| migration 编号 | 占位；同窗合流调度者统一 generate |
