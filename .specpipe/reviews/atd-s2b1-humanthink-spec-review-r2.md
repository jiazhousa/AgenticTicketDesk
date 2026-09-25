# 审查报告: atd-s2b1-humanthink spec (Revision 2)

- **审查类型**：Spec 轻量审查（r2 复审：r1 七项闭合核验 + v3 整体复核）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2b1-humanthink/spec.md`（v3 终稿形态，82 行）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md` §4.3/§4.4/§9 S2b1 行 + 决策 C/D；S2w1 spec §5 边界移交；S3 spec 行 33（0004 占位）
- **源码级核对仓**：`/home/starlex/project/opencode/packages/`（1.18.21 快照，只读；与 r1 同版本）
  - 协议面：`protocol/src/groups/{session,event,permission,location}.ts`
  - instance 面：`opencode/src/server/routes/instance/httpapi/{groups,handlers}/{session,event}.ts`、`middleware/workspace-routing.ts`
  - 服务面：`opencode/src/session/session.ts`、`opencode/src/permission/index.ts`、`opencode/src/tool/read.ts`、`opencode/src/share/session.ts`、`opencode/src/event-v2-bridge.ts`
  - core 面：`core/src/{session,session/store,session/sql,session/projector,session/runner/llm,session/execution/local,permission,tool/read,event}.ts`、`server/src/handlers/{session,permission,event}.ts`、`server/src/auth.ts`
  - schema 面：`schema/src/{session,permission,permission-v1,v1/permission,session-event,event-manifest,durable-event-manifest}.ts`
- **ATD 侧核对仓**：`/home/starlex/project/AgenticTicketDesk`（只读）——`packages/worker-core/src/{events,profile}.ts`、`packages/worker-opencode/src/map-events.ts`、`apps/server/src/{app,index}.ts`、`apps/server/src/routes/*.ts`
- **日期**：2026-09-25

## 总体评价

[不通过]

v3 对 r1 的修订**方向正确、多数项已实打实闭合**：双通道（durable 镜像 + 全局 live）、instance 面创建 + directory query、read catch-all deny + repo 前缀 allow + 其余默认 ask、durable 集不含 permission、migration 编号占位——逐条经源码复核成立（详见下表与「已闭合项」）。

但 r2 复核发现一处 **r1 未触达、v3 新引入的架构级硬伤**：v3 把「权限注入」理解成 opencode 的**一套** ruleset，实际该仓存在**两套并存且互不通用的权限系统**——session 级 `PermissionV1.Ruleset`（`{permission,pattern,action}`，instance 面 create 注入，落在 `SessionTable.permission`）与 agent 级 `PermissionV2.Ruleset`（`{action,resource,effect}`，v2 runner 的 core 工具实际使用）。v3 选的 **prompt 面（v2）跑的是 core runner + PermissionV2 + agent 权限**，**从不读 session 级 V1 ruleset** → 「创建时单次注入 per-session 白名单」在所选通道上**没有执行路径**，验收 4（可读范围白名单）按现字面不可达成；且 permission 事件通道随之二选一互斥（V1 事件不在 `/api/event`，V2 事件才在，但 V2 面又不认 session ruleset）。

另有多处 v1/v2 面串味的具体口径错误（规则 5 轮询端点、API 面 PermissionRequest 形状、规则 3 ruleset 字面 shape）与 2 处设计缺口（镜像表 seq 空间、全局流背压缓解不完整）。均属 spec 层可收敛（能力面存在，路径需重选/写死），但**impl 按现字面执行必然走错通道**，故判 **REJECT**，回 SPEC_DRAFT。

## 分数

**58 / 100**（100 − 1×high12 − 4×medium5 − 5×low2 = 100 − 12 − 20 − 10）

## r1 → v3 逐项核验

| r1 项 | 结论 | 核验依据 |
|---|---|---|
| **高-1** 双通道/delta 通道缺声明 | **部分闭合** | delta 与 permission(schema) 在全局流：**成立**（见已闭合项 1）；但 permission 的**运行期事件族**与 v3 权限设计不匹配（V1/V2），且全局流无 permission 回放 → r2 高-1 |
| **中-1** permission 注入端点面不符 | **部分闭合** | instance 面 `POST /session?directory=` 同时接受 directory 与 `CreateInput.permission`：**成立**（已闭合项 2）；但「注入即生效」不成立（v2 prompt 面不读 session 级 ruleset）→ r2 高-1 |
| **中-2** read catch-all deny 与默认 ask 互斥 | **部分闭合** | 语义（read 前置 catch-all deny + 后置 repo allow；其余工具零规则默认 ask）与 findLast last-match-wins **自洽成立**；但规则 3 的 ruleset **字面 shape** 与任一源码 shape 均不符 → r2 中-2；风险表 fallback 仍指向 bash 键，非 read 通道 |
| **中-3** durable 集含 permission 的错误 | **已闭合** | v3 背景④ + 规则 5 已纠偏，与 `DurableEventManifest` 一致（已闭合项 3） |
| **低-1** migration 0005 前置未声明 | **已闭合** | 范围改为「编号占位，实际以合并时 journal 序号为准；S3 已占 0004，预期 0005；同窗合流由调度者统一 generate」 |
| **低-2** 9 端点契约概要未定义 | **部分闭合** | 已补请求体/成功形态概要与「载荷=ATD 统一事件型」；**错误形态**（serve 未起/session 不存在/越界 deny 返回形态）、**SSE 帧结构**（event 名/seq 语义/重连 `?after`）仍未定义 |
| **低-3** 扩展面记档缺失 | **部分闭合** | 「task 映射器零改动 + 新型仅 interactive 消费」已记档（范围 + 验收 7）；**web `types.ts` 手抄同步义务**仍未记 |
| **低-4** serve 生命周期挂载面未声明 | **部分闭合** | 挂载面已声明（`app.ts` 装配 + `index.ts` 启动时序）；**serve 启动失败降级语义**（是否阻塞工单面）与退出钩子注册仍未声明 |

## 发现的问题

### 高-1（high）权限系统 V1/V2 混用：注入的 session 级 ruleset 在所选 prompt 面不被执行，验收 4 无执行路径

- **位置**：业务规则 2（行 61）、业务规则 3（行 62）、业务规则 4/5（行 63-67）、验收 4（行 53）
- **源码事实（1.18.21 快照）**：
  - instance 面 create：`POST /session`（`opencode/.../groups/session.ts:29,203-206`），payload `Session.CreateInput`，其中 `permission: PermissionV1.Ruleset`（`opencode/src/session/session.ts:260-271`），handler 解码并透传（`handlers/session.ts:155-176`）→ 经 `shareSvc.create` → `session.create` 写入 **`SessionTable.permission`（V1 类型）**（`core/src/session/sql.ts:50`；`core/src/session/projector.ts:69`）。V1 shape = `{permission, pattern, action}`（`schema/src/v1/permission.ts:19-25`），findLast 无命中默认 `ask`（`opencode/src/permission/index.ts:28-38`）。**这条 gate 由 app 工具使用**（`opencode/src/tool/read.ts:256` 等），运行时合并 `agent.permission + session.permission`。
  - v2 prompt：`POST /api/session/:sessionID/prompt`（`protocol/src/groups/session.ts:205`）→ `SessionV2.Service.prompt`（`server/src/handlers/session.ts:140-150`）→ `core/src/session.ts:360-385`（admit + `execution.wake`）→ `core/src/session/execution/local.ts:20-21` 驱动 **core `SessionRunner`**。
  - core runner 的工具物化只吃 **agent 权限**：`tools.materialize(agent.info?.permissions)`（`core/src/session/runner/llm.ts:203`）；core `read` 工具走 `PermissionV2.assert`（`core/src/tool/read.ts:36,63,72`），而 `PermissionV2.configured` 只读 **`agent?.permissions`**（`core/src/permission.ts:137-145`），V2 shape = `{action, resource, effect}`（`core/src/permission.ts:76-86`）。
  - **core 侧从不读 `SessionTable.permission`**（全仓 `SessionTable.permission` 读取零命中；`SessionV2.Info` 无 permission 字段，`schema/src/session.ts:19-44`）。opencode app 也未把自身（V1）工具注册进 core `ApplicationTools`（`packages/opencode` 内 `application-tools`/`sdk-next` 零命中）。
  - 事件通道分家：`ServerDefinitions`（= `/api/event` 载荷，`protocol/src/groups/event.ts:35-36,52`）含 **V2** `permission.v2.asked/replied`（`schema/src/event-manifest.ts:49`；`schema/src/permission.ts:43-52`）；**V1** `permission.asked/replied` 只在 `EventManifest.Definitions`（`event-manifest.ts:70`），**不在 ServerDefinitions**——且 `/api/event` 用 `Schema.encodeUnknownSync(OpenCodeEvent)` 逐条编码（`server/src/handlers/event.ts:11-18`），非清单内类型会编码失败。
- **描述**：v3 把权限当作单一体系：规则 2 在 instance 面注入 V1 ruleset，规则 2 同段却让 prompt 走 v2 面，规则 4/5 又在「全局 `/api/event`」上等 permission 事件。三者不能同时成立：
  - 走 v2 prompt（v3 选定）→ 审批事件是 `permission.v2.asked`（在全局流 ✓），但 runner 只看 **agent 权限**，**session 级 V1 ruleset 被无视** → 验收 4 白名单失效；且 V2 权限是 **agent 级非 session 级**，「workspace 白名单」在 v2 runner 下无 per-session/per-workspace 承载；
  - 走 instance 面 prompt（session ruleset 才生效）→ 审批事件是 **V1 `permission.asked`**，**不在 `/api/event`** → 规则 4/5 的 live 通道声明不成立。
- **影响**：impl 按 v3 字面（instance 面 create + v2 面 prompt）实现，将得到「会话建成功、ruleset 静默不生效、越界 read 不被硬拒」——验收 4 直接失败；且权限弹卡事件源与规则 5 的轮询端点（见中-1）语义不一致，审批链可能整体不通。质量门可判「实现与 spec 不符」。
- **建议**（三选一，须在 spec 写死并加二进制探针）：
  1. **权限注入随 prompt 面走**：prompt/审批全部改走 instance 面（`POST /session/:id/message` + V1 权限 + `permission.asked`），则 permission 事件**不在 `/api/event`**，规则 4/5 的 live 通道改由 instance 面 `/event`（instance 级、按 directory 过滤）或**纯轮询**承载；
  2. **改走 v2 面全链**：接受 **agent 级** V2 权限（`{action:'read', resource:'…', effect}`），把 workspace 白名单落到 per-workspace **agent** 配置/或在 create 前动态定义 agent，session 级 V1 ruleset 从设计中移除，规则 3 改 V2 shape（resource 相对 location，越界路径由 `external_directory` 动作承担，非 `read`）；
  3. **保留 V1 session ruleset 但显式声明**「权限 gate 走 app runner 面」，并把 prompt 面同步改为 app 面。
  无论哪条，规则 2「instance 面注入即生效」的论证需重写，并用探针（建会话→诱导越界 read→观测 deny/ask 与事件族）验证。

### 中-1（medium）规则 5 轮询端点与会话级语义不符；API 面 PermissionRequest 形状取自另一套权限系统

- **位置**：业务规则 5（行 67）、API 面 permission 两端点（行 38-39）、验收 4
- **源码事实**：
  - `GET /api/permission/request` 是 **location 级**列表：query 为 `LocationQuery`（`protocol/src/groups/permission.ts:23-26`；`protocol/src/groups/location.ts:5-12`，参数形如 `location[directory]`），**不是「按会话过滤」**。会话级列表是 `GET /api/session/:sessionID/permission`（`protocol/src/groups/permission.ts:89-102`）。
  - 该端点返回 `Permission.Request`（**V2** 形状 `{id, sessionID, action, resources, save, metadata, source}`，`schema/src/permission.ts:25-38`）——**没有 `tool`、没有 `pattern`**。而 v3 API 面写 `PermissionRequest[]（requestID/tool/pattern）`，恰是 **V1** `Permission.Request` 的字段（`schema/src/v1/permission.ts:27-36` 的 `permission/patterns/tool`）。
- **描述**：v3 的轮询端点取 V2 面、payload 描述取 V1 面，同一规则内两套权限系统混串；且「按会话过滤」对应的实际端点不是它列的那个。
- **影响**：impl 按现字面拉取会拿到 location 全域 pending（跨会话串味，需自行二次过滤），且 `tool/pattern` 字段取不到（需改用 `action/resources`），web 手抄契约与后端不符。
- **建议**：规则 5 写死 `GET /api/session/:sessionID/permission`（会话级）为主、`/api/permission/request` 仅作 location 级兜底；API 面 PermissionRequest schema 按实际权限系统改写并落到「ATD API 契约」一节（中-2/低-2 合并处理）。

### 中-2（medium）规则 3 的 ruleset 字面 shape 在源码中不存在

- **位置**：业务规则 3（行 62）；范围权限模型条（行 24）
- **事实**：`{op:'deny', tool:[{name:'read', pattern:'**'}]}` 这一形态在 opencode 源码**零命中**（全仓 grep `op:`/`tool:[{` 无此结构）。真实可用的两套分别是：V1 `{permission, pattern, action}`（`schema/src/v1/permission.ts:19-25`；`opencode/src/permission/index.ts:190,194`）与 V2 `{action, resource, effect}`（`schema/src/permission.ts:57-64`）。
- **描述**：r1 中-2 要求「把 ruleset 表达写死」，v3 给出的是一个**凭空形态**——语义（catch-all deny + repo 前缀 allow + 其余零规则默认 ask）正确，但字面与两套源码都不符。
- **影响**：impl 照抄会构造出 serve schema 拒绝的 ruleset（`POST /session` 400）→ 会话建不出来，验收 1/4 连锁失败。
- **建议**：按高-1 选定的权限系统写出真 shape；若保留 V1，写 `[{permission:'read', pattern:'**', action:'deny'}, {permission:'read', pattern:'<repoPath>/**', action:'allow'}]` 并注明 pattern 需探针确认绝对路径 glob 行为；若改 V2，写 `[{action:'read', resource:'**', effect:'deny'}, {action:'read', resource:'<相对>/…', effect:'allow'}]` 并说明「越界路径走 `external_directory` 动作」。

### 中-3（medium）全局 live 流单订阅的背压缓解不完整（上游订阅溢出即断流）

- **位置**：风险表第 1 行（行 77）、规则 4 live 通道（行 65）
- **源码事实**：`/api/event` 每个订阅者用 `EventV2.allBounded(events, subscriberCapacity)`，`subscriberCapacity = 256`（`server/src/handlers/event.ts:9,33`）；`allBounded` 内部是 `Queue.dropping(capacity)`，**但在 offer 未被接受时 `Queue.fail(queue, SubscriberOverflowError)`**（`core/src/event.ts:152-158`）——即溢出不是静默丢弃，而是**失败该订阅流**（订阅断开）。
- **描述**：风险表缓解写「按 sessionID 分发 + per-session 有界缓冲」，只覆盖了 ATD 内部下游缓冲，**未覆盖上游这一条全 serve 共享、容量 256、溢出 fail-closed 的订阅**；且该订阅为全 serve 共享，慢消费会同时影响所有会话的 delta 与 permission 即时提示。
- **影响**：ATD 消费稍慢即触发上游 overflow → 全局流断开 → live delta 与审批即时提示中断（permission 有轮询兜底、文本有 durable 兜底，故非致命，但需显式重连与状态对齐语义）。
- **建议**：风险表补「上游订阅容量 256、溢出 fail-closed，ATD 侧需即时重连 + 重连后按 durable 全文与 permission 轮询对齐」；或明确采用「只订阅必要事件 + 高频心跳保活」策略，并在验收 2/3 加一条断流恢复用例。

### 中-4（medium）镜像表 seq 空间未定义（规则 4 与规则 5 的镜像一致性缺口）

- **位置**：范围 DB migration（行 28，`humanthink_events ... UNIQUE(session_id, seq)`）、规则 4（行 63-66）、规则 5（行 67）、API 面 events（行 34）
- **描述**：同一张 `humanthink_events` 既装 serve durable 事件（`seq` = serve aggregate seq，规则 4 的 `?after` 亦以此为游标），又装 ATD **自写**的 `permission_request/resolved` 行（规则 5）。spec 未定义 ATD 行的 `seq` 取值空间与防碰撞策略：若用独立计数器，会与后续 serve durable seq 撞 `UNIQUE(session_id,seq)`；若用 `serve max+1`，下一批 serve durable 又会撞；且 web `?after` 回放需在两套来源混排下保持单调有序。
- **影响**：实现期出现插入冲突/丢弃/回放乱序，审批历史与 durable 历史交织后 `?after` 断点续传语义不再可靠。
- **建议**：写死方案任选其一——① 加 `source`（serve|atd）+ `seq` 复合唯一键，回放按 `(source 排序, seq)`；② ATD 行落独立区间/独立 `seq` 命名空间并明确排序键；③ permission 行不进 durable 表，另建 `humanthink_permission_events` 表，firehose 流按到达序合并。同时补 `?after` 游标在多来源下的确切语义。

### 低-1（low）`DELETE` 声明「镜像保留标记」但 `humanthink_sessions` 无对应列

- **位置**：API 面 `DELETE /api/humanthink/sessions/:id`（行 37）、DB migration 列清单（行 28）
- **描述**：建表列只有 `id/worker_id/workspace_id/directory/title/created_at/last_active_at`，无 deleted/archived 标记列，也无「保留标记」的语义定义（列表是否过滤、详情是否可读）。

### 低-2（low）错误形态与 SSE 帧 schema 仍缺（r1 低-2 残留）

- **位置**：API 面（行 30-39）
- **描述**：已补请求体与成功形态；仍缺——serve 未起/session 不存在/worker 不支持 interactive/越界 deny 各自返回的 `{error:{code,message}}` code 与状态码（须对齐 `app.ts:59-77` 既有信封），以及 `GET .../events` 的 SSE 帧结构（event 名、`seq` 语义、`?after` 游标单位、delta/durable/permission 三类的帧区分）。

### 低-3（low）web `types.ts` 手抄同步义务未记（r1 低-3 残留）

- **位置**：范围 UnifiedEvent 条（行 26）、验收 7（行 56）
- **描述**：已记「task 映射器零改动」，但 AGENTS.md §四「api 契约手抄 types.ts 需与 server zod 同步」对应的义务（本 Story 新增 9 端点 + 2 事件型，web 侧需同步）未列入；新增 `reasoning`/`permission_request` 两型还要同时进 `packages/worker-core/src/events.ts`（现 8 型，`events.ts:5-13`）与 web 侧。
- **可选项**：核实 `map-events.ts:48-49` 的 `default: return []`（非穷尽 switch），确认新增联合成员不破坏 task 映射器编译——**成立**，此点可仅作记档。

### 低-4（low）serve 启动失败降级语义未声明（r1 低-4 残留）

- **位置**：范围 serve 生命周期条（行 21）
- **事实**：`AppRuntime` 为纯数据对象（`apps/server/src/app.ts:18-26`），生产入口 `index.ts` 无 `SIGTERM/SIGINT` 处理、无 `app.close`（`index.ts:29-38`）。
- **描述**：已声明挂载面（app.ts + index.ts），但未声明——serve 起不来时 ATD 是否启动失败/降级（聊天面不可用 vs 工单面继续）、退出钩子的注册点、崩溃重启的状态机与上限。

### 低-5（low）两项对 Epic/S2w1 的偏离未入「偏离清单」

- **位置**：`对 Epic 的偏离清单`（行 8）、澄清记录（行 7）
- **描述**：v3 偏离清单仅一条（决策 C 的 durable 镜像重释）。但——① Epic §9 S2b1 行「standalone **实例池**」与决策 D「attach 常驻 serve」被改为「ATD 自起单 serve + per-session directory」，仅落在澄清③（App 层零干扰定位），未入偏离清单；② S2w1 §5 明写「interactive 上 attach server，**task 模式届时一并切换**」，v3 将 task 切换拆独立 Story，仅落在澄清①/不做，未入偏离清单。质量门按 Epic 字面比对时易生歧义。
- **建议**：两条各补一行偏离记录（含理据与承接 Story）。

## 已闭合项（不计分，源码复核成立）

1. **全局 `/api/event` 真含 delta。** `ServerDefinitions` → `coreDefinitions` 收录 `SessionEvent.Definitions`（**含 `text.delta`/`reasoning.delta`/`tool.input.delta`/`compaction.delta`**，`schema/src/session-event.ts:479-512`；`schema/src/event-manifest.ts:37,57-61`）；`protocol/src/groups/event.ts:35-36` 的 `/api/event` 无 query（**无 `?after`，live-only**）。v3 背景③/规则 4 live 通道成立。
2. **instance 面 create 同时接受 directory 与 permission。** `POST /session` 挂 `query: WorkspaceRoutingQuery`（含 `directory`，`middleware/workspace-routing.ts:22-25`；`/session` 非 `/api/` 前缀 → 走 `selectedWorkspaceID` + `defaultDirectory`，`workspace-routing.ts:86-88,181-184`）与 `payload: [NoContent, Session.CreateInput]`（`groups/session.ts:203-206`）；`CreateInput.permission` 存在（`opencode/src/session/session.ts:260-271`）。r1 中-1 的**端点面**要求成立（生效性见高-1）。
3. **durable 集不含 permission、aggregate=sessionID。** `DurableEventManifest.Durable` = SessionV1 durable + `SessionEvent.DurableDefinitions`（`durable-event-manifest.ts:12-15`），后者无任何 permission 事件（`session-event.ts:448-477`）；`options.durable.aggregate = "sessionID"`（`session-event.ts:38-43`）→ `?after` 与 `UNIQUE(session_id, seq)` 对齐。v3 背景④/规则 5 纠偏成立。
4. **per-session durable SSE 与 history 分页均在。** `session.events` `/api/session/:id/event?after=` → `StreamSse({data: SessionEvent.Durable})`（`protocol/src/groups/session.ts:327-343`）；`session.history` `/api/session/:id/history?after=&limit=` → 单页 durable + `hasMore`，`limit ≤ 100`（`:87-92,307-325`）。规则 4/7 路径成立（分页循环仍建议 impl 显式实现）。
5. **v2 面 create 无 permission、无 PATCH。** `/api/session` create payload `{id?, agent?, model?, location?}`（`protocol/src/groups/session.ts:129-144`）；v2 组无 update/PATCH。故「permission 仅 instance 面」的事实判断成立。
6. **findLast last-match-wins + 无命中默认 ask。** `opencode/src/permission/index.ts:28-38`；V1 ruleset 元素 `{permission,pattern,action}`（`:186-198`）。规则 3 的**语义**成立。
7. **serve 侧关键命令面齐备。** `OPENCODE_SERVER_PASSWORD`（`server/src/auth.ts:31,53`）、`opencode serve --port`（`cli/network.ts:7-14`）、`/global/health`（docs + app 用例）均存在；`session.prompt` 为 durable-admit（`protocol/src/groups/session.ts:205-214`）。规则 1/8 与验收 3/6 的承载面成立。
8. **ATD 侧回归面成立。** `capabilities` 枚举已含 `interactive`（`packages/worker-core/src/profile.ts:14`）；`map-events.ts` 为 `switch` + `default: return []`（非穷尽，`:48-49`），新增 UnifiedEvent 成员不破坏编译；`UnifiedEvent` 已有 `text-delta`（`worker-core/src/events.ts:9`）→ 验收 1 的 text-delta 有既有型承载；路由前缀 `/api/*` 与既有惯例一致（`routes/*.ts`）。
9. **Epic 四条验收与决策 C/D 覆盖完整。** Epic §9 S2b1 ①→验收 1 ②→验收 2 ③→验收 3 ④→验收 4；决策 C 重释（durable 事件镜像替代逐消息镜像）**成立**——`Text.Ended` 为可重放全文边界（`session-event.ts:209` 注释 + `DurableDefinitions` 收录），消息级历史可还原；决策 D 的**能力等价**（自起常驻 serve + 密码鉴权）成立，仅留痕见低-5。

## 观测（不计分）

1. **规则 4 live 通道的 sessionID 分发可行**：`SessionEvent.Base` 含 `sessionID`（`session-event.ts:27-30`），`Permission.Request` 含 `sessionID`（`schema/src/permission.ts:26`）——按 sessionID 分发成立。
2. **ATD 侧 SSE 仍为净新增**（r1 观测 4 未处理）：风险表末行仍写「参照既有 logs tail 模式」，但 ATD 既有为 JSON 轮询（`routes/execution.ts:57-80`），全仓无 `text/event-stream`；建议改为「净新增 SSE，自建有界队列 + 重连语义」。
3. **「capabilities 增 interactive」措辞不准**：枚举已含（`profile.ts:14`），实为「在 `workers/opencode.yaml` 启用 + 增 interactive 段 + serveCommand 校验」，建议措辞对齐。
4. **规则 5 的轮询间隔 2s** 与上游 overflow 断流叠加时，建议明确「断流期间仅靠轮询（最坏 2s 延迟）」的可接受性。

## 结论

# REJECT

状态：SPEC_REVIEWING → SPEC_DRAFT

> r1 七项中 1 项（中-3）与 1 项（低-1）**完全闭合**，其余 5 项**部分闭合**（端点/语义已对，生效性与细节留白）。r2 新增解读出 1 处 high：v3 把 opencode **两套权限系统**（session 级 V1 / agent 级 V2）混作一套，所选 prompt 面执行的是 V2 + agent 权限，导致「创建时注入的 per-session 白名单」无执行路径（验收 4 不可达成），且 permission 事件通道与规则 4/5 互斥。修订无需推翻架构（三条可行路径任选其一并加探针即可收敛），但须回 SPEC_DRAFT 把权限方案与通道一条链写死。未修改 spec 正文与任何业务代码。
