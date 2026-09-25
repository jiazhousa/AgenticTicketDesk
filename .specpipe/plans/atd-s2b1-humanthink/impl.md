# Impl: S2b1 HumanThink 聊天框（interactive 长会话）

- **topic**：atd-s2b1-humanthink
- **上游 spec**：`.specpipe/plans/atd-s2b1-humanthink/spec.md`（v7 业务语言版，SPEC_APPROVED）
- **契约唯一事实源**：`.specpipe/plans/atd-s2b1-humanthink/probe-report.md`（探针 8 项漂移 + 补录 0 号全文/序号信封——**与源码快照/既往调研冲突时以探针报告为准**）
- **基线**：main@fc589c8
- **修订记录**：r1 REJECT 9 → **v2**（本版）：块文件集补齐（App.tsx 路由/errors.ts/helpers.ts+旁路 seam/scripts）/镜像主源实证落定（text.ended 全文+durable.seq）/SSE 帧 seq 语义/已删三分语义/permission status 字段/worker-core 测试落点 test/。serveCommand 边界/config-gen 口径枚举/404 兜底

## 技术方案

总体策略：server+worker-core 成块、web 成块，文件集不相交；「API 契约冻结」节为并行界面。

**核心链路**（探针实证口径）：

1. **serve 托管**：ATD 启动 → 生成 `{dataDir}/opencode-config/opencode.json` → spawn `opencode serve --port {humanthinkPort}`（env：`OPENCODE_SERVER_PASSWORD`=crypto random 仅内存+子进程、`OPENCODE_CONFIG_DIR` 指向生成目录）；健康探测=authed `GET /api/agent` 看 HTTP 状态（5s；空列表正常）；崩溃重启（退避 3 次转 degraded：humanthink 端点 503，工单功能不受影响）；清理挂 Fastify `onClose`；**app.ts 装配接受 `humanthink?: {enabled: boolean}`（缺省 true；测试经 helpers 传 false 旁路 spawn/订阅——既有 server 测试零 serve 进程）**
2. **配置生成**（config-gen，纯函数）：复制键白名单=`{model, providers}`（providers 原样含凭据——dataDir 本地文件不入仓，MUST-6 边界内）；**禁入键=V1 迁移触发三键（单数 `agent`/`provider`/`permission`）及全部 V1 键**（用户全局为 V1 键形时提取 model/provider 等价语义，绝不原样复制触发键）；兼容 `opencode.json`/`opencode.jsonc`（存在者优先）；`agents.atd-ht-{workspaceId}`.permissions 五规则（探针定案）：①`{action:"*",resource:"*",effect:"ask"}`（强制首条，生成器硬编码——本二进制无匹配默认=allow）②`{action:"external_directory",resource:"/**",effect:"deny"}` ③`{action:"read",resource:"*",effect:"allow"}` ④⑤per readable 仓：`external_directory` 与 `read` 各一条 `<绝对路径>/*` allow（形态 Builder 真跑锁定）；启动幂等重写；serve 生命周期内 workspace 集不变
3. **会话面**：创建=v2 `POST /api/session`（`{agent:"atd-ht-{ws}", location:{directory}, title?}`+`x-opencode-directory` 头）；prompt=v2 `POST /api/session/:id/prompt` `{text}`；interrupt=v2 `POST /api/session/:id/interrupt`（存在性 Builder 核 openapi，无则 instance 面 abort）；删除=instance `DELETE /session/:id`；**会话持久于共享数据目录（serve 重启 sessionID 不变）；ATD 透传遇 serve 404 → 统一 SESSION_NOT_FOUND 兜底**
4. **事件双通道**：live=全局 `GET /api/event` 一条 SSE 共享订阅，按 sessionID 分发（`session.text.delta`/`session.reasoning.delta` 仅转发不落库）；**镜像=流内 durable 子集落 `humanthink_events`**：`text.ended`（**全文主源，`data.text`**）/`reasoning.{started,ended}`（全文载荷以实测为准，缺则仅标记）/`tool.{called,success,failed,progress}`/`step.{started,ended}`/`permission.{asked,rejected}`——**幂等键=(session_id, serve_seq)**（serve 事件信封 `durable.seq` 原生序号），对外展示 seq=本地每会话递增；**恢复=重连全局流 + 活跃会话 `GET /api/session/:id/message`（+`/message/:messageID`）对账**——**文本以 message 端点为权威兜底（与验收「不丢话」一致），live 流为主源**
5. **审批中转**：live `permission.asked` 即推 web + 活跃会话 2s 轮询会话级 `GET /api/session/:id/permission`；reply=`POST .../permission/:requestID/reply` `{decision:"once"|"reject", message?}`（**always 不开放**——saved 按 projectID 与用户自用共享，防静默授权扩散）；ATD 写镜像自有行 permission_request/permission_resolved
6. **UnifiedEvent 扩展**（worker-core）：+`reasoning`（{text, phase}）+`permission_request`（{requestID, action, resources, **status: 'pending'|'resolved'**}——审批历史回溯并入同型）；humanthink 模块做 `session.*`→UnifiedEvent 映射；task 映射器零改动
7. **HTTP**：不引 SDK，原生 fetch+手写 SSE 解析（零新依赖）
8. **serveCommand 边界**：MVP 单 serve（opencode 形态）；profile.interactive.serveCommand 供 spawn 渲染；非 opencode 协议声明的 interactive worker → Registry 校验标记不可用（聊天框 worker 下拉不列出，记档）

## 改动点

### 块 1：server + worker-core

| 文件 | 改动 |
|---|---|
| `apps/server/src/humanthink/serve-manager.ts`（新） | 技术方案 1；deps 注入 spawn/fetchImpl/now（seam） |
| `apps/server/src/humanthink/config-gen.ts`（新） | 技术方案 2；纯函数单测 |
| `apps/server/src/humanthink/session-facade.ts`（新） | 技术方案 3+5（404 兜底在此）；fetch seam |
| `apps/server/src/humanthink/events.ts`（新） | 技术方案 4（幂等键/本地 seq/对账）；UnifiedEvent 映射；per-session 有界转发缓冲 |
| `apps/server/src/humanthink/routes.ts`（新） | 9 端点（契约冻结）；SSE（`?after=本地 seq` 回放+live 合流）；degraded 503 |
| `apps/server/src/app.ts` | humanthink 装配（`humanthink.enabled` 旁路位）+ routes 挂载 + onClose |
| `apps/server/src/index.ts` | 启动时序：config-gen→spawn→订阅（监听前；失败转 degraded 不阻塞） |
| `apps/server/src/domain/errors.ts` | +`WORKER_UNAVAILABLE`（503）/`SESSION_NOT_FOUND`（404）/`SESSION_TERMINATED`（422）入 ErrorCode 封闭 union 与 ERROR_STATUS 穷举 |
| `apps/server/src/config.ts` + `config.yaml` | +`humanthinkPort`（缺省 4900，占用递补） |
| `apps/server/src/routes/types.ts` | humanthink 契约 server 侧镜像（SessionInfo/PermissionRequest/UnifiedEvent 扩展 re-export）——web 手抄参照源 |
| `apps/server/src/db/schema.ts` + `drizzle/0005_s2b1_humanthink.sql` + meta | `humanthink_sessions`（id TEXT PK/worker_id/workspace_id/directory/title/created_at/last_active_at/deleted_at 可空）+ `humanthink_events`（session_id/**serve_seq**（INTEGER，UNIQUE(session_id, serve_seq) 幂等键）/seq（本地展示序）/type/payload/created_at；索引 session_id） |
| `packages/worker-core/src/profile.ts` + `src/events.ts`（或同域文件） | profile +`interactive` 段（serveCommand 模板 `{port}` 缺省 `opencode serve --port {port}`；必含 {port}+凭据扫描复用；非 opencode 协议标不可用）；UnifiedEvent +两型 |
| `packages/worker-core/test/`（**测试必须落 test/ 目录**——vitest include=test/**，落 src/ 静默不跑） | profile interactive 校验/两型映射用例 |
| `workers/opencode.yaml` | capabilities 数组加 `'interactive'` 值（schema 枚举已含，零 schema 枚举改动）；interactive 段声明 |
| `apps/server/test/helpers.ts` | AppConfig 两处内联字面量补 `humanthinkPort`；+humanthink 旁路选项（默认 enabled:false 走 app 装配旁路——既有 14 测试文件零 serve 进程；humanthink 专属测试显式启用+注入假 serve） |
| `apps/server/test/humanthink/*.test.ts`（新） | config-gen（白名单/禁入键/jsonc/V1 提取/幂等/规则序列硬编码）/事件映射与镜像幂等（durable.seq 去重）/对账（message 权威兜底幂等）/审批 once-reject/会话面 404 兜底/serve-manager 生命周期（假 spawn/fetch）/SSE after 回放 |
| `apps/server/test/api-s2b1.test.ts`（新） | 9 端点契约+四错误码+degraded |
| `scripts/smoke-humanthink.sh`（新，可选手动） | 真 serve 冒烟（对齐探针步骤；交付验收用，不进 fence） |

**块 1 最小验证**：`pnpm -F @atd/worker-core test && pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`

### 块 2：web

| 文件 | 改动 |
|---|---|
| `apps/web/src/api/humanthink.ts`（新） | 9 端点 client + EventSource SSE 封装（同源） |
| `apps/web/src/api/types.ts` | humanthink 面类型手抄（对齐 routes/types.ts 镜像） |
| `apps/web/src/pages/HumanThinkPage.tsx`（新） | 会话列表（workspace 过滤+搜索）+ 聊天窗（流式/reasoning 折叠/工具卡片/审批卡 once-reject/中断）+ 建会话弹窗（capabilities 含 interactive 且可用才可选） |
| `apps/web/src/components/chat/`（新，4 组件） | ChatMessage/ReasoningBlock/ToolCard/ApprovalCard |
| `apps/web/src/App.tsx` | **路由挂载 `/humanthink`（唯一挂载点，约 :19-25）** |
| `apps/web/src/components/AppLayout.tsx` | 导航入口「聊天」 |

**块 2 最小验证**：`pnpm -F @atd/web build`

## API 契约冻结（块 2 并行依据）

- `POST /api/humanthink/sessions` `{workerId, workspaceId, title?}` → `{session}`（session=id/workerId/workspaceId/directory/title/createdAt/deletedAt:null）
- `GET /api/humanthink/sessions?workspaceId=&q=` → `{items}`（排除 deleted；q=title+文本 payload LIKE）
- **已删会话三分语义**：列表排除；`GET .../:id` 返回带 deletedAt（历史可查）；prompt/interrupt/delete/reply/events 一律 422 `SESSION_TERMINATED`
- `GET .../:id/events`（SSE）：`?after=<本地 seq>` 先回放镜像再续 live；帧=`data: {seq?, event}`——durable 事件带 seq、delta 帧无 seq（断线重连以最后 durable seq 为 after；delta 设计不重放，UI 以镜像全文对齐）
- `POST .../:id/prompt` `{text}` → `{admitted:true}`；`POST .../:id/interrupt` → `{ok:true}`；`DELETE .../:id` → `{ok:true}`
- `GET .../:id/permission/requests` → `{items:[{requestID, action, resources}]}`；`POST .../permission/:requestID/reply` `{decision:"once"|"reject", message?}` → `{ok:true}`
- 错误信封复用 AppError；degraded 全端点 503 WORKER_UNAVAILABLE

## 技术决策

- D1 权限载体=OPENCODE_CONFIG_DIR 生成文件（探针 P1a 实证）
- D2 catch-all ask 首条硬编码于生成器（无匹配默认=allow 实测；不暴露配置面）
- D3 always 档不开放（saved 共享面；once/reject 两档）
- D4 live=全局流唯一源；镜像幂等键=(session_id, serve_seq)（事件信封原生）；恢复=重连+message 对账（**文本以 message 为权威兜底**——与验收「不丢话」一致）
- D5 不引 SDK——原生 fetch+SSE 手写
- D6 serve 数据目录不隔离（用户拍板；D3 缓解授权扩散）
- D7 真实 serve 集成不进 CI；单测全 mock；冒烟=scripts/smoke-humanthink.sh 手动（探针同款步骤）
- D8 humanthink 装配旁路位（app opts `humanthink.enabled`）——既有测试零 serve 进程的前提

## 依赖

- 块 2 依赖契约冻结节与 routes/types.ts 镜像类型（server 侧先行冻结于本文件）
- readable allow 形态（技术方案 2 ④⑤）与 interrupt 端点存在性：Builder 实测锁定

## 风险

| 风险 | 缓解 |
|---|---|
| message 端点详情形状未探明 | 对账 Builder 实测定形；文本权威兜底语义不变（验收「不丢话」硬约束，无「接受缺失」fallback） |
| 全局流断流窗口 | delta 可丢+durable 幂等+message 对账三重保障；有界缓冲+after 重连 |
| readable allow/interrupt 存在性 | 真跑锁定；同族 fallback（规则微调/instance abort） |
| 事件信封 durable.seq 的稳定性（版本演进） | 幂等键失效时退化 (session_id, 本地 seq) 双写兼容（serve_seq 可空+唯一索引局部） |
| serve 与自用服务资源竞争 | 独立端口/密码/进程组 |
