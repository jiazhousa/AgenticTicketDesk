# Impl: S2b1 HumanThink 聊天框（interactive 长会话）

- **topic**：atd-s2b1-humanthink
- **上游 spec**：`.specpipe/plans/atd-s2b1-humanthink/spec.md`（v7 业务语言版，SPEC_APPROVED）
- **契约唯一事实源**：`.specpipe/plans/atd-s2b1-humanthink/probe-report.md`（探针 8 项漂移定案——**与源码快照/既往调研冲突时以探针报告为准**）
- **基线**：main@fc589c8

## 技术方案

总体策略：server 侧新模块成块（humanthink 引擎 + worker-core 扩展）、web 侧独立成块——文件集不相交可并行；两块以「API 契约冻结」节为并行界面。

**核心链路**（全部探针实证口径）：

1. **serve 托管**：ATD 启动 → 生成 `{dataDir}/opencode-config/opencode.json` → spawn `opencode serve --port {humanthinkPort}`（env：`OPENCODE_SERVER_PASSWORD`=crypto random 仅内存+子进程、`OPENCODE_CONFIG_DIR` 指向生成目录）；健康探测=authed `GET /api/agent` 200（5s 间隔；该端点瞬时空列表属正常，只看 HTTP 状态）；崩溃重启（退避 3 次后 degraded：humanthink 端点 503 WORKER_UNAVAILABLE，工单功能不受影响）；清理挂 Fastify `onClose`
2. **配置生成**（config-gen）：V2 键形写死——`model`+`providers`（复数）从用户全局配置提取（兼容 `opencode.json`/`opencode.jsonc`，存在者优先；用户配置为 V1 键形时提取等价语义，禁入键绝不原样复制）+ `agents.atd-ht-{workspaceId}`：permissions 五条规则序列（探针定案形态）：①`{action:"*",resource:"*",effect:"ask"}`（**强制首条**——本二进制无匹配默认=allow，无它三档崩塌）②`{action:"external_directory",resource:"/**",effect:"deny"}` ③`{action:"read",resource:"*",effect:"allow"}` ④⑤ per readable 仓：`{action:"external_directory",resource:"<绝对路径>/*",effect:"allow"}` 与 `{action:"read",resource:"<绝对路径>/*",effect:"allow"}`（readable allow 形态未在探针覆盖——Builder 须以真跑用例锁定，规则形态可按实测微调记档）；启动幂等重写；serve 生命周期内 workspace 集不变（与既有口径一致）
3. **会话面**：创建=`POST /api/session`（v2 面，body `{agent:"atd-ht-{ws}", location:{directory:<主仓绝对路径>}, title?}` + `x-opencode-directory` 头）；prompt=`POST /api/session/:id/prompt` body `{text}`（**字段名 text，探针漂移1**）；interrupt=v2 面 `POST /api/session/:id/interrupt`（存在性 Builder 核）；删除=instance 面 `DELETE /session/:id`（v2 无 delete）；不依赖 `GET /api/agent` 做功能（探针漂移8）
4. **事件双通道**（探针漂移2/3 定型）：**live**=全局 `GET /api/event` 一条 SSE 共享订阅（Basic auth），按事件内 sessionID 分发——`session.text.delta/reasoning.delta` 仅转发 web 不落库；**镜像**=流内 durable 子集落 `humanthink_events`（`text.ended` 全文/reasoning.{started,ended}/tool.{called,success,failed,progress}/step.{started,ended}/permission.{asked,rejected}），seq=ATD 本地每会话递增；**恢复**=重连全局流 + 对活跃会话以 `GET /api/session/:id/message`（+`/message/:messageID` 详情，形状 Builder 核）幂等对账补缺（payload 存 message id 去重）
5. **审批中转**：live `permission.asked` 即时推 web + 会话级 `GET /api/session/:id/permission` 轮询兜底（活跃会话 2s）；reply=`POST /api/session/:id/permission/:requestID/reply` body `{decision:"once"|"reject", message?}`——**UI 只出 once/reject 两档**（always 不开放：saved 按 projectID 与用户自用会话共享，防静默授权扩散——探针漂移6/7）；ATD 收到 asked/rejected 后写镜像自有行（type=permission_request/permission_resolved）
6. **UnifiedEvent 扩展**（worker-core）：+`reasoning`（{text, phase: started/delta/ended}）+`permission_request`（{requestID, action, resources}）；humanthink 模块内做 `session.*`→UnifiedEvent 映射（web SSE 帧即 UnifiedEvent JSON）；task 模式映射器零改动
7. **HTTP 客户端**：不引入 SDK（本机安装物 1.14.28 落后），humanthink 模块用原生 fetch + 手写 SSE 解析（ReadableStream 行解析，零新依赖）

## 改动点

### 块 1：server + worker-core

| 文件 | 改动 |
|---|---|
| `apps/server/src/humanthink/serve-manager.ts`（新） | spawn/健康/重启/degraded/销毁（技术方案 1）；deps 注入 `spawn?`/`fetchImpl?`/`now?`（测试 seam） |
| `apps/server/src/humanthink/config-gen.ts`（新） | 生成器（技术方案 2）：用户全局读取兼容/V1 提取/规则序列/幂等重写；纯函数可单测 |
| `apps/server/src/humanthink/session-facade.ts`（新） | 会话 CRUD 透传（技术方案 3）+ 审批中转（技术方案 5）；fetch seam 注入 |
| `apps/server/src/humanthink/events.ts`（新） | 全局流订阅/分发/镜像落库/恢复对账（技术方案 4）；UnifiedEvent 映射；per-session 有界转发缓冲 |
| `apps/server/src/humanthink/routes.ts`（新） | 9 端点（见契约冻结）；SSE 端点（`?after` 回放镜像+live 合流）；degraded 503 |
| `apps/server/src/app.ts` | humanthink 模块装配（serve-manager+events 订阅+routes 挂载）+ onClose 清理 |
| `apps/server/src/index.ts` | 启动时序：config-gen → spawn → 订阅（监听前完成；失败不阻塞监听，转 degraded） |
| `apps/server/src/config.ts` + `config.yaml` | +`humanthinkPort`（缺省 4900，占用则 +1 递补） |
| `apps/server/src/db/schema.ts` + `drizzle/0005_s2b1_humanthink.sql` + meta | `humanthink_sessions`（id TEXT PK/worker_id/workspace_id/directory/title/created_at/last_active_at/deleted_at 可空）+ `humanthink_events`（session_id/seq/type/payload/created_at，UNIQUE(session_id,seq)，索引 session_id） |
| `packages/worker-core/src/`（schema/类型/测试） | profile schema +`interactive` 段（serveCommand 模板变量 `{port}`，缺省 `opencode serve --port {port}`；校验必含 {port}+凭据扫描复用）；capabilities 枚举启用；UnifiedEvent +`reasoning`/+`permission_request` |
| `workers/opencode.yaml` | capabilities +interactive；interactive 段声明 |
| `apps/server/test/humanthink/*.test.ts`（新） | config-gen 规则序列/用户配置兼容（V1 提取·jsonc·禁入键）/幂等；事件映射（session.*→UnifiedEvent，delta 不落库）/镜像 seq 递增/对账幂等（fetch mock）；审批 once/reject 透传；API 契约（建会话字段/503 degraded/SSE after 回放）；serve-manager 生命周期（注入 spawn/fetch 假件） |
| `apps/server/test/api-s2b1.test.ts`（新） | 9 端点契约 + 错误码（WORKER_UNAVAILABLE/SESSION_NOT_FOUND/SESSION_TERMINATED/VALIDATION） |

**块 1 最小验证**：`pnpm -F @atd/worker-core test && pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`

### 块 2：web

| 文件 | 改动 |
|---|---|
| `apps/web/src/api/humanthink.ts`（新） | 9 端点 client + SSE 订阅封装（原生 EventSource，同源免鉴权） |
| `apps/web/src/api/types.ts` | humanthink 面类型手抄（Session/PermissionRequest/UnifiedEvent 扩展两型） |
| `apps/web/src/pages/HumanThinkPage.tsx`（新） | 会话列表（workspace 过滤+标题搜索）+ 聊天窗（流式逐字渲染/reasoning 折叠/工具卡片/审批弹卡 once-reject/中断按钮）+ 建会话弹窗（worker×workspace，capabilities 含 interactive 才可选） |
| `apps/web/src/components/chat/`（新目录，4 组件） | ChatMessage/ReasoningBlock/ToolCard/ApprovalCard |
| `apps/web/src/components/AppLayout.tsx` | 导航入口「聊天」 |
| `apps/web/src/context/WorkspaceContext.tsx` | 复用（不改动面） |

**块 2 最小验证**：`pnpm -F @atd/web build`

## API 契约冻结（块 2 并行依据）

- `POST /api/humanthink/sessions` `{workerId, workspaceId, title?}` → `{session}`（session=id/workerId/workspaceId/directory/title/createdAt/deletedAt=null）
- `GET /api/humanthink/sessions?workspaceId=&q=` → `{items}`（排除 deleted；q 匹配 title+文本 payload LIKE）
- `GET /api/humanthink/sessions/:id` → `{session, events?}`（已删：带 deletedAt 返回；操作类 422 SESSION_TERMINATED）
- `GET /api/humanthink/sessions/:id/events`（SSE：`?after=<seq>` 回放镜像+live；帧=`data: {<UnifiedEvent JSON>}`）
- `POST /api/humanthink/sessions/:id/prompt` `{text}` → `{admitted:true}`；`POST .../interrupt` → `{ok:true}`；`DELETE .../:id` → `{ok:true}`（软删）
- `GET .../permission/requests` → `{items:[{requestID, action, resources}]}`；`POST .../permission/:requestID/reply` `{decision:"once"|"reject", message?}` → `{ok:true}`
- 错误信封复用仓内 AppError；degraded 全端点 503 `WORKER_UNAVAILABLE`

## 技术决策

- D1 权限载体=OPENCODE_CONFIG_DIR 生成文件（探针 P1a 实证；CONTENT 链不可用）
- D2 catch-all ask 首条**硬编码于生成器**（无匹配默认=allow 的实测事实；配置面不暴露该项防误删）
- D3 always 档不开放（saved 共享面；UI/reply 仅 once/reject）
- D4 事件通道以全局流为唯一 live 源（本二进制无 per-session 端点/无 history）；恢复=重连+message 对账（幂等 payload message id）
- D5 不引 SDK——原生 fetch+SSE 手写解析（版本钉死风险大于手写维护成本）
- D6 serve 数据目录不隔离（用户拍板；saved 共享为已知接受面，D3 缓解其授权扩散风险）
- D7 真实 serve 集成不进 CI（探针已实证端到端）；单测全 mock fetch/spawn，真跑冒烟留交付验收脚本（scripts/smoke-humanthink.sh，可选手动）

## 依赖

- 块 2 依赖契约冻结节；块 1 依赖探针报告（已归档）
- readable allow 规则形态需 Builder 真跑锁定（技术方案 2 ④⑤）

## 风险

| 风险 | 缓解 |
|---|---|
| message 端点形状未探明（列表无 payload） | 对账与详情形状 Builder 实测定；fallback=对账仅按消息计数+文本端点缺失接受（镜像以 live 流为主源） |
| interrupt 端点存在性 | Builder 核 openapi；fallback=v2 面无则 instance 面 abort |
| 全局流单点（断流期间事件缺） | delta 设计可丢+durable 子集可对账；有界缓冲+web after 重连 |
| readable 仓 allow 形态 | 真跑用例锁定；规则形态微调空间（探针同族） |
| serve 与用户自用服务的资源竞争 | 独立端口/密码/进程组；健康独立 |
