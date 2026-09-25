# 审查报告: atd-s2b1-humanthink — Impl (Revision 1)

- **类型**：Story Impl 完整审查（S-S8 第一轮）
- **审查对象**：`.specpipe/plans/atd-s2b1-humanthink/impl.md`（v1，90 行）
- **基准**：同目录 `spec.md`（v7 业务语言版，SPEC_APPROVED）；契约唯一事实源 `probe-report.md`（探针 8 项漂移定案）
- **技术史锚点**：`atd-s2b1-humanthink-spec-review-r1~r5.md`（r5 冻结权限规则形态与已删会话三分语义）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@fc589c8，只读）
- **核对面**：`apps/server/src/{app.ts,index.ts,config.ts,domain/errors.ts,db/client.ts,routes/types.ts}`、`apps/server/test/helpers.ts`、`apps/server/drizzle/**`、`packages/worker-core/{src/{profile,events,index}.ts,vitest.config.ts}`、`workers/opencode.yaml`、`workspaces/atd.yaml`、`apps/web/src/{App.tsx,components/AppLayout.tsx,api/{tickets,types}.ts,vite.config.ts}`、`config.yaml`、`.specpipe/fence.sh`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-25

## 总体评价

**不通过**——技术方案主体（探针 8 项漂移全部贯彻、权限五规则序列与 r5/P1b 定案逐条吻合、D1-D7 决策链自洽）方向正确，但**任务块文件集存在 3 处硬遗漏**（`web/src/App.tsx` 路由挂载、`domain/errors.ts` 错误码联合、`test/helpers.ts`），其中两处按字面执行**必然编译失败**（fence 红），一处使块 2 交付物不可达（验收 1 无法验证）；另有 1 项 high：镜像落库的「全文主源」`session.text.ended` 未被探针证实，而风险表 fallback 明写「文本缺失接受」，与验收 2「不丢话」直接冲突。据此判 REJECT，修文档即回。

## 质量评分

**9 / 100**（critical×0 / high×4 = −48 / medium×7 = −35 / low×4 = −8）

## spec v7 覆盖核对

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| 规则 1 会话归属（workspace→主仓目录） | 技术方案 3（`location.directory`=主仓绝对路径）+ 契约 `POST /sessions` | ✅ |
| 规则 2 视野=workspace 声明仓（系统硬约束） | 技术方案 2 规则 ②③④⑤；与 r5:26 冻结「② 绝对路径 deny／③ read 相对／④ readable 绝对路径+双动作」一致 | ✅ |
| 规则 3 行为三档 | ① catch-all ask（无匹配默认=allow 的对策）+ ② deny + ③/④⑤ allow | ✅ |
| 规则 4 裁决粒度（只对当次） | 技术方案 5 reply 仅 `once\|reject`；D3；探针漂移 6/7 | ✅（`permission_resolved` 帧缺口见 M3） |
| 规则 5 软删除 | `DELETE`→软删、列表排除、操作类 422 `SESSION_TERMINATED` | ⚠ 历史查阅通道未冻结（M2） |
| 规则 6 断线与恢复（补齐记录＋完整文本对齐） | 技术方案 4 镜像 + message 对账；serve-manager 退避重启 | ⚠ 全文主源未证实 + fallback 冲突（H4）；serve 重启会话持久性（M6） |
| 规则 7 附属关系（起则起/关则停/失效提示） | 技术方案 1（onClose 清理、degraded 503）+ 契约「degraded 全端点 503」 | ✅（对齐 `app.ts:135` onClose 先例） |
| 规则 8 名单时效 | 技术方案 2「serve 生命周期内 workspace 集不变」 | ✅ |
| 规则 9 检索（标题+内容） | 契约 `?q=` 匹配 title+文本 payload LIKE | ✅（观测 3） |
| 规则 10 连接边界（浏览器只连 ATD） | 块 2 `EventSource` 同源（`vite.config.ts:9-11` `/api` 代理先例） | ✅ |
| 验收 1 会聊 | 块 2 HumanThinkPage + 4 组件（流式/reasoning 折叠/工具卡） | ⚠ 路由挂载缺失（H1） |
| 验收 2 不丢话 | 技术方案 4（seq 递增 + message id 幂等去重 + `?after` 回放） | ⚠（H4/M1） |
| 验收 3 不干扰 | 独立端口/独立密码/独立进程组（风险表行 5）；D6 已知接受面 | ✅ |
| 验收 4 有边界 | 同规则 2/3 | ✅ |
| 验收 5 可打断 | `POST interrupt` + 停止按钮 + 无 v2 面回退 instance `abort` | ✅ |
| 验收 6 不泄密 | 随机密码仅内存+子进程；生成文件落 `{dataDir}`（非仓库） | ⚠ 禁入键/凭据字段未枚举（M7） |
| 验收 7 不伤旧（全量测试绿） | 块 1 测试清单 + fence；`packages/worker-core/test`、既有 14 个 server 测试文件 | ⚠ 测试落点错包（M4）+ 装配旁路未声明（H3） |
| 不做清单（自动提单/派单切共享服务/多用户/全文引擎/导出/多 worker 混会话） | 范围与块 2 建会话弹窗（单 worker×单 workspace） | ✅ |

## 探针 8 项漂移贯彻核对

| # | 漂移 | impl 落点 | 判定 |
|---|---|---|---|
| 1 | prompt 字段 `text` | 技术方案 3「字段名 text，探针漂移1」 | ✅ |
| 2 | 事件前缀 `session.*` | 技术方案 4/6；技术方案 2 规则 ① 形态与「`*:*` 永不匹配」教训、catch-all 强制首条 | ✅（durable 子集两处事件名新造，见 H4） |
| 3 | 无 per-session/无 history → 全局流 + message 对账 | 技术方案 4 + D4 | ✅ |
| 4 | 全局 `/api/event` 可用、Basic auth（`?auth_token=` 未用） | 技术方案 4「一条 SSE 共享订阅（Basic auth）」+ 技术方案 7 header 化 fetch | ✅ |
| 5 | 会话级 permission 查询可用 | 技术方案 5 轮询兜底 2s | ✅ |
| 6 | 枚举 once/always/reject | UI 只出 once/reject；D3 | ✅ |
| 7 | saved 按 projectID 共享 | D6 + D3 缓解 | ✅ |
| 8 | agent 列表瞬时空 | 技术方案 1「只看 HTTP 状态」；技术方案 3「不依赖做功能」 | ✅ |

## 发现的问题

### high

1. **块 2 遗漏 `apps/web/src/App.tsx`（路由挂载点）** — 严重程度：high
   - 位置：impl:54-55 块 2 文件表（列 `AppLayout.tsx` 导航入口，未列 `App.tsx`）
   - 代码事实：`apps/web/src/App.tsx:19-25` 为唯一路由挂载处（`<Route path="/tickets" …>` 同层），页面组件不经 `App.tsx` 注册不可达；`AppLayout` 只提供 `NAV_ITEMS` 菜单跳转（`AppLayout.tsx:12-16`）
   - 影响：按任务书执行，`HumanThinkPage.tsx` 无路由入口，导航「聊天」点击落 404（`setNotFoundHandler` 之外为 SPA 缺省），验收 1「会聊」无法验证；块 2 交付面不闭合
   - 建议：块 2 补 `apps/web/src/App.tsx`｜新增 `<Route path="/humanthink" element={<HumanThinkPage />} />`（挂 `AppLayout` 子路由内），并在 NAV_ITEMS 行注明 key 与路由一致

2. **块 1 遗漏 `apps/server/src/domain/errors.ts`（错误码联合 + 状态映射）** — 严重程度：high
   - 位置：impl:65「错误信封复用仓内 `AppError`」+ impl:40「9 端点契约 + 错误码（WORKER_UNAVAILABLE/SESSION_NOT_FOUND/SESSION_TERMINATED/VALIDATION）」；块 1 文件表（impl:28-40）无 errors.ts
   - 代码事实：`domain/errors.ts:2-22` `ErrorCode` 为封闭字符串联合（含 `WORKER_UNKNOWN`，**无** `WORKER_UNAVAILABLE`/`SESSION_NOT_FOUND`/`SESSION_TERMINATED`）；`:24-45` `ERROR_STATUS: Record<ErrorCode, number>` 穷举映射；`AppError` 构造签名 `readonly code: ErrorCode`；`app.ts:64-67` 取 `ERROR_STATUS[err.code]` 直用
   - 影响：不扩联合则三码进 `new AppError(...)` 即 TS2345 编译失败（fence 首步 `tsc --noEmit` 红）；扩联合则必须同步 `ERROR_STATUS`（Record 穷举，漏一项即 TS2739）。此外「建会话时 worker 无 `interactive` capability」的拒绝码未在四枚举中定义（`VALIDATION` 复用或新增 `CAPABILITY_INVALID`），契约面留白
   - 建议：块 1 补 `apps/server/src/domain/errors.ts`｜`ErrorCode` +3（或复用 `WORKER_UNKNOWN` 并注明语义），`ERROR_STATUS` 同步（`WORKER_UNAVAILABLE: 503`、`SESSION_NOT_FOUND: 404`、`SESSION_TERMINATED: 422`）；契约冻结行补 capability 校验的拒绝码

3. **块 1 遗漏 `apps/server/test/helpers.ts`（AppConfig 字面量 + 装配旁路 seam）** — 严重程度：high
   - 位置：impl:35（`config.ts` +`humanthinkPort`，缺省 4900）+ impl:33（app.ts 装配）；块 1 文件表无 `test/helpers.ts`
   - 代码事实：`config.ts:34` `AppConfig = z.infer<typeof configSchema>`——zod `.default()` 的**出参类型为必填**（与现有 `dataDir` 同理）；`test/helpers.ts:85-91` 与 `:186+` 两处**内联 `const config: AppConfig = {…}` 字面量**（无 `humanthinkPort` 键）→ 按 impl 口径（缺省=default）落地即 TS2741 编译失败；且 `helpers.ts:92/:185` 两处 `buildServer(...)` 若被写成无条件装配 humanthink（config-gen+spawn serve+订阅），既有 14 个 server 测试文件全部会真起 `opencode serve` 进程（fence 期资源竞争/超时），并触发 `onClose` 清理缺失
   - 影响：compile break + 既有测试全面回归，属「不伤旧」（验收 7）的直接威胁
   - 建议：块 1 补 `apps/server/test/helpers.ts`（config 字面量 +`humanthinkPort`）；**并明写测试旁路 seam**——如 `RuntimeOptions.humanthink?: false`（缺省关闭，`index.ts` 显式开启）或「serve spawn 只在 `index.ts` 触发、`buildServer` 仅完成 routes 注册与 deps 注入」，二者择一写死，避免 Builder 自由裁量

4. **镜像「全文主源」`session.text.ended` 未被探针证实，且风险表 fallback 与验收 2 冲突** — 严重程度：high
   - 位置：impl:17 durable 子集（`text.ended` 全文／`tool.{called,success,failed,progress}`）vs `probe-report.md:27` 漂移 2 事件族枚举——text 只列 `session.text.delta`（**无 ended**）；tool 族为 `{input.started,input.ended,called,progress,success}`（**无 failed**）；impl:86 风险表「message 端点形状未探明 → fallback=对账仅按消息计数+**文本端点缺失接受**（镜像以 live 流为主源）」
   - 影响：①「助手回复全文」是规则 6「界面以完整文本对齐」与验收 2「内容完整」的唯一持久化载体，落在未证实事件名上属单点；②若 `text.ended` 不存在，镜像只剩 delta（impl 明定**不落库**）→ 历史为空；③fallback 明写「文本缺失接受」与 spec 验收 2/规则 6 正面冲突（spec 允许丢的是**逐字动画**，不是内容）
   - 建议：技术方案 4 把 `text.ended`、`tool.failed` 标注为 **Builder 前置核实项**（serve 真跑录事件名，命名可微调记档）；风险表 fallback 改为「message 列表+详情为**必须打通**的对账源（漂移 3 已给端点，形状核实=编码前置任务）」；补「turn 结束边界以 message 详情回填全文」的兜底路径，删除「文本缺失接受」

### medium

5. **SSE 帧形状不含 seq，`?after=<seq>` 续传无据可依**（清单项②/⑤）
   - 位置：impl:62「帧=`data: {<UnifiedEvent JSON>}`」+ 技术方案 4「seq=ATD 本地每会话递增」「web after 重连」；`packages/worker-core/src/events.ts:5-13` 全部成员仅 `timestamp?`，**无 seq 字段**
   - 影响：web 侧无法记录「已收到的最后 seq」，断线重连只能 `after=0` 全量回放（可经 message id 去重，但语义面弱化）；`worker-core/src/index.ts:1` 与 `routes/types.ts:69-77` 两处手抄镜像也无 seq，契约三方（server 帧/worker-core 类型/web 手抄）不自洽
   - 建议：契约冻结明确帧形为 `data: {seq, event:<UnifiedEvent>}`（单一事实源：`humanthink/events.ts`），或使用 SSE `id: <seq>` 行并声明 web 用 `lastEventId` 回填 `?after`；hand-copy 义务在块 2 行写明含 seq

6. **已删会话的三分语义未继承，历史查阅通道不明确**（清单项②）
   - 位置：impl:61-62 契约（详情「已删：带 deletedAt 返回；**操作类** 422 SESSION_TERMINATED」；未提 SSE）vs `atd-s2b1-humanthink-spec-review-r5.md:30`（spec v6 冻结：「已删除会话：详情返回带 deletedAt 标记（历史可查），**SSE/操作类端点** 422 SESSION_TERMINATED」）
   - 影响：规则 5「删除的会话历史仍可查」的读取通道（详情 `{session, events?}` 的 `events?` 无 query 触发参数；SSE 对已删会话行为未定义）悬空——Builder 可能实现成「已删会话 SSE 可读」或「SSE 直接断」，web 历史页落点不明
   - 建议：契约冻结按 v6 三分口径补齐「详情=`deletedAt` 标记 + 历史只读」「SSE/操作类=422 SESSION_TERMINATED」，并给 `events?` 明确触发参数（如 `?events=1&after=0` 或统一走 SSE 回放）

7. **`permission_resolved` 无 UnifiedEvent 对应成员，审批卡「裁决后关闭」帧未定义**（清单项①/⑤）
   - 位置：impl:18「ATD 收到 asked/rejected 后写镜像自有行（type=**permission_request/permission_resolved**）」vs impl:19 UnifiedEvent 扩展只有 `+reasoning` `+permission_request`；契约亦只给 `GET …/permission/requests`（仅 pending）
   - 影响：web 帧=UnifiedEvent JSON，`permission.rejected` 无映射目标 → 审批卡只能靠 POST reply 后前端乐观清除（若 reply 失败或他处已裁决则卡片悬挂）；镜像回放还会给出联合外 type，类型不安全
   - 建议：UnifiedEvent 补 `permission_resolved`（`{requestID, decision, source: 'reply'|'system'}`）或明写「reply 成功后前端乐观清除 + `GET …/permission/requests` 轮询兜底」二选一，并把镜像 type 值域与 UnifiedEvent 成员对齐成一表

8. **worker-core 测试落点写进 `src/`，新测试将静默不执行**（清单项③/⑥）
   - 位置：impl:37「`packages/worker-core/src/`（schema/类型/**测试**）」；代码事实：`packages/worker-core/vitest.config.ts:5` `include: ['test/**/*.test.ts']`，既有测试在 `packages/worker-core/test/profile.test.ts`
   - 影响：按字面把测试放 `src/` 下，`pnpm -F @atd/worker-core test`（fence 第 4 步）不采集 → `interactive` schema（模板变量 `{port}` 校验/凭据扫描复用）**零覆盖且 fence 假绿**，正是「不伤旧/新测试已实现」的证据面缺口
   - 建议：该行拆为 `packages/worker-core/src/profile.ts`、`src/events.ts`、`src/index.ts` 与 `packages/worker-core/test/interactive.test.ts`（或并入 `test/profile.test.ts`），并参与块 1 最小验证命令

9. **声明面（per-worker `interactive.serveCommand`）与实现面（单一全局 serve + opencode 专有 config-gen）不一致，边界未声明**（清单项③/④）
   - 位置：impl:37（profile 扩 `interactive` 段，`serveCommand` 缺省 `opencode serve --port {port}`、校验必含 `{port}`）+ impl:38（`workers/opencode.yaml` 声明）vs impl:14（单例 serve：一个端口、一份 `agents.atd-ht-{workspaceId}` 生成配置）
   - 影响：spec 做 #6 要求「worker 声明我提供聊天能力**及服务启动方式**」，字面允许多 worker 各带 serveCommand；而实现是单进程 + 单一 opencode 配置格式，第二个 interactive worker 注册时的行为（忽略？再起一进程？配置格式不适用？）无口径。Builder 可能把它写成通用多进程托管（超范围）或静默只用第一个
   - 建议：技术方案 1 或范围节写死「本 Story 仅托管**一个** interactive worker（opencode）；`serveCommand` 声明面为 S2b2+ 多 worker 预留，本轮取首个 interactive profile 且校验唯一性，多于一个则启动报错」

10. **serve 崩溃重启后的会话持久性与 404 兜底未声明**（清单项⑤）
    - 位置：impl:14（崩溃重启退避 3 次→degraded）；impl:17（恢复=对账）；规则 6 要求「ATD 自动拉起并补齐中断期间的对话记录」
    - 影响：对账链与后续 `prompt` 均假定 opencode 侧会话（`sessionID`）在 serve 重启后仍可寻址；探针未覆盖此项。若重启后原 `sessionID` 失效，对账与续聊同步崩（无 `SESSION_TERMINATED`/重建策略），验收 2「重启 agent 服务后继续聊」落空
    - 建议：技术方案 1 或 4 补「serve 重启后以活跃会话 `GET /api/session/:id/message` 探活；404 → 会话标记终止（前端提示 + 禁用输入），或按 ATD 侧镜像重建会话」的策略；探针/冒烟脚本把此路径列为必测项

11. **config-gen 禁入键与凭据剥离口径未枚举，「幂等重写」对象含混**（清单项④/⑤）
    - 位置：impl:15「用户配置为 V1 键形时提取等价语义，**禁入键绝不原样复制**」；「启动幂等重写」；`spec-review-r5.md:27`（spec v6 曾写死禁入键清单：单数 `agent`/`permission`/`provider`，命中即整文件走 V1 迁移 → `agents` 被静默丢弃）
    - 影响：①禁入键不枚举，Builder 无从实现「绝不复制」；②v6 已冻结的具体键清单在 v7→impl 传递中丢失（r5 的中-2 闭合证据面回退）；③「幂等重写」未写明对象=自身生成目录文件、绝不触碰 `~/.config/opencode` 用户全局配置（验收 3「不干扰」的硬边界）；④`providers` 提取是否连同 `apiKey`/`headers` 等凭据字段复制未定（生成文件落 `{dataDir}`，虽非仓库，仍与「密钥只在运行中内存」的意图相悖）
    - 建议：技术方案 2 写死三件——禁入键清单（单数 `agent`/`permission`/`provider`，并注明其余触发键见 core `migrate.ts`）；「只写 `{dataDir}/opencode-config/`，永不写用户全局配置目录」；凭据字段白名单（仅 `model`/`providers.<id>.{name,npm,baseURL,models}`，`options.apiKey` 等一律不复制，凭据仍由 opencode `auth.json` 提供）

### low

12. **D7 引用的 `scripts/smoke-humanthink.sh` 未入任务块且目录不存在**（清单项③）— impl:75 把真跑冒烟留 `scripts/smoke-humanthink.sh`，但仓库无 `scripts/` 目录（glob `scripts/**` 空）且块 1/块 2 文件表未列该件。建议：块 1 补 `scripts/smoke-humanthink.sh`（新建路径）或改写为「冒烟步骤写入交付说明，不落脚本」，避免幽灵路径。
13. **「capabilities 枚举启用」为无效改动**（清单项①）— impl:37 声称启用 capabilities 枚举，但 `packages/worker-core/src/profile.ts:14` 已是 `z.enum(['task','interactive'])`（注释仅陈「interactive 随后续版本接入」）。建议改为「枚举已含 interactive，本 Story 落地其语义 + profile 注释终态化」，且只删注释不算改动点。
14. **`apps/server/src/routes/types.ts` 的 UnifiedEvent 同构镜像未列入改动点**（清单项①/③）— `routes/types.ts:69-77` 手抄同构（日志面用）。新增 `reasoning`/`permission_request` 后两处镜像漂移（不编译报错，但违背仓内「手抄需同步」约定，且块 2 已列同类义务）。建议在该行或块 1 补一句「`routes/types.ts` 同构镜像同步（或明注日志面不涉及新成员）」。
15. **历史回看时 reasoning 全文缺失未声明为接受面**（清单项⑤）— delta 不落库、镜像只存 `reasoning.{started,ended}`（impl:17），重开历史后思考块内容可能为空。验收 1 只要求实时可见、规则 6 指「完整文本」为对话正文，语义上成立但未明写。建议在 D4 或验收 1 落点加一句「历史态 reasoning 仅保留折叠占位（接受面）」，防后续被当缺陷。

## 观测（不计分）

1. **规则 ③ 用 `resource:"*"` 属 v6 相对通配的超集**：r5:26 冻结的是「③ read+相对通配／④ external_directory+read 双动作+绝对通配」，impl:15 写 `read:"*"`。因 `read.ts` 断言序（外部先 `external_directory` 后 `read`，r5:26 已核）+ ② deny 生效，外部绝对读仍被 ② 拦住，功能等价——不需改，Builder 实测确认即可。
2. **`payload LIKE` 检索面**含 reasoning/tool 内容，宽于「内容关键字」，与规则 9 不冲突；如后续要收敛，可只 LIKE assistant 文本 payload 的 json_extract。
3. spec v7 已无技术细节，impl:4-5 的锚点声明（spec v7 + 探针唯一事实源 + 基线 main@fc589c8）齐备，术语面「会话/审批/镜像/对账/degraded」全篇一致，无编辑残留与块间文件集冲突（块 1=`apps/server/**`+`packages/worker-core/**`+`workers/**`+`config.yaml`，块 2=`apps/web/**`，不相交）。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：探针 8 项漂移贯彻与技术方案方向正确，但任务块文件集漏 3 件（`web/src/App.tsx` 路由挂载、`domain/errors.ts` 错误码联合、`test/helpers.ts` 配置字面量与装配旁路 seam），其中两件按字面执行必编译失败、一件使块 2 交付不可达；另 `session.text.ended` 全文主源未证实且 fallback 与验收 2 冲突。补齐 4 项 high + 7 项 medium（文档级，多为一行~一段补齐）后即可复评。
