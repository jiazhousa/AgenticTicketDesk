# 审查报告: atd-s2b1-humanthink — Impl (Revision 2)

- **类型**：Story Impl 完整审查（S-S8 第二轮 / r1 REJECT 复评）
- **审查对象**：`.specpipe/plans/atd-s2b1-humanthink/impl.md`（v2，98 行，commit 7f85af6）
- **基准材料**：r1 报告 `.specpipe/reviews/atd-s2b1-humanthink-impl-review-r1.md`；同目录 `spec.md`（v7 业务语言版，SPEC_APPROVED）；契约唯一事实源 `probe-report.md`（探针 8 项漂移 + 补录 0 号）；技术史锚点 `atd-s2b1-humanthink-spec-review-r1~r5.md`
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（HEAD 7f85af6，工作区干净，只读）
- **核对面**：`apps/server/src/{app.ts,index.ts,config.ts,domain/errors.ts,routes/{types,workers}.ts,db/schema.ts}`、`apps/server/test/{helpers.ts,perm-config.test.ts}`、`apps/server/drizzle/meta/_journal.json`、`packages/worker-core/{src/{profile,events,index}.ts,vitest.config.ts}`、`workers/opencode.yaml`、`apps/web/src/{App.tsx,components/AppLayout.tsx,vite.config.ts}`、`.specpipe/fence.sh`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致；`.stage-history` 第 16 行 `IMPL_DRAFT→IMPL_REVIEWING` 调度者）
- **日期**：2026-09-25

## 总体评价

**不通过（差一项即回）**——r1 的 4 high + 7 medium + 4 low **15 项中 14 项已实打实闭合**：三处文件集硬遗漏（`web/src/App.tsx` 路由挂载、`domain/errors.ts` 三错误码、`test/helpers.ts` 配置字面量 + 旁路 seam D8）全部补齐，两处「按字面执行必编译失败」的账已平；`session.text.ended` 全文主源经探针补录 0 号实证落定、风险表「文本缺失接受」fallback 已删、「不丢话」硬约束回归一致；SSE 帧 seq 语义、worker-core 测试落点 `test/`、`serveCommand` 边界、404 兜底、config-gen 禁入键枚举等逐项到位。

**但 r1 m2（已删会话三分语义）只闭合了一半**：v2 把「SSE/操作类 = 422」写实了（消除了 r1 指出的「SSE 行为未定义」歧义），却**同时把规则 5「历史可查」的唯一读取通道堵死**——`GET .../:id` 只声明「返回带 deletedAt（历史可查）」，未定义响应形状（是否含历史事件），而 `GET .../:id/events`（唯一的镜像读通道）对已删会话一律 422。结果：spec 业务规则 5 与范围 4 的「删除的会话历史仍可查」在冻结契约下**无任何可实现路径**，Builder 只能自由裁量（大概率实现为不可查）。此为该轮唯一 medium，且 r1 已按 medium 计分、v2 未真正闭合，故判 REJECT 回 IMPL_DRAFT 补一行契约即可。

## 质量评分

**87 / 100**（critical×0 / high×0 / medium×1 = −5 / low×4 = −8）

## r1 → v2 逐项闭合表

| r1 项 | 判定 | v2 落点与代码事实核验 |
|---|---|---|
| **h1** App.tsx 路由挂载 | ✅ 闭合 | impl:59 块 2 列 `apps/web/src/App.tsx`（**路由挂载 `/humanthink`（唯一挂载点，约 :19-25）**）——核对 `App.tsx:19-25` 正是 `<Route element={<AppLayout/>}>` 子路由块（`/workbench`…`/tickets/:id/logs` 同层），挂载点定位准确；impl:60 `AppLayout.tsx` 导航入口核对 `AppLayout.tsx:12-16` NAV_ITEMS 成立 |
| **h2** errors.ts 错误码联合 | ✅ 闭合（次点留观测） | impl:37 补 `apps/server/src/domain/errors.ts`｜三码入 `ErrorCode` 封闭 union + `ERROR_STATUS` 穷举。核对 `errors.ts:2-22`（现 20 码无三新码）、`:24-45`（`Record<ErrorCode,number>` 穷举）、`AppError:48-57`（`code: ErrorCode`）、`app.ts:63-67`（`ERROR_STATUS[err.code]` 直用）——修法与现状结构吻合，编译面已平。次点（capability 拒绝码）见观测 O2 |
| **h3** helpers.ts 字面量 + 旁路 seam | ✅ 闭合 | impl:44 补 `apps/server/test/helpers.ts`｜两处 AppConfig 字面量 +`humanthinkPort`；+humanthink 旁路选项（默认 enabled:false）。核对 `helpers.ts:85-91` 与 `:186-192` 恰两处内联字面量、`:92`/`:185` 恰两处 `buildServer` 调用（grep 全 `apps/server/test` 仅此两处 buildServer），旁路 seam 落点齐。impl:15 定 `RuntimeOptions.humanthink?: {enabled:boolean}` 缺省 true、helpers 显式 false；`index.ts:24` 不传该键→走缺省 true 启用（生产链闭合），无第三处 buildServer 调用方，D8 自洽 |
| **h4** 镜像全文主源实证 + fallback 冲突 | ✅ 闭合 | impl:18 `text.ended`（全文主源，`data.text`）+ message 权威兜底；impl:94 风险表「对账 Builder 实测定形；文本权威兜底语义不变（验收「不丢话」硬约束，**无「接受缺失」fallback**）」；D4:79 同口径。`probe-report.md:26`（补录 0 号）实证 `session.text.ended`+`data.text`+`durable:{aggregateID,seq,version}` 信封、`session.tool.failed`、`session.reasoning.ended`——补录与 impl 事件名/载荷口径一致，「文本缺失接受」已删 |
| **m1** SSE 帧 seq 语义 | ✅ 闭合 | impl:69 帧=`data: {seq?, event}`——durable 带 seq、delta 无 seq；`?after=<本地 seq>` 回放。impl:33（events.ts）/39（routes/types.ts 镜像）/55-56（web 手抄）三处同步义务齐；补录 0 号给出 durable.seq 原生序号，语义有据 |
| **m2** 已删会话三分语义 | ⚠ **部分闭合（余 medium）** | impl:68 补齐「列表排除 / 详情带 deletedAt / 操作+**SSE** 422」三分，消除了 r1 指出的「SSE 未定义」歧义；但 r1 建议的「详情=`deletedAt` 标记 + **历史只读**」未落地：`GET .../:id` 响应形状未冻结（是否含历史事件未写），而唯一读通道 `GET .../:id/events` 对已删会话 422→**规则 5「历史可查」无实现路径**（详见「发现的问题 1」） |
| **m3** permission 裁决后关闭帧 | ✅ 闭合 | impl:20 UnifiedEvent `+permission_request`（含 `status:'pending'|'resolved'`——「审批历史回溯并入同型」），pending/resolved 两态均有联合内表示，r1 的「裁决后关闭帧未定义/联合外 type」已消。镜像行 type 双值 vs 联合单型的对照表未成表（观测 O3） |
| **m4** worker-core 测试落点 | ✅ 闭合 | impl:42 `packages/worker-core/test/`（**测试必须落 test/ 目录**——vitest include=test/**，落 src/ 静默不跑）。核对 `vitest.config.ts:5` `include:['test/**/*.test.ts']` 与既有 `test/profile.test.ts` 成立 |
| **m5** serveCommand 边界 | ✅ 闭合 | impl:22「MVP 单 serve（opencode 形态）；profile.interactive.serveCommand 供 spawn 渲染；非 opencode 协议声明的 interactive worker → Registry 校验标记不可用（下拉不列出，记档）」——「仅托管一个」边界写死；暴露面见观测 O4 |
| **m6** 重启持久 + 404 兜底 | ✅ 闭合 | impl:17「会话持久于共享数据目录（serve 重启 sessionID 不变）；ATD 透传遇 serve 404 → 统一 SESSION_NOT_FOUND 兜底」+ impl:45 测试「会话面 404 兜底」——r1 要求的「探活/终止策略」以透传 404 归一承接，语义明确（注：探针未测 serve 重启，属声明式口径） |
| **m7** config-gen 口径 | ✅ 闭合（残项降 low） | impl:16 禁入键写死「V1 迁移触发三键（单数 `agent`/`provider`/`permission`）及全部 V1 键」+「绝不原样复制触发键」（对齐 `spec-review-r5.md:27` 与 `perm-config.test.ts` 既有 V1 键形先例）；写目标经 impl:15 `OPENCODE_CONFIG_DIR` 指向生成目录收敛；凭据选择「providers 原样含凭据（dataDir 不入仓）」为显式反向决策（见 low-2） |
| **l1** scripts/smoke 入块 | ✅ 闭合 | impl:47 块 1 列 `scripts/smoke-humanthink.sh`（新建，可选手动；不进 fence）——核对 `glob scripts/**` 空（目录确不存在），幽灵路径已转显式新增件 |
| **l2** capabilities 措辞 | ✅ 闭合 | impl:43「capabilities 数组加 `'interactive'` 值（schema 枚举已含，零 schema 枚举改动）」——核对 `profile.ts:14` `z.enum(['task','interactive'])` 成立，无效改动声明已修正 |
| **l3** routes/types.ts 镜像 | ✅ 闭合 | impl:39 补 `apps/server/src/routes/types.ts`｜server 侧镜像（含 UnifiedEvent 扩展 re-export）——核对 `routes/types.ts:69-74` 现镜成立 |
| **l4** reasoning 全文待核标注 | ✅ 闭合（接受面留 low） | impl:18 `reasoning.{started,ended}`（**全文载荷以实测为准，缺则仅标记**）；补录 0 号 `session.reasoning.ended` 存在——待核标注落地。r1 建议的「历史态 reasoning 占位接受面」未逐字写入（见 low-3） |

**小计**：14/15 闭合，m2 部分闭合（余 1 medium）。

## 探针补录 0 号一致性核验

| 补录事实（probe:26） | impl 落点 | 判定 |
|---|---|---|
| `session.text.ended` 存在、`data.text` 载全文 | impl:18「`text.ended`（全文主源，`data.text`）」 | ✅ 名称/载荷一致 |
| 事件信封 `durable:{aggregateID, seq, version}` | impl:18/40「serve_seq（durable.seq 原生序号）；幂等键=(session_id, serve_seq)」 | ✅ 语义一致 |
| `session.tool.failed` 存在 | impl:18 `tool.{called,success,failed,progress}` 含 failed | ✅ 一致（补录对漂移 2 的 tool 族枚举构成增补，无冲突） |
| `session.reasoning.ended` 存在（载荷待实测） | impl:18 reasoning.{started,ended} | ✅ 一致 |

补录口径与漂移 2/3（`probe:29/30`）无矛盾，impl 未再出现源码快照口径回流。

## 附加复审点

### A. 双序（serve_seq 幂等键 + 本地 seq）自洽

- **重放场景**：live durable 事件按 `(session_id, serve_seq)` 幂等入库——补录 0 号证实 serve 原生持久序号，去重有据 ✅。
- **回放场景**：`?after=<本地 seq>` 按本地展示序回放，permission 自写行（serve_seq 空）与 serve 行共处一表但分列，`spec-review-r2.md:89-94` 的「seq 空间碰撞」problem 已被双列化解 ✅。
- **对账场景**：**message 端点回落行无幂等键**——schema（impl:40）唯一键仅 `(session_id, serve_seq)`，message 源行无 serve_seq（可空），SQLite 对 NULL 不去重，反复重连对账将重复插入 → 与验收 2「不重」有张力（见 low-1）。
- 退化路径（impl:97 风险表末行）：以「本地 seq」作退化幂等键，对**重投递**事件不成立（本地 seq 于接收时分配，重投递必得新值，无法去重），且风险表写「唯一索引局部」与 impl:40 的 `UNIQUE(session_id, serve_seq)`（非局部）表述不一致（见 low-4）。

### B. 块 1 / 块 2 文件集终核

- 块 1（impl:30-47）与本仓链逐环对齐：routes 注册（impl:35 app.ts）→ app 装配旁路（D8）→ types 镜像（:39）→ migration（:40，`_journal.json` 现止于 idx 4/0004，新增 0005 编号接续正确）→ 测试（:42/:44/:45/:46）→ 冒烟（:47）；块 2（:55-60）web 链闭合（api client→types 手抄→page→4 组件→App.tsx→AppLayout）。块间文件集不相交，未发现新遗漏。
- 观测级：`serveCommand 非 opencode 标不可用` 的**暴露面未列入改动点**（`routes/workers.ts:7-12` 现仅回 {id,name,protocol,capabilities}，无「可用」位）——当前无此类 worker，风险低（观测 O4）。

### C. 契约冻结节 ↔ spec v7 映射

逐条对齐规则 1-10 与验收 1-7：规则 1/2/3/4/6/7/8/9/10 与验收 1/2/3/4/5/6/7 均有明确落点 ✅；**规则 5（软删除）三缺一**——「列表排除」「不能再发消息（422）」成立，「**历史可查**」无读取通道（medium 1）。其余映射完整。

## 发现的问题

### medium

1. **已删会话的「历史可查」在冻结契约下无实现路径（r1 m2 未闭合半边）** — 严重程度：medium
   - 位置：impl:68「已删会话三分语义：列表排除；`GET .../:id` 返回带 deletedAt（**历史可查**）；prompt/interrupt/delete/reply/**events** 一律 422 `SESSION_TERMINATED`」；对照 spec 规则 5（spec:46「删除的会话从列表消失、**历史可查**、不能再发消息」）与范围 4（spec:24「删除会话=从列表移除、**历史仍可查**」）；技术史 `spec-review-r5.md:30`
   - 事实：全 Story 唯一的事件读通道是 `GET .../:id/events`（impl:69），而该行明定已删会话 `events` 一律 422；`GET .../:id`（impl:68）只声明「返回带 deletedAt」，**响应形状未冻结**（是否含历史事件未写；对照 POST /sessions 的 `{session}` 形状已给，GET 详情形状缺失）。故已删会话的对话历史**无任何可取路径**。
   - 影响：① spec 规则 5 / 范围 4 的用户面「历史可查」落空——Builder 按契约字面只能实现为「已删会话不可查」，与业务规则正面冲突；② 块 2 web 历史页对已删会话无数据源，契约冻结（块 2 并行依据）在此端点不完整；③ r1 m2 建议的两条路（`?events=1&after=0` 的详情内嵌 历史只读 **或** 统一走 SSE 回放）v2 选了后者，但已删会话 SSE 恰为 422——选项自相消解。
   - 建议（一行级）：二选一写死——① `GET .../:id` 响应形状补 `{session, events?}` 并注明「已删会话详情携带**只读**镜像事件（历史可查）；`?after=<本地 seq>` 可选」；② 契约把 `events` 从已删 422 名单移出，明写「已删会话 `GET .../:id/events` 允许**镜像回放**（after=0 起）但不再续 live，且不经 `streaming`；prompt/interrupt/delete/reply 仍 422」。同时补齐 `GET .../:id` 的完整响应形状（块 2 依赖）。

### low

2. **config-gen 反向决策（providers 原样含凭据）的边界未闭合，r1 m7 两子项残留** — 严重程度：low
   - 位置：impl:15-16「复制键白名单=`{model, providers}`（providers 原样含凭据——dataDir 本地文件不入仓，MUST-6 边界内）」「启动幂等重写」
   - 影响：① r1 m7 要求的「**只写 `{dataDir}/opencode-config/`，永不写用户全局配置目录**」与「用户全局配置的**基准目录**（`OPENCODE_CONFIG_DIR ?? ~/.config/opencode`，两文件名 + JSONC）」未逐字写入（`spec-review-r5.md:54-57` 曾列 low-3）；② 验收 6 措辞「密钥/密码**只存在于运行中的程序内存**，不落进仓库任何文件」与「providers 原样含凭据落盘」存在措辞张力——虽 dataDir 非仓库、命中「不落进仓库」硬约束，但「只存在于内存」子句未被记档为取舍。
   - 建议：技术方案 2 补一句「生成器仅写 `{dataDir}/opencode-config/`，永不触用户全局目录；用户全局基准目录按 core 规则 `OPENCODE_CONFIG_DIR ?? ~/.config/opencode`（`opencode.json`/`.jsonc` 存在者优先）；providers 原样复制含凭据为显式取舍（落盘于 dataDir、非仓库），与验收 6『不落进仓库』一致」。

3. **历史态 reasoning / tool durable 事件的缺失接受面未声明（r1 l4 残项）** — 严重程度：low
   - 位置：impl:18（delta 不落库；镜像存 `reasoning.{started,ended}`）；探针漂移 3（`probe:30`）——本二进制无 per-session 事件端点、无 /history，durable 回放仅走 message 端点（列表不含 payload）
   - 影响：ATD 停机期间错过的 reasoning/tool/step durable 事件无法经回放补齐（仅 message 级文本可对账）——重开历史时思考块/工具卡可能缺失。规则 6 只承诺「完整**文本**对齐」，语义上成立，但接受面未明写，后续易被当缺陷。
   - 建议：D4 或验收 1 落点加一句「历史态 reasoning/工具卡仅保留停机前已镜像部分（接受面）；停机期间仅保证对话正文经 message 对账完整」。

4. **durable.seq 退化路径的幂等键不成立 + 索引表述与 schema 不一致** — 严重程度：low
   - 位置：impl:97 风险表末行「幂等键失效时退化 `(session_id, 本地 seq)` 双写兼容（serve_seq 可空 + 唯一索引局部）」vs impl:40「serve_seq（INTEGER，UNIQUE(session_id, serve_seq) 幂等键）」
   - 影响：① 「本地 seq」于接收时分配，degraded 场景下同一事件重投递会得到不同本地 seq，无法承担去重（退化路径非有效兜底）；② 风险表「唯一索引局部」与 schema 口径的 `UNIQUE(session_id, serve_seq)`（非局部）表述不一致（SQLite 可空唯一键允许多 NULL，功能上可行但两处措辞不齐）。
   - 建议：风险表改为「幂等键失效时以 message 端点对账为准（不依赖本地 seq 去重）；serve_seq 列可空以容纳 message 源/自写行，唯一索引写为 `UNIQUE(session_id, serve_seq) WHERE serve_seq IS NOT NULL`（局部）」。

## 观测（不计分）

1. **「既有 14 测试文件」实为 13**：impl:44 与 r1:74 均写「既有 14 个 server 测试文件」；核对 `apps/server/test/*.test.ts`（含子目录）实为 13 个（workspaces/api/ticket-service/file-set/state-machine-s2a/dispatcher/api-s3/state-machine/worktree/workspace-contract/perm-config/workspace-crossrepo/api-s2a）。不影响 D8 旁路结论，属计数笔误。
2. **capability 拒绝码未入契约枚举（r1 h2 次点残留）**：impl:37 三新码为 `WORKER_UNAVAILABLE`(503)/`SESSION_NOT_FOUND`(404)/`SESSION_TERMINATED`(422)，contract impl:72 仅给「degraded 503」；「建会话时 worker 无 interactive capability / 非可用 interactive worker」的拒绝码未逐端点写死（复用 `VALIDATION`/`WORKER_UNKNOWN` 或新增均未定）。属端点错误语义留白，Builder 可自洽选择，建议契约冻结行补一行。
3. **镜像行 type 值域 vs UnifiedEvent 联合未成对照表**：impl:19 镜像自写行 type 双值 `permission_request`/`permission_resolved`，impl:20 联合单型 `permission_request{status}`——映射可推（resolved↔status:'resolved'）但未成表；r1 m3 曾建议「对齐成一表」，建议补一行防镜像回放类型不安全。
4. **`serveCommand 不可用` 的暴露面未列入改动点**：impl:22「Registry 校验标记不可用」——`routes/workers.ts:7-12` 现无「可用」位；当前无第二个 interactive worker，风险低，记档即可。
5. **config-gen 白名单不含 mcp/skills/plugins 的取舍未记档**：`spec-review-r5.md:31`（v6 口径）曾记「最小集（仅 model/providers）…记档：如需扩展再议」，spec v7 收敛后 impl 未承该记档（低风险，工具面已有内置工具兜底）。
6. **探针未覆盖项按声明式口径采信**：serve 重启后 sessionID 不变（impl:17）、message 详情形状（impl:94）、readable allow/interrupt 存在性（impl:88）三处均标注 Builder 实测定形/锁定，与 r1 h4 的「Builder 前置核实项」口径一致，本轮不扣分。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：r1 的 4 high + 7 medium + 4 low **14/15 已闭合**（文件集三遗漏全补、镜像全文主源实证落定且 fallback 冲突已删、帧 seq/测试落点/serveCommand/404 兜底/config-gen 禁入键逐项到位），仅 **m2 余半边**：冻结契约把已删会话的唯一事件读通道（`GET .../:id/events`）定为 422，而 `GET .../:id` 响应形状未冻结，「历史可查」（规则 5 / 范围 4）无实现路径——补一行契约（详情内嵌只读历史 **或** 已删会话 events 允许镜像回放不续 live）即可复评。

---

*本轮未修改 impl 正文与任何业务代码；`.stage` 经 `stage_set`（actor=审查者）落 `IMPL_DRAFT`。*
