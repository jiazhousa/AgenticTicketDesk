# 审查报告: atd-s2b1-humanthink spec (Revision 3)

- **审查类型**：Spec 轻量审查（r3：r2 十项闭合核验 + 路径②设计自洽性 + v4 整体复审）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2b1-humanthink/spec.md`（v4 形态，77 行）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md` §4.3/§4.4/§9（S2b1 行、决策 C/D、行 120 可读范围）；S2w1 spec 行 69（§5 移交）；r2 报告 `.specpipe/reviews/atd-s2b1-humanthink-spec-review-r2.md`
- **源码级核对仓**：`/home/starlex/project/opencode/packages/`（1.18.21 快照，只读，与 r1/r2 同版本）
  - 本文新增核对面：`core/src/{config,config/plugin/agent,plugin/internal,plugin/agent,agent,global,flag/flag,location-services,event}.ts`、`core/src/session.ts`、`core/src/session/runner/{llm,model}.ts`、`core/src/tool/{read,registry}.ts`、`server/src/{auth,handlers/{session,event},middleware/authorization}.ts`、`protocol/src/groups/{session,permission,event}.ts`、`schema/src/{agent,location}.ts`、`opencode/src/{config/config,config/agent,server/routes/instance/httpapi/server,effect/{bootstrap-runtime,app-node-builder-v1}}.ts`
- **ATD 侧核对仓**：`/home/starlex/project/AgenticTicketDesk`（只读）——`apps/server/src/{perm-config,dispatcher}.ts`、`packages/worker-core/src/{profile,events}.ts`、`workers/opencode.yaml`
- **日期**：2026-09-25

## 总体评价

[不通过]

v4 对 r2 的修订**方向正确、多数口径错误已实打实闭合**：prompt 面全线改走 v2（规则 2/5）、权限改 V2 agent 级并声明探针前置（规则 3 + P1-P3）、permission 轮询端点与 reply 端点写死为会话级 V2 端点、seq 空间统一为 ATD 本地每会话递增、全局流断流补了「重连 + durable 对齐」、错误形态与 SSE 帧形已声明、`deleted_at` 列与「serve 启动失败降级」已落、偏离清单 4 条齐备——逐条经源码复核（见核验表与「已闭合项」）。

但路径②的**载体环节经源码核对确认没有执行路径**：`OPENCODE_CONFIG_CONTENT` 只被 app（V1）配置加载器消费，**到不了 core Config → AgentV2**（v2 prompt 面唯一的权限事实源）。按规则 3 字面实现，动态 agent 不会注册 → `PermissionV2.configured` 回退 `missingAgentPermissions`（catch-all deny）→ **所有工具调用被硬拒（含 workspace 内 read）**，且 `permission.v2.asked` 永不产生（审批链无事件可轮询）→ 验收 4 与验收 1 同时失败。这属于 r2 高-1 的同一缺陷类（所选通道不执行所声明机制）在 v4 的残留，且失败形态从 fail-open（不强制）变成 fail-closed（功能全废）。另有一处语义映射错误（越界读的动作是 `external_directory` 而非 `read`，验收 4 的「硬拒」会退化成审批卡）与两处设计不自洽（agent 规则集不自洽 / P1 探针未定载体且 fallback 校准失当）。

均属 spec 层可收敛（换载体 + 改三处措辞即可，**无需推翻路径②**），但 impl 按现字面执行必然走错通道，故判 **REJECT**，回 SPEC_DRAFT。

## 分数

**52 / 100**（100 − 1×critical 25 − 3×medium 5 − 4×low 2 = 100 − 25 − 15 − 8）

## r2 → v4 逐项核验

| r2 项 | 结论 | 核验依据 |
|---|---|---|
| **high** 两套权限系统 / 验收 4 不可达 | **部分闭合** | 选型路径②正确：规则 2 明确「permission 不经会话注入（V2 链不读它），经 agent 定义预注入」，规则 5 改「V2 会话级端点 + `permission.v2.*`」，ruleset 改 V2 形语义 ✓。**但注入载体 `OPENCODE_CONFIG_CONTENT` 到不了 core AgentV2**（本文 critical）→ 动态 agent 不注册 → 权限回退 catch-all deny，验收 4 仍不可达（形态由 fail-open 变 fail-closed）；规则 3「与 task 模式 MUST-2 同机制」恰好引的是 V1 链（`apps/server/src/perm-config.ts:16-19`），论证反向 |
| **m1** 轮询端点/形状不符 | **已闭合** | 规则 5 写死 `GET /api/session/:id/permission`（源码存在：`protocol/src/groups/permission.ts:89-102`，返回 `Permission.Request` V2 形 `{id,sessionID,action,resources,save,metadata,source}`，`schema/src/permission.ts`）；reply 端点同族（`:119-`）；形状字段交 P3 定案 |
| **m2** ruleset 字面 shape 零命中 | **部分闭合** | 「冻结语义不冻结字段拼写、字面 shape 由 P1 定案」的处置方向可接受；**但语义仍写「read 越界 deny」**，而 core 对越界路径走 `external_directory` 动作（r2 已明示此点，v4 未承接）→ 本文 medium-1 |
| **m3** allBounded(256) 溢出断流 | **已闭合** | 规则 7 + 风险表补「重连 + durable 对齐（delta 设计可丢，UI 以镜像全文对齐）」；源码事实复核成立（`core/src/event.ts:152-164` `Queue.dropping` + 溢出 `Queue.fail`；`server/src/handlers/event.ts:9,33` capacity=256，另有 15s 心跳） |
| **m4** 镜像 seq 混装 | **部分闭合** | 规则 4「seq=ATD 本地每会话递增分配，serve 原序入 payload 元数据，两类行同一空间」**消除混装** ✓；**残余**：恢复游标「按镜像最大本地 seq 对应的 serve 游标」在尾行是 ATD 自写 permission 行（无 serve 游标）时无定义 → 本文 low-1 |
| **低-1** deleted_at 列缺失 | **部分闭合** | 列已加（行 28，`deleted_at 可空`）；列表是否过滤、详情是否可读、删除后事件可否补拉的**读语义未定** → low-2 |
| **低-2** 错误形态 + SSE 帧 | **部分闭合** | 已补「错误形态对齐仓内 AppError 信封」（行 30）与帧形 `data: {<UnifiedEvent JSON>}` + `?after` 回放（行 33）；**端点级 code/状态码仍未枚举**（serve 未起 / worker 非 interactive / session 不存在）→ low-2 |
| **低-3** web types.ts 手抄义务 | **已闭合** | 规则 10 + 范围行 29 明确 `apps/web/src/api/types.ts` 同步义务 |
| **低-4** serve 启动失败降级 | **已闭合** | 范围行 21 写死「重试 3 次 → humanthink degraded（聊天页提示）→ 不阻塞工单主功能」+「随 ATD 退出销毁」（退出钩子注册点仍留 impl，可接受） |
| **低-5** 两条偏离未入清单 | **已闭合** | 行 8 四条偏离齐备（决策 C 镜像重释 / 决策 D 单常驻 serve 多会话 / 权限机制改 V2 agent 级 / s2w1 task 切换拆 Story） |

## 发现的问题

### 高-1（critical）注入载体 `OPENCODE_CONFIG_CONTENT` 到不了 core AgentV2：动态 agent 不注册，权限回退 catch-all deny（验收 4/1 失败，审批链无事件）

- **位置**：业务规则 3（行 58）、范围「serve 启动配置注入（权限载体）」（行 22）、对 Epic 的偏离清单 ③（行 8）、风险表第 1 行（行 71）
- **源码事实（1.18.21 快照）**：
  - **载体的唯一消费方是 app（V1）配置链**：`packages/opencode/src/config/config.ts:468-476`（`process.env.OPENCODE_CONFIG_CONTENT` → `loadConfig` → merge 进 app `Config.Info`）。该 `Info` 即 `ConfigV1.Info`（`opencode/src/config/config.ts:25`；agent 键为**单数** `agent`、permission 为 **V1** 对象形）——只被 app 面服务消费（`Agent.node`、app `ToolRegistry`、app `Permission`、`app-runtime.ts:58-109` 的实例运行时）。
  - **core 侧零消费**：`packages/core/src/flag/flag.ts:22` 声明了 `OPENCODE_CONFIG_CONTENT`，但全 core 无消费点；core 仅消费 `OPENCODE_CONFIG_DIR`（`core/src/global.ts:64`）。
  - **core Config（v2 面唯一 config 源）只读文件**：`core/src/config.ts:135-217`——`names=["opencode.json","opencode.jsonc"]`；`globalDirectory = AbsolutePath.make(global.config)`（=`OPENCODE_CONFIG_DIR ?? ~/.config/opencode`）；再从 `location.directory` 向上 discover 到 `location.project.directory`；`Config.Document` 构造点只有 core 文件加载器与 core markdown loader（`core/src/config/plugin/agent.ts:178`）。**无任何 env 内容通道**。
  - **core agent 注册链**（载体换对即成立）：`locationServices` 含 `Config.node` + `AgentV2.node` + `PluginInternal.node`（`core/src/location-services.ts:42-79`）→ `PluginInternal` 批量 add `AgentPlugin`（内置 build/plan/general/explore/title/summary/compaction）与 `ConfigAgentPlugin`（`core/src/plugin/internal.ts:111,115`）→ `ConfigAgentPlugin` 从 core Config documents 的 **`agents`（复数）+ `permissions`（V2 `{action,resource,effect}`）** 记录注册（`core/src/config/plugin/agent.ts:80-113`，键形见 `core/src/config.ts:60-65`）。
  - **「同机制」论证反向**：ATD 现有 task 模式注入的是 V1 `permission: {bash,edit,write}`（`apps/server/src/perm-config.ts:16-19`，env 设在 `apps/server/src/dispatcher.ts:139`）——正是 r2 判定「v2 runner 从不读」的那一套（app 工具 + V1 ruleset）。
  - **失效链（fail-closed）**：`agents.select(session.agent)` 对未注册 id **不报错**，返回 `{id, info: undefined}`（`core/src/agent.ts:94-101`）→ `PermissionV2.configured` 回退 `missingAgentPermissions = [{action:"*",resource:"*",effect:"deny"}]`（`core/src/permission.ts:15,137-145`）→ `assert` 对**任何**工具直接 deny（`:197-205`）；同时 `tools.materialize(agent.info?.permissions)` = `materialize(undefined)` → 默认空 ruleset → `whollyDisabled` 恒 false → **所有工具照常 advertise**（`core/src/session/runner/llm.ts:203`、`core/src/tool/registry.ts:106-113`）。
  - **净效果**：会话能建、工具全亮、**每次工具调用被拒**（含 workspace 内 read，`core/src/tool/read.ts:72-79`）；`permission.v2.asked` 永不产生（deny 分支不建请求，`core/src/permission.ts:190-195,201-205`）→ 规则 5 的轮询与审批链无事件可拉。验收 4「workspace 内读正常」、验收 1「工具卡片/回复全文」均失败，属 silent fail-closed（比 r2 的 fail-open 更彻底，且不报错、只报「Unable to read …」）。
- **影响**：impl 按现字面（serve 启动注入 CONTENT）实现，动态 agent 不会出现在 core agent 表；`GET /api/agent` 无 `atd-ht-*`，越界读不被硬拒、内读也被拒，验收 4 + 1 连锁失败，且失败原因难以从 UI 定位（无显式错误）。
- **建议**（spec 写死载体，二选一；仍走路径②，无需推翻 prompt 面）：
  1. **私有 config 目录（推荐）**：serve 进程 env 设 `OPENCODE_CONFIG_DIR=<ATD 私有目录>`（core 唯一 config 环境开关，`core/src/global.ts:64`），目录内生成 `opencode.json`，用 core V2 键形 `{permissions?: [...], agents: {"atd-ht-{ws}": {permissions: [...]}}}`（`core/src/config.ts:60-65`、`core/src/config/plugin/agent.ts:108-110`）。凭据不受影响（`auth.json` 在 `Global.Path.data`：`opencode/src/auth/index.ts:10`），但**用户全局 provider/model 配置会丢失** → 生成时需合并用户 `~/.config/opencode/opencode.json` 的 `model`/`provider`（或至少 `model`），否则 runner 抛 `ModelNotSelectedError`（`core/src/session/runner/model.ts:203`）。
  2. **location 级项目文件**：写 `<workspace 主仓>/.opencode/opencode.json`（core 从 `location.directory` 向上 discover，`core/src/config.ts:179-203`）——不覆盖 config dir，但会**写入用户仓工作区**（污染，且用户/用户 serve 打开该目录时同样生效），与「零污染」相悖。
  - 另需写明：core 的 location 配置在 **location 打开时读一次并缓存**（`core/src/config.ts:175-176`；LayerMap `idleTimeToLive: "60 minutes"`，`core/src/location-services.ts:109`）→ 所有 workspace 的 agent 定义必须在 serve 启动时一次性生成（新 workspace 须在首次请求该 location 前就位）。
  - P1 第一判据应改为「载体生效」：`GET /api/agent` 能列出 `atd-ht-{ws}`（见 medium-2）。

### 中-1（medium）规则 3 的越界读语义用错动作：越界路径由 `external_directory` 承担，非 `read`（验收 4「硬拒」会退化成审批卡）

- **位置**：业务规则 3（行 58，「read 越界 deny + 各 repo 前缀 allow」）、验收 4（行 51）
- **源码事实**：
  - `core/src/tool/read.ts:53-79`：read 工具先 `mutation.resolve`，若 `target.externalDirectory` 非空，**先** assert `LocationMutation.externalDirectoryPermission(external)`（action=`external_directory`，resource=外部绝对路径），**随后**才 assert `{action:"read", resources:[target.resource]}`——而 `target.resource` 是 **location 相对路径**（与内置 build agent 的规则口径一致：`core/src/plugin/agent.ts:102-118` → `{action:"external_directory",resource:"*",effect:"ask"}` + 白名单目录 allow + `{action:"read",resource:"*",effect:"allow"}`）。
  - 未命中规则时 `evaluate` 回退 `effect:"ask"`（`core/src/permission.ts:76-86`）。
- **影响**：若按字面把越界写成 `read` 动作——workspace 内 read 命中 allow（OK），但越界 read 的 `external_directory` 无规则 → 落默认 **ask** → 验收 4「workspace 外 read 硬拒」变成弹卡（非硬拒）；多仓 workspace 的 readable 仓（`epic-spec.md:120`「workspace.repos 即白名单」）前缀若写成 `read` 绝对路径，**永不命中**（read 的 resource 是相对路径），readable 仓读会退化为 ask。
- **建议**：规则 3 语义改写为「`external_directory`：各 repo 绝对前缀 allow + catch-all deny；`read`：allow（workspace 内）；未配置动作：ask」，字面 shape 仍交 P1 定案。r2 中-2 的原话（「越界路径由 `external_directory` 动作承担，非 `read`」）应直接承接。

### 中-2（medium）P1-P3 探针未定载体、fallback 校准失当、「24h 重审」操作性不明

- **位置**：前置探针节（行 41-44）、风险表第 1 行（行 71）
- **问题**：
  1. P1 写「动态 agent permissions 定义→v2 面 prompt→core read 越界被拒的端到端实证」，**未写定义经哪个载体进入**——而载体恰是本轮唯一无执行路径的环节（高-1）。若照规则 3 用 CONTENT，探针必失败，且失败原因（载体）与判据所要测的（V2 shape / read 强制路径）混在一起，无法区分。
  2. **fallback 校准失当**：风险表把「V2 权限 shape/强制路径与预期不符（P1 失败）」整体 fallback 到**路径③**（prompt 改 instance 面 + V1 session ruleset + 事件通道重定义 = 架构推翻）。但载体失败只需换载体（高-1 建议 1/2，改动面小），不该触发 prompt 面推翻。
  3. 「探针后 24h 内重审」未写主体与对象（谁发起、重审 spec 还是仅重跑探针）。
- **建议**：P1 拆子判据并各配 fallback——**P1a 载体注册**（`GET /api/agent` 含 `atd-ht-{ws}`；失败 → 换载体，非路径③）→ **P1b ruleset shape 被 config decode 接受**（失败 → 按 V2 `{action,resource,effect}` 修正）→ **P1c 端到端**（越界 `external_directory` deny / 内读 allow / 未配置动作 ask；仅当 P1a/P1b 通过而 P1c 失败才考虑路径③）；24h 重审改为「探针报告落 `plans/` 后由 Oracle 派发同 topic spec 复审」。
- **附带**：P2 可由源码预答（未命中 → ask，`core/src/permission.ts:76-86`），但其成立性依赖「agent 规则集未被用户全局规则前置污染」→ 见中-3。

### 中-3（medium）agent 规则集不自洽：用户全局 `permissions` 被前置注入进动态 agent，「未配置工具 ask / 零污染」不成立

- **位置**：业务规则 3（行 58，「serve 为 ATD 自有进程，进程级注入零污染」）、验收 4（行 51）、验收 3（行 50）
- **源码事实**：`core/src/config/plugin/agent.ts:70-78` 把各 document 顶层 `permissions` push 进**所有**已存在 agent；`:90` 对新建 agent **先** push 全局 permissions 再 push agent 自身 → 动态 agent 最终 ruleset = `[用户全局规则…, ATD 规则…]`。findLast 语义下 ATD 规则优先，但**用户全局里 ATD 未覆盖的动作会沿用用户口径**：例如用户全局含 `{action:"bash",resource:"*",effect:"allow"}`（或 `permissions: [{action:"*",resource:"*",effect:"allow"}]`）时，验收 4 的「bash/edit 未配置 → ask 弹卡」失效（直接 allow，无审批卡）。
- **另**：ATD 自有 serve 默认读用户真实 `~/.config/opencode`（`core/src/config.ts:173`）→「进程级注入零污染」只单向成立（不写用户，但**读**用户全量 agents/permissions），验收 3「与用户自用 background service 并存互不影响」按现论证只覆盖端口/进程，未覆盖配置读入。
- **建议**：① 动态 agent 定义内自带**前置 catch-all**（V2 惯用法：首条 `{action:"*",resource:"*",effect:"ask"}`，其后 read allow / external_directory allow+deny 覆盖），使规则集在全局注入下仍自洽；② 载体选私有 config 目录（高-1 建议 1）切断读污染；③ P1/P2 加一条判据「用户全局存在宽松规则时，ask 语义不变」。

### 低-1（low）恢复游标映射在「镜像尾行为 ATD 自写行」时未定义

- **位置**：业务规则 4（行 59）
- **描述**：「按镜像最大本地 seq 对应的 serve 游标——payload 元数据携带」；若最大本地 seq 那行是 ATD 自写的 permission 行（无 serve 游标），映射无定义；镜像为空（新会话）时的 `after` 初值亦未写。
- **建议**：写死「补拉游标 = 镜像中**最近一条 serve 源行**元数据里的 serve seq（无则 0）」；或在 `humanthink_sessions` 增 `last_serve_seq` 列（更省事、可避免扫描）。

### 低-2（low）错误码未枚举 + `deleted_at` 读语义未定

- **位置**：范围 API 面（行 30）、DB migration（行 28）、API 面 DELETE（行 35）
- **描述**：① 错误形态只写「对齐仓内 AppError 信封」，未列 serve 未起（对应 degraded → 503？）、worker 不支持 interactive（422？）、session 不存在 的 code/状态码；② `deleted_at` 已加列但未定义列表过滤 / 详情可读 / 删除后事件可否补拉。
- **建议**：至少写死「serve 未起 → 503 `HUMANTHINK_UNAVAILABLE`」「worker 无 interactive capability → 422」两条（其余对齐既有信封）；`deleted_at` 语义一句话写死（建议：列表过滤、详情 404、事件不再补拉）。

### 低-3（low）两处措辞/记档残留（r2 观测未承接）

- **位置**：风险表末行（行 76）、范围 WorkerProfile 条（行 23）
- **描述**：① 「有界队列+`?after` 重连（**logs tail 同款**）」——ATD 全仓无 `text/event-stream`（既有 execution 路由为 JSON 轮询），SSE 为净新增，措辞误导（r2 观测 2 未承接）；② 「capabilities +`interactive`」——枚举**已含** `interactive`（`packages/worker-core/src/profile.ts:14`），实为「在 `workers/opencode.yaml` 启用 + 增 interactive 段 + `serveCommand` 校验」（r2 观测 3 未承接）。
- **建议**：① 改「净新增 SSE，自建有界队列 + 重连 + durable 对齐」；② 措辞改为「启用 + 扩展 profile 段」。

## 已闭合项（不计分，源码复核成立）

1. **规则 2 的 v2 会话面成立。** `POST /api/session` payload `{id?, agent?, model?, location?}`（`protocol/src/groups/session.ts:129-144`），handler 原样透传（`server/src/handlers/session.ts:68-78`），`Location.Ref = {directory, workspaceID?}`（`schema/src/location.ts:9-12`）；agent 未注册**不报错**（`core/src/session.ts:208-236`）；`session.switchAgent` 亦在（`protocol/src/groups/session.ts:173-187`）→「agent + directory 双锚定」路径成立（生效性见高-1）。
2. **core 侧 config→agent 注册链完整存在**（只是载体不是 env）：`core/src/location-services.ts:42-79`（Config/AgentV2/PluginInternal/ToolRegistry/PermissionV2 同处 locationServices）→ `core/src/plugin/internal.ts:111,115` → `core/src/config/plugin/agent.ts:80-113`（`agents` + `permissions` 键形，V2 `{action,resource,effect}`：`core/src/config/agent.ts` → `schema/src/agent.ts:20-31`）。
3. **规则 3「agent 模型沿用 serve 全局默认」成立。** runner 用 `session.model ?? catalog.model.default()`，**不读** `agent.info.model`（`core/src/session/runner/model.ts:188-213`）；v2 create 不写 `session.model`（`core/src/session.ts:230-236`）。附带事实：默认模型缺失时抛 `ModelNotSelectedError`（`:203`），建议 spec 加一句「serve 需有可用默认模型」。
4. **规则 5 的事件/轮询通道自洽。** 会话级列表/回复端点在（`protocol/src/groups/permission.ts:89-102,119-`）；`permission.v2.*` 在 `/api/event`（r2 已核 `schema/src/event-manifest.ts`）；`/api/event` 无 location 中间件且 `EventV2` 为 **global** node（`core/src/event.ts:638`）→「一条全 serve 共享订阅、按 sessionID 分发」成立（`SessionEvent.Base.sessionID`、`Permission.Request.sessionID`）。
5. **规则 3「未配置工具默认 ask」在 agent 已注册且无外部宽松规则时成立**：`evaluate` 未命中回退 `effect:"ask"`（`core/src/permission.ts:76-86`）；deny/allow 优先级按 `findLast`（`:76-86,147-162`）。
6. **规则 8/验收 6 鉴权面成立**：`OPENCODE_SERVER_PASSWORD`（`server/src/auth.ts:29-37`，默认用户名 `opencode`）、Basic 头（`server/src/middleware/authorization.ts:29-36`，亦支持 `?auth_token=`——ATD 主动不用，属设计选择）。
7. **Epic 四条验收 + 决策 C/D 覆盖未回退**：演 1-4 ↔ Epic §9 S2b1 ①-④（`epic-spec.md:193`）；决策 C 重释（durable 事件镜像，`Text.Ended` 可重放全文）与决策 D 能力等价（自起常驻 serve + 密码）仍成立；`epic-spec.md:120`「workspace.repos 即白名单」→ 规则 3「各 repo 前缀」方向一致（动作口径待中-1 修正）。
8. **ATD 侧回归面**：`capabilities` 枚举已含 `interactive`（`packages/worker-core/src/profile.ts:14`，措辞见低-3）；`UnifiedEvent` 现 8 型（`packages/worker-core/src/events.ts:5-13`），`map-events.ts` 为非穷尽 switch（r2 已核）→ 新增 `reasoning`/`permission_request` 不破坏 task 映射器；规则 10 的 web 手抄义务已在册。

## 观测（不计分）

1. **ATD 无 SSE 既有实现**：`apps/server/src` 内 `text/event-stream` 零命中（既有 execution 路由为 JSON 轮询）→ 范围/风险表宜按「净新增」定性（并入低-3）。
2. **探针报告落点未具名**（行 41「探针报告归 plans/」）：建议明确 `plans/atd-s2b1-humanthink/probe-{p1,p2,p3}.md` 与结论回填（spec 或 impl 前置门）位置。
3. **`humanthinkPort`（4900 段）与 `OPENCODE_SERVER_PASSWORD` 注入需新增 config 键**：建议在范围或规则 1 一并声明配置键名与默认值，避免 impl 期自定（与 S2w1 config.yaml 扩展同窗合流）。
4. **中-1 修正后 acceptance 4 的可验证性更好**：`external_directory` 的 allow/deny 均为硬语义（deny 直接 `BlockedError`，allow 直接放行），比 `read` 前缀匹配更易在 P1c 里断言。

## 结论

# REJECT

状态：SPEC_REVIEWING → SPEC_DRAFT

> r2 十项中 **5 项完全闭合**（m1 / m3 / 低-3 / 低-4 / 低-5），**5 项部分闭合**（high / m2 / m4 / 低-1 / 低-2）。r3 新核出 1 处 critical：路径②的注入载体 `OPENCODE_CONFIG_CONTENT` 只进 app（V1）配置链，core Config（v2 面唯一配置源）不读该 env → 动态 agent 不注册、权限回退 catch-all deny（验收 4/1 失败、审批链无事件）。另有 3 处 medium（越界读动作应为 `external_directory`、探针未定载体且 fallback 校准失当、agent 规则集被用户全局规则前置污染）与 4 处 low。**修订无需推翻路径②**：换载体（私有 `OPENCODE_CONFIG_DIR` + core V2 `agents` 键形，或 location 级 `.opencode/opencode.json`）+ 三处语义/措辞收敛即可回 SPEC_REVIEWING。未修改 spec 正文与任何业务代码。
