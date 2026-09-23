# 质量门审查报告: atd-s2w1-workspace (Revision 1)

> 终检判定：**PASS（96/100）**。四项检查全部通过；2 处 low（merge message / 建单弹窗 workspace 失败态）不阻塞；4 项 Builder 已知发现项经逐项评估均可延期，无 critical/high/medium。

- 类型：Story 质量门全面审查（S-S10 终检 · 首轮 / r1）
- 对象：worktree `/home/starlex/project/AgenticTicketDesk-s2w1`，集成分支 `dev/feat/atd-s2w1-workspace` @ `15ba089`（merge = 144a32b 块 A server + 3a91842 块 B web）；fence 复跑前后 `git status` 均干净
- 基线：main @ `cf7119b`；`git diff cf7119b..15ba089` = 35 文件 +1944/-129（块 A 23 文件 +1537/-93 / 块 B 12 文件 +407/-36，两数与双 Builder 报告逐字一致）
- 事实源：spec v3 / impl v2.1（主仓 `AgenticTicketDesk/.specpipe/plans/atd-s2w1-workspace/` 与交付分支同路径副本同源，均在 cf7119b，主仓工作区干净）
- 状态校验：实测 `.stage` = `IMPL_APPROVED`，与质量门「审查前状态 = `QUALITY_GATE`」**不一致**——按《07-state-machine》§状态规则中止状态写入并提示调度者（同 `atd-s2a-quality-gate-r2` 先例）；本报告不写 `.stage`，落定办法见「状态落定」节
- 日期：2026-09-23

## 总体评价

**通过**。合并态 35 文件逐面核查：workspace 声明式加载（zod 四类校验 + 相对/`~` path + 快速失败）与工单挂载（建单/继承/BLOCKER/依赖/放行复校五处）落实、worktree 去单仓化三调用面全参数化无残留单仓假设、D8 双通道分流正确、`routes` 契约与 impl §3 逐字段对齐（块 B types.ts 同步）、前端 Context 哨兵与失效回退正确、migration/快照/journal 三者一致。Checker 独立复跑 fence 全绿（144/144，四包），S2a 存量适配为纯签名搬运（语义等价）。遗留 2 处 low 与 5 项非扣分观察，均不影响用户验收。

## 质量评分

**96 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 0 | -25 | 0 |
| high | 0 | -12 | 0 |
| medium | 0 | -5 | 0 |
| low | 2 | -2 | -4 |

扣分项：A（merge message 默认英文）、B（建单弹窗 workspace 失败态），见「发现的问题」。

## fence 结果

Checker 独立复跑 `bash .specpipe/fence.sh`（同一 worktree、未改一文件；复跑后 `git status` 复核仍干净，`apps/web/dist/` 为 gitignore 内构建产物）。脚本内含任务书要求的 `pnpm -F @atd/server test` 与 `pnpm -F @atd/web build` 两条命令：

- 安装：`pnpm install --frozen-lockfile` → lockfile up to date（无新增依赖，lock 零改动）
- `tsc --noEmit`：worker-core / worker-opencode / server 三包全过（静默无输出）
- 单元测试：`@atd/worker-core` 7 用例（1 文件），7 通过，0 失败，0 跳过
- 单元测试：`@atd/worker-opencode` 9 用例（1 文件），9 通过，0 失败，0 跳过
- 单元测试：`@atd/server` **128 用例（11 文件）**，128 通过，0 失败，0 跳过（4.73s；含 3 个新增文件 25 用例）
- 前端构建：`tsc --noEmit && vite build` 成功（3062 modules，`dist/assets/index-*.js` 1.16MB / gzip 365KB，2.77s；chunk 体积告警为既有存量现象）
- E2E 测试：无（本项目无 E2E 基建，与 S1/S2a 同口径；真实链路以跨仓真跑用例 + Oracle 冒烟为证）
- 合计：**144 用例，144 通过，0 失败，0 跳过**；脚本末行 `fence: ALL GREEN`

## 四项检查逐项结论

### 1. Commit 信息与编译测试验证 —— 通过（1 处 low）

- 区间 commit 实测 3 个：`15ba089`（merge）+ `144a32b`（server）+ `3a91842`（web）。**任务书称「含两个 merge commit」实测仅 1 个 merge**（两特性 commit 均直接来自 cf7119b，`git log --merges` 与 `%p` 双核）；记录在案，不影响判定。
- `144a32b`：主题简洁中文，正文按交付面分条（atd.yaml 声明/加载校验/migration/挂载与继承/放行四件套/去单仓化/装配/错误码/路由/测试），含四实现决策说明；`3a91842`：同风格，按 impl §3 契约逐条列 web 面。均符合本仓既有风格（对照 S2a 各 commit）。
- **合并完整性双向核验（零丢失）**：`git diff 144a32b..15ba089` 仅 web 12 文件（= `git diff cf7119b..3a91842`）；`git diff 3a91842..15ba089` 仅 server 23 文件 + `workspaces/atd.yaml`（= 块 A 文件集）。merge 无冲突丢弃、无内容漂移。
- 独立可验证：块 A 自报 tsc + 128 用例、块 B 自报 build；合并态由本 fence 复跑覆盖（server test 与 web build 均实测通过，见上节）。
- `15ba089` merge message 为 git 默认英文，见问题 A。

### 2. 代码质量迭代审查 —— 通过（1 处 low）

任务书六关注点逐条：

1. **worktree 参数化无残留单仓假设** —— `WorktreeManager` 仅持 `dataDir`，`allocate/reclaim/assertReady/pathFor/baseline/defaultBranchHead` 全部按调用方传入 `repoPath` 工作（内部据此算 `repoName` 与目录）。全仓 grep 消费点仅三处且全部参数化：`dispatcher.ts:89-104`（allocate/baseline）、`app.ts:96`（guards→assertReady）、`routes/execution.ts:103-111`（reclaim，经 `runtime.workspaces` 解析）。`config.repoPath` 在 src 内零消费（仅 config.ts 自身解析与注释）。目录模板 `{dataDir}/worktrees/{repoName}-t{id}` 与 spec FR-4 验收锚点一致，跨仓真跑用例按 basename 断言。
2. **ticket-service 挂载校验五处完备** —— ①建单 `workspaceId`∈registry（未知→422 WORKSPACE_UNKNOWN，details 列可选集）+`repoRef`∈repos（缺省主仓落实际值；∉→REPO_REF_INVALID details 含可选集；非 TASK→REPO_REF_INVALID）；②继承：parentId 异值→CROSS_WORKSPACE，缺省静默继承且 repoRef 按继承后 workspace 主仓解析；③BLOCKER：`createBlocker` 单点从父单行继承 workspaceId、repoRef 恒 null（dispatcher 不另写字段，符合 D7）；④依赖：`addDependency` 两侧 workspaceId 比对→CROSS_WORKSPACE detail 指明两侧；⑤放行复校：`transition` user 通道 `resolveRepoPath` 失败→422 REPO_REF_DRIFTED（details 含「修正 yaml 重试/裁决终止」修复指引），**复校先于 worktree 前置**（与 impl D4 口径一致，签名 `(id, repoPath)` 强制该序）。
3. **D8 分流正确** —— user 通道在 `transition(actor='user')` 内同步 422（REPO_REF_DRIFTED）；system 通道（`onTicketSettled` 自动放行、裁决改派）跳过复校，由 dispatcher `runOnce` 步 0 `resolveRepoPath == null` → 抛错 → `preSpawnFail`（DISPATCHED→CANCELLED + system 留言，可重派语义）。两条链互不串，且 `reopen` 走 user 通道（复校生效，repoRef 不可变语义保持）。
4. **routes 契约与 impl §3 逐字段对齐** —— 逐字段核验通过：`GET /api/workspaces`→`{workspaces:[{id,name,repos[{id,path,role}],primary,ticketCount}]}`；`GET /api/workspaces/:id`→`{workspace}` / 404；建单 body 两可选字段（zod）；`GET /api/tickets?workspaceId=`（空串 preprocess 视同未传）；TicketVO `workspaceId` 恒有 + `repoRef`（TASK 恒非 null、非 TASK null）；四错误码全部 422（ERROR_STATUS）。块 B `web/src/api/types.ts` 手抄同步一致（Workspace/WorkspaceRepo/WorkspacesResponse/WorkspaceDetailResponse/Ticket/CreateTicketRequest/listTickets 参数），`tickets.ts` 解包 `{workspaces}`/`{workspace}` 包裹。
5. **前端 WorkspaceContext 哨兵与失效回退** —— `'all'` 哨兵 ↔ Context `null` 双向映射，localStorage 读写均 try/catch 降级；AppLayout 索引就绪后对失效 id 自动回退「全部」（effect 收敛不循环）；三页 `load` 以 `workspaceId` 为依赖重建（`useInterval` 以 cbRef 保回调新鲜，切换后轮询取新值）；`RepoRefTag`/`resolveRepoRefLabel` 在索引未就绪或查无 workspace 时保守显示 repoRef 本身（不把跨仓单误判主仓吞标记）；CreateTicketModal 缺省链 Context 所选→atd→列表首项，切 workspace 重置目标仓与父单候选。
6. **注释终态中文无历史演进表述** —— 新增/改动注释全中文，无「撤销/旧口径/替代/r\d」类表述；`S2a/S2w1/S3` 字样属本仓既有溯源标记惯例（对照 `worktree.ts:58`、`StatusTag.tsx:4/45`、`types.ts` 存量注释），不判违规。

其他质量扫描：全仓无 TODO/FIXME/`console.log` 残留（唯一 `console.log` 为 index.ts 启动行）、无 `as any`/`@ts-ignore`/`eslint-disable`；migration（`0002_s2w1.sql`）/schema/`0002_snapshot.json`/`_journal.json` 四者一致（`workspace_id text NOT NULL DEFAULT 'atd'`、`repo_ref text` NULL）。

### 3. 测试用例覆盖与回归 —— 通过

**新增 25 用例（3 个新文件）↔ FR/验收场景映射**（注：任务书口径「新增 24 / 存量 104」实测为「新增 25 / 存量 103」——两口径合计均为 128，系计数差异，非缺陷）：

| 用例（文件 · 名称摘要） | 覆盖 |
|---|---|
| workspaces：合法双仓解析（repos/primary/绝对路径 + 三种 resolve） | FR-1 |
| workspaces：相对 path 基于 repoRoot | FR-1 |
| workspaces：`~` 展开形态 | FR-1 |
| workspaces：path 不存在 → 失败含文件名 | FR-1 / 验收 4 |
| workspaces：双 primary → 失败含文件名 | FR-1 |
| workspaces：repo id 重复 → 失败含文件名 | FR-1 |
| workspaces：workspace id 跨文件重复 → 失败含文件名 | FR-1 |
| workspaces：无目录 → 失败含模板指引 | FR-1 / 验收 4 |
| workspaces：目录为空 → 失败（不兜底合成） | FR-1 / 验收 4 |
| workspaces：非法 id（非 kebab-case）→ 失败含文件名 | FR-1 |
| contract：workspaceId 未知 → 422 WORKSPACE_UNKNOWN（HTTP） | FR-3 |
| contract：缺省 workspace=atd / 缺省 repoRef=主仓落实际值 / 非 TASK null | FR-2 / FR-3 / FR-4 |
| contract：repoRef ∉ repos → 422 REPO_REF_INVALID（details 可选集） | FR-4 |
| contract：repoRef 非 TASK 传入 → 422 REPO_REF_INVALID | FR-4 |
| contract：多仓 workspace 合法 repoRef 落库/缺省主仓 | FR-4 |
| contract：parentId 强制继承（异值 CROSS_WORKSPACE/静默继承/同值放行） | FR-3 |
| contract：addDependency 跨 workspace → 422（detail 两侧） | FR-3 |
| contract：放行复校 422 REPO_REF_DRIFTED 含修复指引（user 通道） | FR-4 |
| contract：BLOCKER 继承 workspaceId、repoRef null（D7） | FR-3 |
| contract：GET /api/workspaces 列表（repos/主仓/计数）+ /:id 详情 + 404 | FR-5 / 验收 1 |
| contract：GET /api/tickets?workspaceId= 过滤（不传=全量、未知=空集） | FR-3 |
| contract：存量归属——旧 schema 库 migrate 后 workspace_id 全 =atd | FR-2 / 验收 1（D3 语义实证） |
| crossrepo：TASK repoRef=B → worktree `{B仓basename}-t{N}`、commit 在 B 分支、主仓无串仓 | 验收 2 |
| crossrepo：缺省 repoRef=主仓，行为与 S2a 等价 | FR-2 / FR-4 |
| crossrepo：同 STORY 跨仓链 Task1@A DONE → Task2@B 自动放行 DONE，两 worktree 独立 | 验收 3 / D8 |

- **S2a 存量适配等价性抽查（任务书指定两文件）**：`worktree.test.ts`（7 用例）与 `dispatcher.test.ts`（13 用例）的 diff 逐行比对——全部为 `allocate/reclaim/pathFor` 补 `repoPath` 实参与 `config.repoPath`→`ctx.repoPath` 同值改写，**无断言语义变化**；`helpers.ts`：`createTestContext` 的 dummy repoPath（`worktreeGuard=skip` 下从不触达）替换为真实临时目录 + fixture workspaces 目录（消除 r1 指出的「声明 path 须存在」隐患）；`createRealContext` 的 `repoPath` 与旧 `config.repoPath` 同为 `makeTempRepo()` 产物，取值等价；`captureError` 仅收窄类型注记（`message` 改可选 + `!`），断言逻辑未变。
- 回归：11 文件 128/128 全绿（含 S2a 全链：状态机/API/编排/dispatcher 真跑），S2a 行为零回归成立。
- 未覆盖项（已知/可接受）：system 链解析失败→preSpawnFail 负例（impl 标注「可选」未写）；FR-4 AGENTS.md 天然加载（机制性零开发，无断言可写）；前端无自动测试基建（项目现状，以 build + Oracle 冒烟为证）。

### 4. 设计文档归档与 AGENTS.md —— 通过（含交付后建议）

- spec v3 / impl v2.1 已在交付分支 `.specpipe/plans/atd-s2w1-workspace/` 与主仓同路径齐备（均 @ cf7119b，主仓工作区干净）；spec r1/r2、impl r1/r2 审查报告在 `.specpipe/reviews/` 双向齐备（主仓 + 分支各一份）。
- **AGENTS.md 需补 workspace 概念（本 Story 未改，属交付后动作，不扣分）** —— 现文 5 处与交付态不符/缺失（§一 `config.yaml` 行仍写 repoPath；§二 仍写「TASK 放行三件套」、worktree 模板无仓维度；全篇无 workspace/repo/repoRef 与四错误码）。具体建议见下节。

## AGENTS.md 更新建议（交付后动作）

1. §一 结构树：`config.yaml` 行改为「dataDir（~/.local/share/atd）/超时/重试（repoPath 已不参与装配）」；新增 `workspaces/atd.yaml # workspace 声明式接入（ATD 自吃兼模板；目录缺失/非法声明=启动失败）`。
2. §二 核心概念：新增 workspace/repo/repoRef 速查（worker×workspace×repo=Task 三元组定位；role=primary/readable；repoRef 建单后不可变）；「TASK 放行三件套」改「四件套（+repoRef 复校：user 通道 422 REPO_REF_DRIFTED / system 链走 preSpawnFail→CANCELLED）」；建单缺省 `workspaceId=atd`、`repoRef=主仓`（落实际值）；父子/依赖边限同 workspace（CROSS_WORKSPACE）；四错误码枚举。
3. §二 Worker spawn：worktree 模板改「`{dataDir}/worktrees/{目标仓basename}-t{id}`，按工单 workspace+repoRef 解析」；补 worker 视角一句——**解单 cwd=目标仓 worktree，目标仓自身 AGENTS.md 随 checkout 天然加载**（ATD 自身 AGENTS.md 仅当 repoRef 指向本仓时生效），跨仓 Story 的 Task 链各仓独立。
4. §二 追加 API 摘要一行：`GET /api/workspaces(/:id)`、列表 `?workspaceId=` 过滤、建单 `workspaceId/repoRef`。
5. 可选顺带：`README.md` 同步（config.yaml 描述 + `workspaces/` 目录）。

## 发现的问题

### A. 集成分支 merge commit 用 git 默认英文主题 —— 严重程度：low

- 事实：`15ba089` = `Merge branch 'dev/feat/atd-s2w1-web' into dev/feat/atd-s2w1-workspace`（git 默认）；同仓先例均为中文描述式 merge——`893e053 合流 S2a 前端块（web UI 增量）`、`3f3edae merge: 同步主仓 spec/impl 实证修订文档…`、`07eca11 merge: S1 核心域骨架合入 main（质量门 93/100，用户已验收）`；用户全局规则要求 commit message 中文。
- 影响：风格不合既有惯例，且该 merge 将随分支进入 main 历史；无功能影响。
- 建议：二选一——① 若追求严格一致，`git commit --amend` 改写该 merge message（分支尚未推远端，改写安全；树内容不变，本报告 fence 结论对树仍成立，但需 Oracle 记录 hash 变更以免与报告锚点错位）；② **推荐**不改历史，在合入 main 的最终 merge 上落规范中文说明（审计链零扰动）。

### B. 建单弹窗 workspace 列表加载失败 → 必填字段不可满足且当次无重试 —— 严重程度：low

- 事实：`CreateTicketModal` 每次打开拉 `listWorkspaces()`，失败走 `setWorkspaces([])`；此时「工作空间」Select `loading={workspaces.length === 0}` 恒转圈，而该字段 `rules.required` 会阻断提交，当次打开内无重试入口（关闭重开可重拉；错误已由 api 层 toast，服务端与其他页面路径不受影响）。
- 影响：`GET /api/workspaces` 瞬时失败（服务重启/网络抖动）期间该弹窗不可用；同源的 `useWorkspaceMap` 失败不重试已由 Builder 声明延期，本项为「必填字段依赖失败态」的补强点。
- 建议：失败态给显式「加载失败，点击重试」，或在数据不可用时将该字段降级为非必填（不传=服务端缺省 atd）。

## 已知发现项评估（Builder 报告 4 项，逐项判定）

| # | 已知发现项 | Checker 判定 |
|---|---|---|
| 1 | 泳道卡 / Dashboard worker 小卡未加 repoRef Tag（后续迭代） | **同意延期**。FR-6 仅要求「详情页/列表行」，四出入口已齐（TicketListPage 列、TicketDetailPage、WorkbenchPage 待处理行、Dashboard item 行——实测 Dashboard 已加，未加的是 `StorySwimlane` 泳道卡，属额外界面）；建议归入后续 UI 迭代，无覆盖缺口 |
| 2 | `useWorkspaceMap` 失败不重试（刷新页面恢复） | **同意延期**。模块缓存 catch 已置 null，下次挂载可重试；本地单用户系统，刷新即恢复；与问题 B 同源，可合并为一条后续 Issue |
| 3 | `config.yaml` repoPath 字段无消费方（后续 Issue 清理） | **同意延期**。清理需同步四处（config.ts 字段 + config.yaml + README + AGENTS.md），宜独立 Issue；保留期无害，代码注释已明示「读取方为零」 |
| 4 | 非 TASK 传 repoRef 归并 REPO_REF_INVALID（message 区分） | **同意现状**。spec FR-4 原文「非法值或非 TASK 单传入 → 422」两态同码；message 已区分（「仅 TASK 可指定 repoRef（当前类型 X）」），非 TASK 场景下「可选集」不适用，不补 details 合理 |

## 非扣分观察项

- **O1** `WorktreeManager.assertReady(repoPath)` 去掉了 impl 书写的 `id` 参数、注册表方法名为 `resolveRepoPath`（impl 写作 `resolveRepo`）——实现自洽且语义更简（id 在实现内确实无用），§3 契约未涉及方法名，不影响交付；建议下次 impl 修订顺带对齐命名。
- **O2** `expandHome` 在 `config.ts` 与 `workspaces.ts` 各存一份（同规则同注释，6 行级重复）——可提为共享工具，非缺陷。
- **O3** web `getWorkspace`（+`WorkspaceDetailResponse`）暂无消费方，系 impl §1 明文要求的契约镜像（服务端 FR-5 齐备），保留合理。
- **O4** 交付锚点提醒：集成分支未推远端（origin 现有 s1-core-domain / s2a-worker-loop / main）；本仓存在冒烟遗留 `atd/t1..t9` 分支与 `~/.local/share/atd` 运行产物（均为运行痕迹，不在 diff 内）——推分支与清理由 Oracle 决策。
- **O5** 任务书称区间含「两个 merge commit」，实测为 1 个（见 §1）；「新增 24 / 存量 104」实测为「新增 25 / 存量 103」（总数 128 一致），均为计数口径差，非缺陷。

## 状态落定

- 实测 `.stage` = `IMPL_APPROVED`；质量门「审查前状态」应为 `QUALITY_GATE`。按《07-state-machine》§状态规则（审查前校验不一致则中止并提示调度者）与 `atd-s2a-quality-gate-r2` 先例，**本报告未写 `.stage`**（技术结论 PASS 成立，不随状态跳变）。
- 处置（调度者）：① `stage_set(topic='atd-s2w1-workspace', to='WORKING', actor='调度者')` → `to='QUALITY_GATE'`（补齐本 Story 编码/递交两步流水，参照 atd-s2a-worker-loop 的历史序列）；② PASS 后按 S2a 先例由调度者 `to='DONE'` 落定（终检双 PASS 后 DONE 归调度者）。

## 结论

# PASS

状态：IMPL_APPROVED（未变更——见「状态落定」；审查前状态与任务书不符，已按规章中止状态写入并提示调度者）

一句话理由：合并态零丢失（双向 diff 核验）、契约逐字段对齐（server zod ↔ impl §3 ↔ web types.ts）、挂载校验五处齐备、worktree 参数化无残留单仓假设、D8 双通道分流正确，Checker 独立复跑 fence 全绿（144/144 + 三包 tsc + web build + frozen install），S2a 存量适配为纯签名搬运（语义等价、128/128 含存量全链）；遗留 2 处 low（merge message 默认英文、建单弹窗失败态）+ 4 项 Builder 已知项经评估均可延期，不阻塞用户验收 —— 96/100 PASS。
