# 审查报告: atd-s2b1-humanthink spec (Revision 1)

- **审查类型**：Spec 轻量审查（r1 首轮；维度：Epic 覆盖 / 内部一致性 / 可实现性 / 契约完备性 / 边界与风险）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2b1-humanthink/spec.md`（v2 终稿形态，71 行）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md` §4.3/§4.4/§4.6/§7/§9 S2b1 行 + 决策 C/D；S2w1 spec §5 边界移交
- **源码级核对仓**：`/home/starlex/project/opencode/packages/`（1.18.21 快照，只读）——`protocol/src/groups/session.ts` / `protocol/src/groups/event.ts` / `protocol/src/groups/permission.ts` / `protocol/src/groups/health.ts` / `schema/src/session-event.ts` / `schema/src/event-manifest.ts` / `schema/src/durable-event-manifest.ts` / `schema/src/permission.ts` / `schema/src/v1/permission.ts` / `opencode/src/session/session.ts` / `opencode/src/permission/index.ts` / `opencode/src/server/routes/instance/httpapi/{groups,handlers}/session.ts`
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（只读）——`packages/worker-core/src/{events,profile,registry}.ts`、`packages/worker-opencode/src/map-events.ts`、`apps/server/src/{app,index,config,workspaces,perm-config}.ts`、`apps/server/src/routes/execution.ts`、`apps/web/src/App.tsx`
- **日期**：2026-09-25

## 总体评价

[不通过]

Epic §9 S2b1 四条验收逐条有承接、决策 C/D 落点明确、per-session directory 与 findLast 权限语义两条源码背书**经核对成立**，整体方向与详实度良好。但**首轮即发现 1 处 high + 3 处 medium**，均落在「spec 声称的 serve 侧契约」与源码契约不一致，且其中两条直击头条验收（验收 1 流式渲染、验收 4 白名单）：

- **高-1**：业务规则 4 的「份数据两用（单订阅：镜像 + live 转发）」在 serve 契约上不成立——per-session `?after` SSE 端点**只推 durable（`StreamSse({data: SessionEvent.Durable})`）**，delta 非 durable 不在其上；验收 1 的 text-delta 逐字渲染必须另接全局 `/api/event` 流。spec 未声明第二通道。
- **中-1**：业务规则 2 / 做清单声明的 `POST /api/session` 注入 per-session permission ruleset，**v2 协议该 payload 无 permission 字段、亦无 PATCH**；permission 仅 instance 面 `POST /session`（`payload=[NoContent, Session.CreateInput]`）与 `PATCH /session/:sessionID` 暴露。spec 同段却对删除用「instance 面 DELETE 透传」——两面混用口径需写死。
- **中-2**：业务规则 2「不设 catch-all（保留默认 ask）」与验收 4「越界 read 硬 deny」**互斥**；风险表 fallback（bash 目录级 deny）与 read 越界不是同一通道，不够具体。
- **中-3**：业务规则 3 把「permission 相关 durable 型」列入 `DurableDefinitions`，而该集**含 0 个 permission 事件**（permission.v2.asked/replied 非 durable，`EventManifest.Durable` 仅 SessionV1 + SessionEvent）。

上述均可在 spec 层收敛（能力面均存在可用路径），但 impl 若按现字面执行会走错通道/端点，故本轮判 **REJECT**，回 SPEC_DRAFT 修订。

## 分数

**65 / 100**（100 − 1×high12 − 3×medium5 − 4×low2 = 100 − 12 − 15 − 8）

## 维度核查结论

| 维度 | 结论 |
|---|---|
| 1 Epic 覆盖 | **基本成立**：§9 四条验收逐条承接（①→验收1 ②→验收2+规则9 ③→验收3 ④→验收4+规则2）；决策 C（server 镜像）落 `humanthink_events`+镜像/恢复，决策 D（attach serve）落 serve 生命周期；S2w1 §5 移交的 interactive 部分（per-session directory 承接 cd 注入、AGENTS.md 随 per-directory 实例天然加载）承接完整，task 模式切换经澄清①显式拆出（合规）。缺陷集中在承接的**通道细节**（高-1/中-1/中-2）。 |
| 2 内部一致性 | **存在硬冲突**：规则 2（不设 catch-all/保留默认 ask）↔ 验收 4（越界硬 deny）；规则 3（durable 含 permission）↔ 源码 durable 集。其余（单进程拓扑 ↔ 验收 3 零干扰；「不做」↔ 澄清记录）自洽。 |
| 3 可实现性 | **路径存在但 spec 口径不精确**：per-session directory + findLast + aggregate=sessionID 的 seq 三条源码事实成立（见核查通过项 1–3）；但规则 2 白名单表达 / permission 注入端点 / 转发通道三处需先定稿。migration 0005 与 S3 0004 并行编号冲突见低-1。 |
| 4 契约完备性 | **留白偏多**：9 端点的请求体/错误形态/SSE 帧载荷未定义（低-2）；web 手抄 `types.ts` 同步义务、UnifiedEvent 扩展对既有 task 映射器的兼容义务未记档（低-3）；`map-events.ts` 用 `default: return []`（非穷尽），兼容面安全但应记档。 |
| 5 边界与风险 | 验收 4「诱导读取」构造路径可测（探针用例先行），但可测性受中-2 阻；审批中转「轮询 vs 事件触发」留白**不可接受**——源码 permission 事件在全局 `/api/event`（`permission.v2.*`），不在 `session.next.*`，规则 5/6 的「serve 事件流内的 permission 事件」「按 session.next.* 分发」需随之修正（并入高-1）。 |

## 发现的问题

### 高-1（high）转发通道契约错误：「一份数据两用」不成立，delta 通道缺声明

- **位置**：背景③④（行 14）、业务规则 4（行 55）、业务规则 6（行 57）、验收 1（行 42）
- **源码事实**：
  - per-session SSE `GET /api/session/:sessionID/event?after=` 的响应类型是 **`HttpApiSchema.StreamSse({ data: SessionEvent.Durable })`**（`protocol/src/groups/session.ts:327-334`），描述「Replay durable events after an aggregate sequence, then continue with new durable events」——**只承载 durable**。
  - `SessionEvent.DurableDefinitions` 收录 Text.Started/Ended 而**不含 Text.Delta / Reasoning.Delta**（`schema/src/session-event.ts:448-477`）；delta 仅在 `Definitions`（`:479-512`）。故 `text.delta` 不在该端点上。
  - 全局 `GET /api/event`（`protocol/src/groups/event.ts:35`，`StreamSse`）的 data = `EventManifest.ServerDefinitions`，含 `SessionEvent.Definitions`（**含全部 delta**，`event-manifest.ts:37,57-61`）与 `Permission.Event.Definitions`（`permission.v2.asked/replied`，`schema/src/permission.ts:43-45`）——但**无 `?after` 查询参数**（无重放游标）。
- **描述**：spec 把 serve 侧订阅当作「一份数据两用（镜像写库+live 转发）」的单通道，且以「SSE `?after` 游标重放」（仅 session 端点具备）为背书。但 session 端点不含 delta → 验收 1「text-delta 流式逐字渲染」在该通道上**不可能达成**；要拿 delta 与 `permission_request` 必须再接全局 `/api/event`（不可重放）。规则 6「映射器按 serve `session.next.*` 事件型分发」也覆盖不到 `permission.v2.*`（非 session.next 命名空间）。
- **影响**：impl 按现字面只建 session 订阅 → 无逐字流式、无审批事件触发（验收 1/4 失败）；「live 渲染吃 delta 有官方语义背书」的立论正确但通道映射缺失，质量门可判实现与 spec 不符。
- **建议**：业务规则 4 改为**双通道**并写死职责——①`/api/session/:id/event?after=<seq>`：durable 回放+镜像+durable live 转发（web 重连 `?after` 数据源）；②`/api/event`（全局，无游标）：delta 逐字 + `permission.v2.asked` 事件触发，ATD 按 session/location 分发改写为「一份数据两用」的正确表述。规则 6 的分发键同步改为 `session.next.*`（会话事件）+ `permission.v2.*`（审批）。并发/背压口径落在全局流上的订阅过滤。

### 中-1（medium）per-session permission 注入端点与命名面不符（v2 无 permission、无 PATCH）

- **位置**：背景②（行 14）、做清单行 22、业务规则 2（行 53）
- **源码事实**：
  - v2 `POST /api/session` payload = `{id?, agent?, model?, location?}`（`protocol/src/groups/session.ts:129-135`）——**无 `permission`**；v2 session 组**无 PATCH/update 端点**（`:109-360` 全量端点核对）。
  - permission 的 create 注入在 **instance 面**：`POST /session`，`payload=[HttpApiSchema.NoContent, Session.CreateInput]`（`opencode/.../groups/session.ts:29,203-206`），handler 解码 `Session.CreateInput` 并透传 `permission`（`handlers/session.ts:166-172`）；`Session.CreateInput.permission` 存在（`opencode/src/session/session.ts:267`）。
  - 运行中改权限在 **instance 面** `PATCH /session/:sessionID`，`UpdatePayload.permission`（`groups/session.ts:49-58,227-230`），handler `setPermission`（`handlers/session.ts:194-198`）。
  - 而 `location.directory`（spec 声明用于 create）是 **v2** 字段（`Location.Ref`，`schema/src/location.ts:9-12`）。
- **描述**：spec 把「`location.directory`（v2）」与「per-session permission（instance）」写在同一个 `POST /api/session` 上，该组合两端点都不存在；且同段删除却写「instance 面 DELETE 透传」——两面混用未统一。造成「声称的源码级背书 ②」在命名面上不成立。
- **影响**：impl 拿 v2 create 注入 permission 会静默丢失（session 落到全局 permission），验收 4 白名单失效；须自行发明端点组合。
- **建议**：写死端点组合并加二进制探针——推荐 instance 面 `POST /session`（`Session.CreateInput`）+ `PATCH /session/:sessionID`（permission）承载权限注入与改权，v2 `/api/session` 仅承载 location/prompt/interrupt/events/history；或对实际二进制确认 v2 create 是否已补 `permission`。在头部补一条「面混用说明」（v2 与 instance 并存）。

### 中-2（medium）业务规则 2 与验收 4 互斥；ruleset 白名单表达力未定稿

- **位置**：业务规则 2（行 53）、验收 4（行 45）、风险表第 2 行（行 68）
- **源码事实**：`evaluate` 用 `findLast(rule => match(permission, rule.permission) && match(pattern, rule.pattern))`，**无命中默认 `{action:'ask', pattern:'*'}`**（`opencode/src/permission/index.ts:28-35`）；ruleset 元素形如 `{permission, pattern, action}`（`:188-195`）。
- **描述**：findLast 语义要求「越界 read 硬 deny」必须由**一个匹配全部路径的前置 deny**（实质 catch-all deny）实现，再后置 allow 各 repo 前缀（后置胜出）；而规则 2 明写「**不设 catch-all（保留默认 ask）**」——二者不可兼得。若真不设 catch-all，则「workspace 外路径」默认落到 ask（**弹审批**），与验收 4「越界 → 硬 deny（不弹审批）」直接冲突。「workspace repos 之外」是开集，无法用有限 pattern 枚举。
- **影响**：验收 4 按现字面不可实现；impl 需自决「设不设 catch-all deny」，质量门可各取一读法判不符。风险表 fallback「目录级 deny（bash cd 越界）」与 read 工具越界不是同一 permission 键，不构成对 read deny 的兜底。
- **建议**：规则 2 改为「read ruleset = 前置 catch-all deny（如 `**`）+ 后置显式 allow 各 repo 前缀（`<repoPath>/**`，后置胜出）；其余工具**不设** catch-all，保留默认 ask」——把「不设 catch-all」限定到非 read 工具。验收 4 补「read 越界命中前置 deny → 直接拒绝（无审批弹卡）」的构造路径，并要求 impl 先行探针验证 `Wildcard` 对绝对路径 glob 的匹配行为；fallback 需改为**对 read 通道**的降级（如收紧到「仅 allow 白名单目录」），而非 bash 目录级 deny。

### 中-3（medium）业务规则 3 的 durable 集列举错误（permission 不在 durable）

- **位置**：业务规则 3（行 54）；关联业务规则 5（行 56）、6（行 57）
- **源码事实**：`Durable = Event.durable([...SessionV1 durable, ...SessionEvent.DurableDefinitions])`（`schema/src/durable-event-manifest.ts:12-15`）；`SessionEvent.DurableDefinitions`（`session-event.ts:448-477`）与 SessionV1 的 durable 子集**均无 permission 事件**。permission 事件是顶层 `permission.v2.asked/replied`（`permission.ts:43-45`，非 durable）与 v1 `permission.asked/replied`（`v1/permission.ts:61-65`，且 v1 不入 `ServerDefinitions`）。`EventManifest.Durable.size = 32`（= SessionV1 4 + SessionEvent 28）无 permission 位。
- **描述**：规则 3 把「permission 相关 durable 型」写进 `DurableDefinitions`，与源码不符；这会误导镜像实现去 durable 流里等 permission（永远等不到），也让恢复语义（规则 7）漏掉「pending 审批不持久、ATD 重启须重拉」。
- **影响**：审批镜像/恢复路径按错误前提实现；实测将出现「审批卡不出现/不还原」。
- **建议**：规则 3 删去 permission 项，明确「durable 集 = SessionV1 + SessionEvent.DurableDefinitions（含 text.started/ended、reasoning.started/ended、tool.called/success/failed、step.*、prompt*）」；permission 请求**不落库**，由规则 5 的 live 触发（全局 `/api/event` 的 `permission.v2.asked`，见高-1）+ 会话端点 `GET /api/session/:id/permission` 兜底拉取；规则 7 补「ATD 重启后对活跃会话重拉 pending 审批」。

### 低-1（low）migration 0005 以 S3 的 0004 为前置，且未声明该跨 Story 依赖

- **位置**：做清单行 27（`DB migration 0005`）
- **事实**：实际 migration 至 `0003_s2w1_blocker_inline.sql`；S3 spec 行 33 已占 `0004`（并自陈 drizzle meta snapshot 落后风险）。Epic §9 明示 S2b1 与 S3 互相独立、可并行。
- **描述**：S2b1 硬编码 0005 隐含「S3 先落 0004」的未声明前置；两 Story 并行合入时后并者须重编号且 drizzle journal 序会冲突（0003 无 snapshot 问题叠加）。
- **建议**：spec 注明「0005 假设 S3 0004 先落；若并行合入冲突，由后合方按 journal 重编号（generate 前先校正 0003 期 snapshot）」，或将编号表述为「下一个可用序号」交由 impl 任务书处理。

### 低-2（low）9 个 API 端点的请求体 / 错误形态 / SSE 帧载荷未定义

- **位置**：做清单行 29（API 面）
- **描述**：仅列路由与少量 query，缺：建会话请求体（`{workerId, workspaceId}` 是否含 title/agent/model）、prompt 请求体形态、`GET .../:id/events` 的 SSE 帧结构（event 名/seq/type 载荷）、各端点错误码（serve 未起 / session 不存在 / worker 不支持 interactive / 越界 deny 的返回形态）。ATD 错误信封为 `{error:{code,message}}`（`app.ts:59-72`）与未知路由 404 兜底（`app.ts:75-77`），新面需对齐。
- **建议**：补一节「ATD API 契约」：请求体 + 成功/错误形态 + SSE 帧 schema（含 `seq` 语义与 web 重连 `?after`），供 web 手抄与质量门比对。

### 低-3（low）扩展面记档缺失：web 手抄 types.ts 同步义务 + UnifiedEvent 对既有映射器的兼容义务

- **位置**：做清单行 25（UnifiedEvent 扩展）、验收 7（行 48）
- **事实**：`packages/worker-core/src/events.ts:5-13` 现 8 型；`packages/worker-opencode/src/map-events.ts:24-50` 以 `switch` + `default: return []`（非穷尽）分发，故新增联合成员**不破坏** task 映射器编译（兼容面安全）。AGENTS.md §四要求「api 契约手抄 types.ts 需与 server zod 同步」。
- **描述**：spec 未记「新增两型仅 interactive 路径产出、task 路径输出不变」的兼容义务，也未记 web `types.ts` 手抄同步义务（S3 spec 有同类条款）。
- **建议**：验收 7 后补一句兼容义务（新型仅 interactive 产出 + 既有 task 映射器零改动）与 web `types.ts` 手抄清单。

### 低-4（low）serve 生命周期挂载面未声明（现无退出钩子 / AppRuntime 无生命周期字段）

- **位置**：做清单行 20（serve 生命周期「随 ATD 退出销毁」）
- **事实**：`AppRuntime` 为纯数据对象，无生命周期/shutdown 成员（`apps/server/src/app.ts:18-26`）；生产入口 `index.ts` 无 `SIGTERM/SIGINT` 处理、无 `app.close`（`index.ts:29-38`）；`buildApp` 为同步工厂（`app.ts:47`）。`WorkspaceRegistry.resolveRepoPath` 可直接复用（`workspaces.ts:69-72`）。
- **描述**：serve 的拉起（异步健康检查）与「随 ATD 退出销毁」需新增生命周期 plumbing（启动顺序、退出钩子、崩溃重启状态机），spec 未声明挂载点与失败语义（serve 起不来时 ATD 是否启动失败）。
- **建议**：spec 补「serve 生命周期模块挂载 `buildServer`（AppRuntime 增 `humanthink` 字段）+ index.ts 注册退出钩子」与「serve 启动失败 → 记录并降级（聊天页不可用），不阻塞工单面」的失败语义。

## 核查通过项（不计分）

1. **per-session directory 一等字段成立**：`Session.Info.directory`（`opencode/src/session/session.ts:229`，落库 `:517`）、v2 create `location: Location.Ref`（`protocol/.../session.ts:134`）、`Location.Ref.directory: AbsolutePath`（`schema/src/location.ts:9-12`）。spec 背景① 成立。
2. **findLast last-match-wins + 无命中默认 ask 成立**：`permission/index.ts:28-35`。spec 背景② 的语义部分成立（端点部分见中-1）。
3. **durable 不含 delta、aggregate 为 sessionID 成立**：`session-event.ts:448-477`（无 delta）；`options = { durable: { aggregate: "sessionID", version } }`（`:38-43`）→ `?after=<seq>` 与镜像 `UNIQUE(session_id, seq)` 对齐，规则 3「seq 按 serve 事件序」成立。spec 背景③「durable 不含 delta」成立。
4. **会话恢复双通道存在**：`session.history?after=`（`protocol/.../session.ts:307-322`，「public durable Session events after an exclusive aggregate sequence」）+ `session.events?after=` 回放（`:327-334`）。规则 7「history?after 补拉」路径可落（分页见观测 2）。
5. **审批 reply 端点齐备**：`permission.reply`（`protocol/.../permission.ts:119-136`，payload `{reply, message?}`）+ `session.permission.list`（`:89-102`）→ ATD 中转可行（规则 8「web 不直连 serve」落点成立）。
6. **ATD 侧装配与回归面**：`resolveRepoPath`（`workspaces.ts:69-72`）供 directory；`capabilities` 已含 `interactive`（`profile.ts:14`）；路由新增 `/humanthink` 与 `AppLayout` 接入面清晰（`App.tsx:15-27`）；task 链独立于新模块（验收 7 零回归可行）。
7. **`session.prompt` 为 durable-admit**：v2 `session.prompt` 返回 `SessionInput.Admitted`（`protocol/.../session.ts:205-214`），与规则 4「prompt 透传（durable-admit）」一致。

## 观测（不计分，供修订/impl 参考）

1. **Epic 「standalone 实例池」偏离未记**：Epic §9 / §4.6 措辞为「standalone 实例池」「interactive 实例权限注入」，spec 取「单 serve 进程 + per-session directory」（澄清③）。能力等价且有理据，但缺 S3 式「偏离清单」留痕，质量门按 Epic 字面比对可能疑问。
2. **history 单页上限 ≤100**：`SessionHistoryLimit ≤ 100`（`protocol/.../session.ts:87`），规则 7 的「按 history?after 补拉」须分页循环，spec 未提。
3. **健康端点双形态**：二进制 smoke test 用 `/global/health`（`opencode/test/cli/serve/serve-process.test.ts:14,25`），协议声明 `/api/health`（`health.ts:5`）。spec 取 `/global/health` 与二进制一致，**不判扣分**；建议 impl 以探针二次确认。
4. **风险表「参照既有 logs tail 端点模式」不实**：ATD 既有为 JSON 轮询 `GET /api/tickets/:id/logs?tail=`（`routes/execution.ts:57-80`），**全仓无 SSE 端点**（grep `text/event-stream` 零命中）；ATD 侧 SSE 为净新增，背压/断线无既有模式可抄，风险表该行宜改为「净新增 SSE 通道，自建有界队列表述」。
5. **profile 措辞**：`capabilities` 枚举已含 `interactive`（`profile.ts:14`），做清单「capabilities 增 interactive」实为「启用 + 增 interactive 段 + `protocol` 仍为 `spawn-cli` 的语义澄清」——Epic §4.4 的 attach-server 形态位与 spec 的 ATD 托管 serve 需一句界定。
6. **审批时序**（第五维）：事件触发可行且在全局流（观测并入高-1）——若采纳高-1 双通道，`permission_request` 可搭全局流车，无需额外轮询即可覆盖实时性；轮询留作重启兜底。二者关系建议在规则 5 写清。

## 结论

# REJECT

状态：SPEC_REVIEWING → SPEC_DRAFT

> 高-1 命中验收 1（流式渲染）的通道契约错误，中-1/中-2/中-3 命中验收 4（白名单）与镜像/审批的 serve 契约，须回 SPEC_DRAFT 修订后再审。三条源码级背书中的「per-session directory」「durable 不含 delta」「findLast 默认 ask」经核对成立，修订无需推翻架构，集中在通道/端点/集合三处口径写死。未修改 spec 正文与任何业务代码。
