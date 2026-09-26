# 质量门审查报告: atd-s2b2-orchestration (Revision 1)

> 终检判定：**PASS（92/100）**。七项清单全部通过；4 处 low（`MAX_SPEC_BYTES` 双份常量 / web 解析器与 zod 对空 tasks 口径不一致 / impl 文档 3 处残留表述 / 计划块消息内文本气泡宽度形态变化），无 medium+，均不阻塞用户验收；另 9 项非扣分观察（3 项为既有设计的窄窗复述、6 项为本 Story 新增接缝的风险记档）。
>
> 主线结论：块 1（计划校验单源 + 原子建单 + 产出合同注入 + 放行核心提取）与块 2（`atd-plan` 块解析 + 拆单计划卡）在合并态逐面核实落码；**块间契约（web 手抄 ↔ server 镜像）逐字段一致**；**worker 取值域三域（系统提示/服务端校验/卡片下拉）在 `25fba72` 后严格同一集合**；调度者初裁的两块 7 条偏离**全部复核接受**（其中 2 条文档措辞精度问题单列于 low）。独立复跑 **239 + 16 + 9 全绿 + 三包 tsc + web build 通过**，复跑前后 worktree `git status` 为空。

- 类型：Story 质量门全面审查（S-S10 终检 · 首轮 / r1）
- 对象：worktree `/home/starlex/project/ATD-s2b2-server`，分支 `dev/feat/atd-s2b2-orchestration` @ **`25fba72`**（工作区干净）
- commit 范围：`git diff 21d79c8..25fba72` = **15 文件 +1700 / -89**；链路 `21d79c8`（基线）→ `ec3c9ab`（块 1 server，10 文件 +944/-47）→ `d069429`（块 2 web，5 文件 +755/-42）→ `57475f4`（merge）→ **`25fba72`（块间对账裁决，1 文件 +2/-1）**
- 事实源：spec v3.1（业务语言版，验收按业务语义逐条核）/ impl v2.1 / 项目 `AGENTS.md` / S2b1 r3 与 S3 r1 质量门报告（颗粒度参照）/ impl 审查 r1+r2
- 状态校验：实测 `.stage`（session 工作目录 = 主仓 `AgenticTicketDesk/.specpipe/plans/atd-s2b2-orchestration/.stage`）= **`QUALITY_GATE`**，与质量门「审查前状态」一致 → 允许落定（worktree 内 `.specpipe` 副本 `.stage` 滞后为 `IMPL_APPROVED`，系分支快照，非权威；与 S3 r1 同口径）
- 独立复跑后 `git status --porcelain` 为空（未改一文件；`apps/web/dist/` 为 gitignore 内构建产物）
- 日期：2026-09-26

## 总体评价

**通过**。三个承重面逐面核过：

1. **原子建单的机制真实性**（本 Story 最高风险点）—— `plan.ts:176-217` 外层 `db.transaction` 包 `service` 调用，`service` 的 `createTicket`/`addDependency`/`submitSpec` 各自内含 `this.db.transaction`，**同一 drizzle 实例**（`app.ts:92` `registerHumanThinkRoutes(app, db, runtime)` 与 `app.ts:128` `new TicketService(db, …)` 同 `db` 变量）→ 嵌套走 savepoint、外层抛错全量回滚；事务回调纯同步（无 `async`、无 `await`），放行触发在提交后（`plan.ts:211`）。**实证**：`plan.test.ts:306-318` 注入 `addDependency` 抛错后 `listTickets()` 长度为 0（三张单 + 依赖面零残留），断言强度足够（失败面非「未建」而是「已建后回滚」）。
2. **放行触发与既有流转的等价性** —— `dispatcher.ts:581-608` `tryReleaseChainTicket` 是既有 `onTicketSettled` 判据（TASK + SPEC_READY + 有 parent + 预绑定 worker + 其余依赖全 DONE + system transition + 非 DISPATCHED 不 spawn）的**逐字搬迁**，`onTicketSettled:533-557` 改为「枚举下游 → 调核心」，零行为漂移（既有 dispatcher 27 用例全绿，其中 F1/F4 编排链自动放行与文件冲突落队腿为回归佐证）；新入口 `releaseChainReady:560-575` 以 STORY 为轴枚举子单，同一核心。
3. **校验单源与取值域收敛** —— `plan.ts:59-136` `validatePlan` 被 `routes.ts:320-329`（validate）与 `confirmPlan`（`plan.ts:177`）共用同一实现；`repoRef` 缺省 `ws.primary`、`workerId ∈ registry.has`、`dependsOn ⊆ 计划内 id` + 环、`plannedFiles` 相对路径形态与 S3 尾斜杠语义一致；`25fba72` 后卡片下拉、系统提示 workers 段、服务端校验三处同为「全量注册表」（`PlanCard.tsx:163` / `config-gen.ts:141-186` / `plan.ts:97-103`），且 `workerProfileSchema` 的 `command` 为**全 profile 必填**（`profile.ts:19`）→ 全量域可执行、无「选中即失败」空洞。

## 质量评分

**92 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 0 | -25 | 0 |
| high | 0 | -12 | 0 |
| medium | 0 | -5 | 0 |
| low | 4 | -2 | -8 |

扣分项：问题 1（`MAX_SPEC_BYTES` 双份常量）、2（web `asPlanPayload` 与 zod 对空 `tasks` 口径不一致）、3（impl 文档 3 处残留表述）、4（计划块消息内文本段宽度形态变化），见「发现的问题」。

## fence 结果

Checker 在冻结树（`25fba72`，`git status` 干净）独立复跑：

- `pnpm -F @atd/server test`：**239 用例（18 文件）**，239 通过，0 失败，0 跳过（7.61s）——逐文件要点：`plan.test.ts` **18**（新）、`config-gen.test.ts` **13**（10 → 13，+3 新 describe）、`dispatcher.test.ts` 27、`ticket-service.test.ts` 36、`api-s2b1.test.ts` 11、`state-machine*` 38、其余同基线；**239 = 218（S2b1 基线）+ 21（plan.test 18 + config-gen +3）**，与调度者对账口径一致
- `pnpm -F @atd/worker-core test`：16 用例（2 文件），16 通过（0.45s）
- `pnpm -F @atd/worker-opencode test`：9 用例（1 文件），9 通过（0.37s）
- `pnpm -F @atd/server exec tsc --noEmit` / `@atd/worker-core exec tsc --noEmit` / `@atd/worker-opencode exec tsc --noEmit`：三者静默通过（exit 0）
- `pnpm -F @atd/web build`（`tsc --noEmit && vite build`）：成功（3319 modules；`dist/assets/index-NgsCNyNT.js` **1.373MB** / gzip 430KB，3.37s；chunk 体积告警为存量现象）
- E2E 测试：无（本项目无 E2E 基建，与 S1/S2a/S2w1/S2b1/S3 同口径）
- 合计：**264 用例，264 通过，0 失败，0 跳过**

> 复跑口径：`bash .specpipe/fence.sh` 整体脚本被本会话权限引擎拒绝（`bash` 不在白名单），按其 `:6-12` 条目**分段等价复跑**（三包 tsc + 三包 test + web build）；`:5` 的 `pnpm install --frozen-lockfile` 未跑（依赖树未动：`git diff --stat` 无 `package.json` / `pnpm-lock.yaml`）。
>
> **冒烟（`scripts/smoke-humanthink.sh`）本轮未跑**，理由同 S2b1 r2/r3：非 fence 项，需真 serve + LLM 轮次；且验收 1（助手产出格式遵循度）与验收 8（自验证）本质是**交付后动作**，由调度者在 SMOKE / 自验证阶段把关（见「验收 8」）。

## 七项清单逐项结论

### 1. 实现与 impl 一致性 —— 通过

impl §技术方案 1-7 / D1-D6 / 改动点块 1、块 2 逐条落码核对：

| impl 条目 | 实测落点 | 判定 |
|---|---|---|
| 技术方案 6 产出合同（system 字段 + 动态注入，config-gen 纯函数） | `config-gen.ts:141-186`（`buildAgentSystem`）；`buildServeConfig:189-206` 增第三参 workers，每 agent 写 `{system, permissions}` | ✓（模板含双职责声明/调研先行/业务语言要求/atd-plan 格式范例/七字段说明/repos 段/workers 段） |
| 数据链路补全（r1-h1）：`VisionWorkspace.primary` + `repos.id` + workers 入链路 | `config-gen.ts:19/23`（类型）；`app.ts:225-232`（映射逐字段 `id/path/role` + `primary` + `registry.list()` 三元组） | ✓ 逐字段对应，tsc 全量把关 |
| 技术方案 2 计划块协议 `​```atd-plan` + JSON 字面 | `config-gen.ts:170-175`（范例）；`plan.ts:18-39`（zod）；`ChatMessage.tsx:25`（正则） | ✓ 三处字面一致（story.title/description + tasks[].id/title/spec/repoRef/workerId/dependsOn/plannedFiles） |
| 技术方案 4 校验单源（返回 `issues[{taskId?,field,message}]`，空=通过） | `plan.ts:59-136`；`PlanIssueField` 七值 `plan.ts:45` | ✓ 与 impl「API 契约冻结」节值域逐字一致 |
| 技术方案 5 原子建单（外层事务包 service 调用 / 禁 async / 提交后放行） | `plan.ts:181-211` | ✓ 回调内无 `async`/`await`；放行在事务外（`:211`） |
| 技术方案 6 两层提取（私有核心 + 双枚举入口） | `dispatcher.ts:581-608`（核心）/ `:533-557`（入口①）/ `:560-575`（入口②） | ✓ 与 impl r2 定型一致（D6 命名残留见问题 3） |
| 技术方案 7 跳转 STORY 详情 | `HumanThinkPage.tsx:331-337`（`navigate('/tickets/:id')`）+ `:340-353`（planCtx 稳定化） | ✓ |
| 块 1 routes：`plan/validate` 200 恒定 / `plan/confirm` 200 双态 + 门卫同既有 | `routes.ts:320-329` / `:332-347`（`assertAvailable` → `loadSession` → `assertActive` → `loadSessionWorkspace`） | ✓ 与既有端点同门卫顺序 |
| 块 1 routes/types 契约镜像 4 类型 + 计数勘误 | `routes/types.ts:100/104-105/124-129` | ✓ 四处勘误齐（routes 头/web api 头+括号注/test describe 标题/types 契约段） |
| 块 2 PlanCard 全字段编辑 + 预检标红 + 确认双态 + 只读 | `PlanCard.tsx:86-106`（payload 组装）/`:109-114`（字段定位）/`:168`（disabled）/`:212-240`（两动作） | ✓ |
| 块 2 ChatMessage 提取（失败降级原样文本）+ 流式不提取 | `ChatMessage.tsx:25-102`、`:196-201`（`!streaming && planCtx != null` 才提取） | ✓ |
| 块 2 api 两函数 + types 手抄 | `api/humanthink.ts:135-158`；`api/types.ts:432-478` | ✓（逐字段见「块间契约」节） |

> `25fba72` 的裁决（worker 下拉去 `available` 过滤）**复核接受且判为更正确**：任务执行走 `spawn-cli` 命令模板，`available` 仅表达 interactive 聊天可用性（`profile.ts:99-103`），与任务可执行性无关；服务端 `registry.has` 与系统提示 workers 段同为全量域，三域一致优于「前端单侧收窄」。

### 2. 代码质量（OCR 流水线）—— 通过

规则注入：变更文件后缀 `.ts/.tsx` 覆盖（无专项语言规则文档适用，走事实核查 + 精度优先口径）。逐文件审查结论：

| 文件 | 结论 |
|---|---|
| `humanthink/plan.ts`（新，217 行） | 结构清晰（schema / validate / confirm 三段）；环检测 `reachesBack:145-156` 逐节点 DFS 正确（自依赖 `dependsOn:[self]` 命中：栈首弹出即 `=== start`）；重复 id 不入 `ids` 集故不会经 `localToId` 碰撞；`plannedFiles` 形态校验（`:116-123`/`:139-142`）拒绝绝对路径/`..` 段/反斜杠；无死代码、无「无目的」全量读。**唯一 fact：`MAX_SPEC_BYTES` 与 `ticket-service.ts:125` 各存一份**（问题 1） |
| `humanthink/config-gen.ts` | `buildAgentSystem` 纯函数、空 workers 有兜底文案、按 workspace 隔离（blog 段不含 atd 仓，测试锁定）；`buildAgentRules` 未被触碰（diff 只在其后追加）→ 五规则序列零变化 |
| `humanthink/routes.ts` | 两端点薄壳（parse → 门卫 → 委托），无业务逻辑下沉；`loadSessionWorkspace:122-129` 复用同一 resolve 语义（yaml 漂移 422） |
| `dispatcher.ts` | 纯方法提取，无逻辑改写；`releaseChainReady` 逐票 try/catch（单票失败不阻断，同既有口径） |
| `app.ts` | 映射逐字段显式，无 spread 隐式丢字段 |
| `ChatMessage.tsx` | 正则模块级常量 + `matchAll`（不依赖 `lastIndex`，无状态污染）；`asPlanPayload` 形状防御完备（可选字段类型错即整体降级）；提取不命中时走**与基线逐字相同的 JSX 分支** |
| `PlanCard.tsx`（新，460 行） | 编辑态深拷贝（`mutate` 复制 `dependsOn`，`removeTask` 同步清除悬挂引用，`nextLocalId` 推号含冲突兜底）；`toPayload` 空集省略（`repoRef` trim、`plannedFiles` 按行 trim 去空）；模块级 workers 缓存失败不缓存；无内存泄漏（`useEffect` 有 `alive` 守卫） |
| `api/{humanthink,types}.ts` | 新函数复用 `request()`（200 双态不经错误信封路径正确）；类型手抄含值域注释 |

事实校验：「保存到本地草稿」「后端存计划」等描述均被功能事实依据替换（实际无草稿落库——`plan.ts:8-12` 注释与实现一致）。

### 3. commit 信息 —— 通过

- `ec3c9ab` / `d069429` / `25fba72`：单行中文主题带 conventional 前缀（`feat(server)` / `feat` / `fix(web)`），主题句含「改了什么 + 为什么」，body 为分条要点式（与仓库既有 `fix+docs: S2b1 质量门 r3 PASS 92 收尾——…`、`docs: AGENTS.md 随 S3 交付同步——…` 风格一致）
- `57475f4` merge 主题为标准 `Merge branch …`（与 S3 的英文默认 merge 主题同现象，非本 Story 独立问题）
- 一处**从属痕迹**（非扣分）：`d069429` body 写「workerId=Registry 可用」，该表述已被 `25fba72` 推翻（改全量注册表）；history 本身不可改，且纠偏 commit 已显式说明，仅作观察项记档

### 4. 整体编译 —— 通过

三包 `tsc --noEmit` 静默通过；web `tsc --noEmit && vite build` 成功（见 fence 节）。

### 5. 受影响模块测试（fence）—— 通过

`bash .specpipe/fence.sh` 无法整跑（权限引擎拒 `bash`），按脚本 `:6-12` 分段等价复跑全绿（见 fence 节）。受影响模块 = `@atd/server`（239）+ web build（+ 两包无损复跑）。

### 6. 测试覆盖与回归 —— 通过（逐项抽查）

| 用例面 | 落点 | 抽查结论 |
|---|---|---|
| 原子性零残留 | `plan.test.ts:306-318` | **强度足**：mock 抛错后断言 `listTickets()` 长度 0 + 500 `INTERNAL`；mock 点在「三张单已建、依赖待建」处，真正压到回滚完整性 |
| 排队非失败 | `:320-336` | 预占闸门（`maxConcurrentPerRepo=1`）后根任务 `SPEC_READY + queuedReason='GATE_QUEUED'` + `transitions` 无 DISPATCHED + workerId 保绑——S3 语义衔接被锁定 |
| 跨仓落库 | `:238-272` | `repoRef` 缺省落主仓实际值 `atd`、显式 readable 落 `docs`，parentId/workerId/spec/plannedFiles/依赖边逐字段断言 |
| 多轮隔离 | `:338-358` | 两次 confirm 两个 STORY、同局部 id `t1` 映射不同真实单号、children 归属互斥 |
| 门卫三分 | `:378-412` | degraded 503（两端点各一）+ 已删 422 `SESSION_TERMINATED`（含零建单断言）+ 未知 404；另 body 形态错 400 `VALIDATION` 参数化三例（`:225-234`） |
| 校验单源全规则 | `:136-235` | repoRef 越界（含可选值域文案）/worker 未注册/id 重复与空/标题 spec 空/依赖计划外+重复+2-环+自依赖/plannedFiles 三类非法形态/spec 超 128KB，共 7 例 |
| 放行触发留痕 | `:274-292` | 根任务断言以 **transitions 留痕 + note 字面**为准（不依赖异步 spawn 落定），有依赖任务保持 SPEC_READY——旁路态下断言稳定，是正确取舍 |
| 泳道数据回归 | `:360-374` | HTTP 面 `GET /api/tickets/:story` children 全子单 + 依赖分层 |

回归面：既有 218 用例零改动通过（`api-s2b1.test.ts` 仅 describe 标题勘误与文件头说明）；`dispatcher.test.ts` 27 例覆盖 `onTicketSettled` 改造面；`perm-config.test.ts` 3 例 + `config-gen.test.ts` 既有 10 例覆盖五规则与配置生成未被 `system` 注入破坏。

未覆盖项（已知/可接受）：① `submitSpec` 抛错路径未经注入（与 `addDependency` 抛错同构，回滚面等价，不另计）；② web 无自动化测试基建（项目现状，`splitPlanBlocks`/`asPlanPayload` 以代码核读 + build + 自验证视觉复核为证）；③ 跨仓「真跑通 DONE」端到端属自验证动作（见验收 4）。

### 7. 文档归档与 AGENTS.md —— 部分通过（交付后动作）

- spec v3.1 / impl v2.1 与主仓副本齐备（含 spec r1-r2、impl r1-r2 审查链）✓
- **AGENTS.md 未随 S2b2 更新**：`AGENTS.md:68` 仍写「**9 端点族**」（S2b2 后为 11），且缺编排拆单链语义。按 S2w1/S3/S2b1 先例（AGENTS.md 属交付后动作、**本门不扣分**），**归属=调度者随 PASS 收尾执行**；建议清单见末节「AGENTS.md 建议清单」。

## 块间契约一致性核验（重点维度）

| 面 | 两侧落点 | 逐字段结论 |
|---|---|---|
| `PlanPayload` | server `plan.ts:18-41`（zod infer）↔ web `types.ts:455-459` + `PlanTask:434-453` | 一致（`story.title/description: string`；task `id/title/spec/workerId` 必填，`repoRef?/dependsOn?: string[]/plannedFiles?: string[]` 可选） |
| `PlanIssue` | `plan.ts:45-48` ↔ `types.ts:462-468` | 一致（`taskId?`；`field` 七值 `repoRef|workerId|dependsOn|plannedFiles|id|title|spec` 逐字相同；`message: string`） |
| `PlanValidateResponse` | `routes/types.ts:124` ↔ `types.ts:471-473` | 一致 `{issues: PlanIssue[]}` |
| `PlanConfirmResponse` | `routes/types.ts:127-129` ↔ `types.ts:478` | 一致可辨识联合：`{ok:true, story:{id:number}, tasks:Array<{localId:string,id:number}>}` \| `{ok:false, issues:PlanIssue[]}` |
| 提交载荷字面 | web `PlanCard.tsx:86-106` ↔ server zod | 一致：缺省 `repoRef` 省略（服务端 `?? ws.primary`）；`dependsOn`/`plannedFiles` 空数组**省略不传**（服务端 optional，S3 侧空数组视同未声明，语义同向）；`plannedFiles` 逐行 trim 去空 |
| 端点路径/方法 | `api/humanthink.ts:140/155` ↔ `routes.ts:320/332` | 一致（`POST .../:id/plan/validate|confirm`，`encodeURIComponent(id)`） |
| 镜像源头单点 | `routes/types.ts:104-105` re-export `plan.js` 类型（server 侧非手抄） | ✓ 仅 web 侧为手抄，规避双向漂移 |

> 结论：本 Story 的 S2b1 教训（web 手抄三处漂移）**未重演**；两侧 `tsc` + 逐字段目视比对均一致。

## 验收标准 1-8 与业务规则 1-9 逐条核验

| # | 验收（用户可验证） | 代码面状态 | 说明 |
|---|---|---|---|
| 1 | 产出（调研后给 spec + 计划卡） | ✓ 就绪（端到端属自验证） | 产出合同注入 `config-gen.ts:141-186`（含格式范例与业务语言硬要求）；解析链路 `ChatMessage.tsx:25-102`；格式遵循度只能真机核 |
| 2 | 编辑后确认建单与编辑内容一致 | ✓ | `toPayload` 空集省略与 zod 可选面同向；`removeTask` 清悬挂引用；服务端按提交态建单 |
| 3 | 落单：全成或全不建 | ✓ | 单事务 + savepoint 嵌套 + 中途失败零残留（用例实证） |
| 4 | 自动流转与跨仓 | ✓ 机制就绪（真跑通属自验证） | 根任务放行触发 `plan.ts:211` → `dispatcher.ts:560-575`；跨仓 `repoRef` 落库与 worktree 解析走既有 `resolveRepoPath`（S2w1 跨仓用例佐证） |
| 5 | 泳道 | ✓ | 跳转 `HumanThinkPage.tsx:331-337`；STORY 详情 children/依赖分层有断言 |
| 6 | 多轮各自成链 | ✓ | 用例 `plan.test.ts:338-358` |
| 7 | 无干扰（讨论行为不变；fence 全绿） | ✓ 结构面 | `buildAgentRules` 与 `permissions` 序列零改动；web 提取仅命中合法计划块时改变渲染路径；fence 全绿。**提示词是否影响日常讨论属真机观察项** |
| 8 | 自验证（无头浏览器+视觉解析+真机冒烟） | 交付后动作，**不扣分**；准备就绪 | `scripts/smoke-humanthink.sh` 在位（手动、不进 fence）；本次代码侧未新增阻塞项，且「渲染形态」面留有可核项（问题 4） |

| 规则 | 判定 | 锚点 |
|---|---|---|
| 1 计划块协议（未识别不崩） | ✓ | `ChatMessage.tsx:25`/`:56-74`（JSON/形状失败整块原样文本，`found=false` 时整段走原分支） |
| 2 确认门是唯一建单入口 | ✓ | 全仓仅 `routes.ts:332` 调 `confirmPlan`；计划草稿不落库 |
| 3 原子建单 | ✓ | 见验收 3 |
| 4 校验单源 + 卡上标红 + 阻止确认 | ✓（**「阻止确认」由服务端门实施**，见观察项 O3） | validate/confirm 共用 `validatePlan`；标红 `PlanCard.tsx:109-124`/`:280/330/354/373/389/407/420` |
| 5 冻结语义沿用 | ✓ | `submitSpec(id, spec, plannedFiles ?? null)`；空数组 → NULL（S3 语义） |
| 6 流转语义（建单完成即触发点） | ✓ | `releaseChainReady` 新入口 + S3 排队/闸门照旧 |
| 7 助手行为不变 | ✓ 结构面 | 仅增 `system` 字段；视野五规则与三档行为零改动 |
| 8 确认后会话继续可用 | ✓ | confirm 不写会话状态；两端点不触 session 表 |
| 9 上限不设 + 编辑态不持久 | ✓ | 无硬上限；`useState(() => toEditable(plan))` 本地态，刷新回原稿 |

## 调度者初裁的 7 条偏离 —— 复核裁定

| # | 偏离 | 裁定 | 依据 |
|---|---|---|---|
| 块 1-1 | worker 取值域改**全量注册表**（弃 `available` 过滤） | **接受（更正确）** | `command` 全 profile 必填（`profile.ts:19`）→ 全量域皆可执行；`available` 语义仅 interactive serve 兼容性（`profile.ts:99-103`）；三域（提示/校验/下拉）严格同集合 |
| 块 1-2 | `plannedFiles` 形态校验 **zod 字面内联**（未复用 S3 实现） | **接受（实现层）**，但 impl 措辞不精确（见问题 3） | `file-set.ts` 只提供**匹配**语义（`intersectingPaths`/`intersects`），S3 侧**无形态校验实现可复用**；新校验为净增量且更严（拒绝对路径/`..`/反斜杠） |
| 块 1-3 | 放行断言走 **transitions 留痕** | **接受** | spawn 异步不参与断言是稳定性正确取舍；`:285` 断言 note 字面，防同义反复 |
| 块 2-1 | `Ht` 前缀命名（`validateHtPlan`/`confirmHtPlan`） | **接受** | 与模块既有命名（`getHtSession`/`promptHtSession`/`replyHtPermission`）同族 |
| 块 2-2 | **流式定稿后**才提取计划块 | **接受（spec 风险表已明列）** | fence 未闭合期按普通代码块展示，避免半截 JSON 抖动 |
| 块 2-3 | 编辑即**清空标红** | **接受** | 标红只反映「已提交载荷」的服务端结论，避免陈旧结论误导 |
| 块 2-4 | 校验状态**卡片自持**（未按 impl 措辞「透传」） | **接受（实现更优）**，但 impl 措辞不精确（见问题 3） | 一页多卡各持状态，页侧无需 per-message 状态；回调/上下文仍经 `planCtx` 传递 |

## 发现的问题

### 1. `MAX_SPEC_BYTES` 在两模块各存一份 —— 严重程度：low

- 位置：`humanthink/plan.ts:15`（`const MAX_SPEC_BYTES = 128 * 1024`）与 `domain/ticket-service.ts:125`（同值同义，未 export）
- 影响：预检上限与冻结点上限是两个独立字面量。若后续只改一处（如放宽到 256KB），会出现「预检通过 → confirm 事务内 `submitSpec` 抛 `PROMPT_TOO_LONG` → 500 错误信封（而非卡上字段标红 + 零建单）」，与规则 4「预检与提交单源」的设计意图相悖。当前两值一致，无现实缺陷。
- 建议：`ticket-service.ts` export 该常量（或抽 `domain/limits.ts`），`plan.ts` 引用之；一行级改动。

### 2. web 解析器与 zod 对「空 tasks」口径不一致 —— 严重程度：low

- 位置：`ChatMessage.tsx:28-75`（`asPlanPayload` 只要求 `Array.isArray(tasks)`，**不要求非空**）↔ `plan.ts:38`（`tasks: z.array(...).min(1, '计划至少包含一个任务')`）
- 影响：助手若产出 `tasks: []` 的计划块，卡片可正常渲染为「0 个任务」并允许点「确认建单」；服务端在 **schema 阶段**即 400 `VALIDATION`，前端 `request()` 走错误信封 → **toast 提示**而非字段级标红，与 D2「web 只展示服务端返回的校验结论、按 taskId/field 标红」的体验口径有裂隙（不产生脏数据，也不会误建单）。
- 建议（择一）：`asPlanPayload` 补 `tasks.length === 0 → null`（整块降级为文本）；或卡片对 0 任务禁用「确认建单」并给出本地提示。属可选硬化，非阻塞。

### 3. impl 文档 3 处残留表述 —— 严重程度：low

- 位置与事实：
  - `impl.md:63`（D6）写「两入口（`onTicketSettled`/**`planConfirmed`**）共用」——代码实为 `releaseChainReady(storyId)`，全仓无 `planConfirmed`（grep 0 命中代码）。**此项为 impl 审查 r2 的 low-1，本轮仍未闭合**。
  - `impl.md:15`（技术方案 4）写「plannedFiles 形态……**复用 S3 `file-set` 单一实现，不另起双轨**」——`file-set.ts` 仅提供匹配语义，**无形态校验可复用**；实现为 `plan.ts:139-142` 新增校验（净增量，非双轨，但措辞会让读者误以为存在既有实现）。
  - `impl.md:43`（块 2 文件表）写 HumanThinkPage「**校验状态透传**」——实现为卡片自持（块 2-4 偏离），页侧只传 `planCtx`（会话/只读/回调）。
- 影响：impl 是「技术细节唯一事实源」，命名与机制表述漂移会给后续维护者与下一个 Story 的检索带来误导（无行为面影响）。
- 建议：三处一行级勘误（D6 → `releaseChainReady(storyId)`；技术方案 4 → 「新增相对路径形态校验（S3 仅匹配、无形态校验），尾斜杠语义与 S3 对齐」；块 2 → 「卡片自持校验态；页侧传 planCtx（会话/只读/确认回调）」）。可并入交付收尾同批。

### 4. 计划块消息内「文本段」气泡宽度形态变化 —— 严重程度：low

- 位置：`ChatMessage.tsx:212`（分段视图容器 `width: '88%'`，纵向 flex）vs 基线路径（外层 flex row + 气泡 `maxWidth: '88%'` → **收缩至内容宽**）
- 影响：**仅命中计划块的消息**，其块外伴随文本气泡由「按内容收缩」变为「恒定占满 88% 宽」。计划卡撑满 88% 属预期，但伴随的一两句说明文字也被拉宽，与普通 assistant 气泡观感不一致（渲染层形态差异，无功能影响）。
- 建议：分段视图的**文本段**沿用 `maxWidth: '88%'` + `alignSelf: 'flex-start'`（或对文本段单独包一层仅 `maxWidth` 的容器）；属视觉打磨，可在自验证（无头浏览器 + 视觉解析）阶段一并确认/收敛，不阻塞交付。

## 非扣分观察项

- **O1（承自既有设计）`autoDispatch` 不 gate 编排链自动放行**：`routes/tickets.ts:141` 是唯一 `autoDispatch` 消费点（仅拦「人工放行端点」），而 `onTicketSettled`/`releaseChainReady` → `onDispatched` 无条件下探 spawn。故 `plan.test.ts` 的 `autoDispatch:false` **并不阻止** confirm 后根任务的真实 spawn（`echo run …` 会真起、随后 report 缺失路径推进）。测试断言全部以 transitions 留痕/状态为轴，**不受影响**（本轮 239 例稳定通过）；`plan.test.ts:19` 与 impl「spawn 计数允许 0（旁路态）」的措辞略含歧义，建议后续轮次把该注释改成「spawn 真实发生但其异步推进不参与断言」。属既有框架行为，非本 Story 引入。
- **O2（窄窗）`releaseChainReady` 首段 select 未包 try/catch**：`dispatcher.ts:561-567` 的枚举查询若抛出，`plan.ts:211` 的 `onCommitted` 会把异常带到 confirm → 客户端见 500，而**建单已提交**（重试将重复成链）。触发条件为「同一 SQLite 连接上一条简单 select 失败」，现实概率近零；且逐票放行已包 try/catch（`:568-574`）。建议加固（可选）：`releaseChainReady` 整体 try/catch + `console.error`，使「放行失败面=无」在代码上成立。
- **O3（口径备验）规则 4「阻止确认」由服务端门实施**：卡片不禁用「确认建单」于已知违规态，用户可点击 → 服务端 200 `{ok:false, issues}` → 卡上标红、零建单。净效果是「违规计划永不成单」，且与 D2「校验单源、web 只展示服务端结论」自洽（前端硬禁用会引入前端复制校验逻辑，反与单源冲突）。判为可辩护定型，记档备验。
- **O4（窄窗）确认幂等仅在前端**：重复提交保护 = antd Button `loading`（`PlanCard.tsx:448-456`）+ `confirmed != null` 禁用；服务端无幂等键。浏览器双击面已被覆盖，网络重试/多标签面可重复成链。spec 未要求幂等，记档。
- **O5（窄窗）卡片编辑态不随 `text` 权威替换重置**：`PlanCard` 仅在挂载时 `toEditable(plan)`。若同一消息在重连对账/详情重载后正文被权威文本替换（S2b1 O10 同族窗口），卡片保留旧解析态。当前消息 key 稳定、正常路径「流式期不挂载 → 定稿时挂载」，触发面窄；与 S2b1 处置同口径（观察项，不计分）。
- **O6（cosmetic）空局部 id 的标红定位文案**：`plan.ts:71` 以 `taskId: ''` 上报「任务 id 不能为空」，web 汇总渲染为「 · id：任务 id 不能为空」（前缀空）。不影响定位（字段级仍匹配 `''`），可择机改为省略 taskId（story 级）或补占位文案。
- **O7（cosmetic）分段视图复用**：`ChatMessage.tsx:214-231` 的文本段气泡 style 与基线分支 `:240-262` 重复书写同一组属性，可抽常量；纯重构项。
- **O8（测试硬化，可选）**：`plan.test.ts` 未覆盖 `submitSpec` 抛错路径（现以 `addDependency` 抛错代表）与「根任务放行后 t1 终态」断言（有意为之）；若后续给 confirm 加服务端幂等键，需同步补双提交用例。
- **O9（真机待核）助手产出格式遵循度与「日常讨论行为不变」**：`system` 注入位已由前序审查按 `ConfigAgent.Info.system` + `plugin/agent.ts:102` 行级核实（本报告未再独立取得该源文件，采信链上结论并在自验证阶段复核）。二者只能由 SMOKE / 无头浏览器自验证给出结论 → 属验收 1/7/8 的交付后把关项，不预扣分；建议 SMOKE 至少覆盖「明确要求拆单 → 出块 → 渲染卡片 → 改一处 → 确认 → 落 STORY 且根任务 DISPATCHED」与「纯讨论一轮不出块」两条。

## AGENTS.md 建议清单（归属：调度者随 PASS 收尾执行，本门不扣分）

1. `AGENTS.md:68`「**9 端点族**」勘误为「**11 端点族**（会话族 9 + 计划 validate/confirm 2）」。
2. §二 新增「**编排拆单链（S2b2）**」速查：`atd-plan` 计划块协议（局部短 id / dependsOn 仅限本计划 / repoRef 缺省主仓 / plannedFiles 尾斜杠递归）；确认门=聊天内计划卡（草稿只活在会话文本，服务端不落库，刷新回原稿）；`plan/validate` 200 恒定 + `plan/confirm` **200 双态**（不走 AppError 信封）；**原子建单**=外层 `db.transaction` 包 `service` 调用（嵌套走 savepoint、回调禁 async）+ 提交后同步触发放行；`PlanIssue.field` 七值冻结。
3. §二 依赖与编排链段补「**两个放行入口共用核心**」：`onTicketSettled`（以触发票为轴）/ `releaseChainReady(storyId)`（以 STORY 为轴，建单完成即触发点），核心 `tryReleaseChainTicket`；S3 排队/闸门/重试语义不变。
4. §二 或 §三 补「**产出合同注入**」：`config-gen.buildAgentSystem` 写入 `agents.atd-ht-{ws}.system`（双职责 + 业务语言要求 + repos/workers 动态段，启动期快照）；**worker 取值域三域一致=全量注册表**（`available` 仅聊天会话下拉语义；`command` 全 profile 必填故全量域皆可执行）。
5. §四 手抄契约纪律条补半句：S2b2 新增 `Plan*` 四型手抄面（`api/types.ts` ↔ `routes/types.ts` 镜像），**本 Story 未重演漂移**——继续逐字段比对（含可辨识联合 `ok:true/false` 两支与空数组省略语义）。

## 修复是否引入新问题（快扫 `21d79c8..25fba72` 全 diff）

| 面 | 结论 |
|---|---|
| `buildAgentRules` / 五规则序列 | 未被触碰（diff 于其后追加）→ S2b1 视野面零变化（`perm-config` 3 例 + `config-gen` 既有 10 例绿） |
| `onTicketSettled` 行为 | 逐字搬迁 + 单测回归（27 例）→ 零漂移 |
| 建单既有链路（`createTicket`/`addDependency`/`submitSpec`） | 生产代码零改动，仅被新调用方嵌套使用；嵌套 savepoint 语义由原子性用例实证 |
| 既有端点/契约 | 仅注释计数勘误 + 追加镜像类型 → 无破坏性变更 |
| 纯讨论会话渲染 | `ChatMessage` 在「无 `planCtx` / 流式 / 非 assistant / 无合法块」四态一律走基线分支（逐字相同 JSX）→ 无回归 |
| 新依赖 | 无（`git diff --stat` 无 `package.json`/lockfile） |
| worktree 状态 | 复跑前后 `git status --porcelain` 空 |

## 状态落定

- 审查前实测 `.stage` = `QUALITY_GATE`（与质量门审查前状态一致）→ 本报告结论 **PASS**，落定目标态 **`DONE`**（质量门 PASS → DONE；终检双 PASS 汇合由调度者执行）。
- 若状态机拒绝该边或要求由调度者落定，则转调度者；本报告技术结论不受影响。

## 结论

# PASS

状态：QUALITY_GATE → DONE

一句话理由：S2b2 的双块产出在**原子性**（外层事务 + service 嵌套 savepoint，中途失败零残留有用例实证）、**放行接缝**（既有判据逐字提取 + 双枚举入口，`onTicketSettled` 行为面零漂移）、**校验单源**（validate/confirm 共用同一实现，`field` 值域冻结）、**三域取值域一致**（提示/校验/下拉同为全量注册表，且全量域可执行）四个承重面逐面核过，块间契约（web 手抄 ↔ server 镜像）逐字段一致、验收 2/3/5/6 与规则 1-9 均有代码落点或用例锁定，独立复跑 **239 + 16 + 9 + 三包 tsc + web build 全绿**、复跑前后 worktree 干净；余项 4 条 low（双份上限常量 / 空 tasks 口径裂隙 / impl 文档 3 处残留表述 / 计划块消息文本气泡宽度）均无 medium+、不阻塞用户验收（验收 1/4/8 与助手讨论行为属交付后自验证把关）—— **92/100 PASS**。
