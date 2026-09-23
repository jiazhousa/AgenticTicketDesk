# 审查报告: atd-s2w1-workspace — Impl (Revision 2)

- **类型**：Story Impl 完整审查（S-S8，复审）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2w1-workspace/impl.md`（v2，91 行）
- **基准**：同目录 `spec.md` v3（用户已放行）、`plans/agentic-ticket-desk/epic-spec.md`（§4.6 / §9）；r1 报告 `~/doc/.specpipe/reviews/atd-s2w1-impl-review-r1.md`
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk-s2a`（HEAD @96ac11b，与 r1 同一基线）
- **外部核对方式**：全文重读 v2 并逐条对照代码——`worktree.ts`、`routes/execution.ts`、`app.ts`、`index.ts`、`dispatcher.ts`（runOnce/preSpawnFail/resolveBlocker/onTicketSettled/reopen）、`domain/ticket-service.ts`（createTicket/transition/createBlocker/addDependency）、`domain/errors.ts`、`routes/types.ts`、`routes/tickets.ts`、`config.ts`、`db/schema.ts`、`db/client.ts`、`drizzle/0001_s2a.sql` + `meta/_journal.json`、`test/helpers.ts`、`test/{worktree,dispatcher,api-s2a}.test.ts`、`tsconfig.json`、`.gitignore`、`config.yaml`、`apps/web/src/api/*`
- **状态校验**：`stage_get('atd-s2w1-workspace')` 返回 **IMPL_REVIEWING**（r1 时未建档，现已建档）；按任务书约定本轮不更新 `.stage`，落定由调度者执行
- **落盘说明**：报告先落 `~/doc/.specpipe/reviews/`（session 外路径不在 checker 白名单），由 Oracle 复制至仓内 `.specpipe/reviews/`
- **日期**：2026-09-24

## 总体评价

**通过**——r1 的 1 high + 4 medium + 5 low 全部实质闭合（L10 部分：Epic §4.6 已改，§9③/spec FR-3 残留见问题 3）；逐条修订与真实代码对得上，未引入新的 high/medium；残余 3 项 low 均为一句话级或上游文本级，不阻塞编码起步。

关键验证结论：

| 项 | 结论 |
|---|---|
| H1 worktree 调用面 | ✅ 闭合——`routes/execution.ts` 入表（L28，reclaim 经 `runtime.workspaces` 解析仓路径）、`pathFor(ticketId, repoPath)` 入参数化清单（L22）、D1 改为「调用方三处」（L77） |
| M2 装配/注入面 | ✅ 闭合——app.ts 行（AppRuntime/DispatcherDeps/RuntimeOptions +workspaces、装配顺序，L24）、index.ts 行（loadWorkspaces 入口，L25）、D2 重写（必选注入/统一 fixture/config.repoPath 不参与装配，L78） |
| M3 fixture 与「原样跑」 | ✅ 闭合——helpers 改造段 + 明确 worktree/dispatcher 测试须适配 +「适配后语义等价」（L42） |
| M4 D3 矛盾 | ✅ 核心闭合——schema/migration/D3 三处统一 NOT NULL DEFAULT 'atd'（L18/L19/L79），去 UPDATE，测试 5 改 ADD COLUMN DEFAULT 语义断言（L48）；「日志留痕」残留见问题 1 |
| M5 契约三处 | ✅ 闭合——path=解析后绝对路径（L62）、repoRef 缺省落实际值/非 TASK null（L69）、`:id` 包裹 `{ workspace }`（L66）、错误码入契约（L72） |
| L6/L7/L8/L9 | ✅ 闭合——errors.ts 入表 + 4 枚举（L26）、routes/types.ts 入表（L27）、D8 分流 + 测试 4 构造法（L84/L47）、D7 收口 createBlocker 单点（L83 + L20⑥ + L23②） |
| L10 Epic 残留 | ⚠ 部分——§4.6:122 已改 ✅；Epic §9:192③「合成 default workspace」与 spec.md:37「缺省=default」仍残留（问题 3） |

## 质量评分

**94 / 100**（critical 0 / high 0 / medium 0 / low ×3 = −6）

## r1 问题清单闭合核验（逐项对代码）

| r1 项 | r1 要点 | v2 落点 | 代码核对 | 判定 |
|---|---|---|---|---|
| H1 | reclaim 生产调用方未覆盖 + pathFor 未参数化 + D1 陈述错 | L28 + L22 + L77 | `routes/execution.ts:102` 确为 `reclaim` 唯一生产调用方（全仓 `worktree.` 调用面：dispatcher.ts:86/89、app.ts:83/87、execution.ts:102）；`pathFor` 测试调用点 worktree.test.ts:84/94、dispatcher.test.ts:81/172/298 将随适配收口 | ✅ |
| M2 | 装配/注入面未定义（index.ts 缺失、四通道未写、repoPath 交互未定） | L24 + L25 + L78 | `app.ts:16-35/79-98`（AppRuntime/RuntimeOptions/buildServer 装配点）、`index.ts:7-14`（repoRoot 可得，与 loadConfig/loadRegistry 同款先例） | ✅ |
| M3 | fixture 构造未明 +「原样跑」不实 | L42 + L48/L49 | `tsconfig.json:6` include test → worktree.test.ts:22/26/51/64/96/110（`config.repoPath`）+ allocate/reclaim/pathFor 与 dispatcher.test.ts:81/172/298 编译期必暴露；helpers.ts:44/114 两个 buildServer 调用确无 workspaces 注入点 | ✅ |
| M4 | D3 与 §1/测试 5 矛盾 + 永假 UPDATE + 元数据 + 日志留痕 | L18 + L19 + L79 + L48 | `0001_s2a.sql:22-23`（`ADD COLUMN ... DEFAULT 0 NOT NULL` 先例）证实 ADD COLUMN DEFAULT 语义可行 | ✅（④见问题 1） |
| M5 | 契约三处未冻结 | L62 + L66 + L69 + L72 | 前端手抄参照 `apps/web/src/api/types.ts`（注释「手抄同步自 apps/server/src/routes/types.ts」） | ✅ |
| L6 | 新错误码未枚举 | L26 | `errors.ts:2-35` 封闭 union + ERROR_STATUS 全量 Record（tsc 强制同步）；4 码与 L20/L28/L45-49/L72 引用一致，无悬空码 | ✅ |
| L7 | routes/types.ts 未入表 | L27 | `routes/types.ts:12-17` 为契约镜像源 | ✅ |
| L8 | 复校通道口径 + 测试构造法 | L84 + L47 | 现有三件套在 `ticket-service.ts:412-421`（`actor === 'user'` 分支）；system 通道 dispatcher.ts:438/367 不跑 guards | ✅ |
| L9 | BLOCKER 继承归属含糊 | L83 + L20⑥ + L23② | `createBlocker`（ticket-service.ts:469）事务内已读父单行（:471），单点收口可直接取 `parent.workspaceId`；dispatcher 两调用点（:273/282）无需改 | ✅ |
| L10 | Epic/spec 文本残留 | epic-spec §4.6 已改 | §4.6:122 现为「存量工单经 migration DEFAULT 归属 atd；无 workspaces/ 目录=启动失败」✅；§9:192③ 与 spec.md:37 仍残留 | ⚠ 部分 |

## 修订引入问题的专项核查（任务书三关注点）

**1）D2 必选注入对 helpers 的影响** — 影响面已覆盖，残余三小点见观测 1。
- `createTestContext`（helpers.ts:35-59）与 `createRealContext`（:94-134）均无 workspaces 注入点，v2 L42 已定「构造 fixture workspaces 目录 → loadWorkspaces 加载 → 注入」方向，与 D2「不存在无 registry 分支」一致。
- tsc 强制暴露的适配面（tsconfig include test）：`config.repoPath` 转 optional 后 worktree.test.ts 六处 `git(config.repoPath…)` 类型报错 + 签名变更（allocate ×7 / reclaim ×2 / pathFor ×2）+ dispatcher.test.ts pathFor ×3 —— v2 L42 已如实声明「不是原样跑，是适配后语义等价」，不再误导。
- 断言取法：worktree.test.ts:84/94 的 `pathFor` 断言在参数化后与测试 6 的 `{B仓basename}-t{N}` 同源（`path.basename(repo)`），无新增不确定性。

**2）D8 分流逻辑** — 与既有代码语义一致，成立。
- dispatcher.ts:86（allocate 唯一 spawn 前 worktree 触达点）→ 解析失败抛错 → :177-187 catch → :290-312 `preSpawnFail`（DISPATCHED→CANCELLED / IN_PROGRESS→FAILED），与 D8「system 链解析失败走既有 preSpawnFail→CANCELLED（可重派语义保留）」逐句吻合（:159-160 注释「可重新放行」同义）。
- user 通道 422 落点正确：`transition()`（:412-421）在 `actor === 'user'` 内做四件套，POST /transition 与 reopen（dispatcher.ts:399，actor user）共用该分支 → yaml 漂移后重开同样 422 REPO_REF_DRIFTED，「人工修正 yaml 后重试」闭环；改派裁决（:367）与自动放行（:438）均为 system，按 D8 不复校 ✅。
- 无新副作用：system 通道不放行则不进 DISPATCHED，preSpawnFail 的 CANCELLED 是终态但可 reopen（D8 的修复路径自洽）。

**3）execution.ts 的 422 兜底** — 通道成立，行为后果已记录（观测 3）。
- reclaim 确需 repoPath：`worktree.ts:123-145` 的 `worktree remove/prune` 与 `branch -D` 全部在目标仓 refs/元数据内执行，非主仓单必须解析到本仓，否则静默错仓（r1 H1 的场景）——v2 L28 的解析 + 422 兜底方案正确。
- 正向核验：存量单 `repo_ref` 为 NULL（migration ADD COLUMN NULL）→ `resolveRepo(ws, null)` 回退主仓 → 存量 reclaim/reopen 路径不炸；存量 worktree 目录名兼容（旧 `config.repoPath: .` → repoRoot，与 atd.yaml `path: .` → repoRoot 同 basename，目录不漂移）✅。
- 唯一保留意见：yaml 删除后该 workspace 的存量 worktree 无法再经 API 回收（观测 3 建议在 message 里写明手工清理路径）。

## 发现的问题

1. **FR-2 机制偏离（迁移 DEFAULT 替代「一条 UPDATE + 日志留痕」）未在 D3 显式声明豁免** — 严重程度：low
   - 位置：impl L19/L79 vs `spec.md:32`
   - 影响：spec 是用户放行件，机制口径落差（无 UPDATE、无日志）无显式说明，用户审计需自行对照；功能层面无风险（「幂等归属 atd」需求已达成，r1 已判定非 SPEC_OVERTURN）。
   - 建议：D3 补一句「以 `ADD COLUMN … NOT NULL DEFAULT 'atd'` 达成幂等归属；原『UPDATE + 日志留痕』机制不再需要，留痕豁免请用户确认」；若需保留留痕语义，可加一条启动 info（含受影响行数），成本一行；spec FR-2 括注由 Oracle 同步。

2. **workspaces.ts 行未写明 repo path 解析基准与 `~` 展开（FR-1 明示特性），测试 1 未覆盖** — 严重程度：low
   - 位置：impl L16 vs `spec.md:27`
   - 影响：Builder 若只做相对解析，`path: ~/xxx` 声明会在启动期以「path 不存在」失败（可见失败非静默），但 spec 特性存在静默缺失面。
   - 建议：L16 补「path 解析：相对 `loadWorkspaces` 入参（repoRoot）解析；`~` 展开复用 config.ts 的 `expandHome`」；测试 1 加一例即可。

3. **上游文本残留未清：Epic §9③ 与 spec FR-3「缺省=default」** — 严重程度：low（Oracle 侧，不阻塞编码）
   - 位置：`epic-spec.md:192`③、`spec.md:37`；对照 `epic-spec.md:122`（§4.6 已按新口径修订）
   - 影响：S2b1/后续 Story 若按 Epic §9 旧文理解（「合成 default workspace」）会与 spec v3/impl 口径背离；spec FR-3「缺省=default」与同文件 FR-6「缺省=atd」自相矛盾。
   - 建议：Oracle 修订 Epic §9③ 为「无 workspaces/ 目录=启动失败提示初始化」、spec FR-3「缺省=default」→「缺省=atd」。

## 观测（不计分，供 Builder/Oracle 参考）

1. **装配残余三小点（tsc 强制暴露、方向唯一，未写入 v2）**：① `app.ts:47` `new TicketService(db)` 兜底分支——D2 必选注入后需同步（或令 buildApp 的 runtime 必选，仅 buildServer 一个调用方）；② `app.ts:83` `new WorktreeManager(opts.config.repoPath, …)`——repoPath 转 optional 后须改为 dataDir 派生（L22「内部按 repoPath 计算 repoName」已暗示结论）；③ fixture atd.yaml 指向的 dummy 目录须存在（helpers.ts:39 目前仅声明路径、未 mkdir；L42 未写，load 期「path 存在」校验会当场暴露）。
2. `loadWorkspaces` 入参语义建议统一：index.ts 行写 `loadWorkspaces(repoRoot)`，workspaces.ts 行写「加载 workspaces/*.yaml」（目录语义）——二选一写明（函数内拼接 or 传 dir），避免 helpers 侧理解分叉。
3. 测试面低成本增值：测试 6 顺带断言 reclaim（B 仓分支删除/目录消失，覆盖 L28 新通道的跨仓场景，现有 reclaim 路由用例仅单仓）；测试 5 两段式构造法建议写明（`createDatabase` 的 MIGRATIONS_FOLDER 为模块常量，需自建 `migrate(db,{migrationsFolder: 临时目录})`：先 0000+0001 建库插行 → 再正式目录 migrate）；测试 1 可加 `~` 用例（承问题 2）。
4. reclaim 422 文案与场景：STORY 终态单（无 repoRef）走同一错误码；已删 workspace 的存量 worktree 将无法经 API 回收（需恢复 yaml 或手工 rm dataDir/worktrees/{repoName}-t{id}）——建议 message 附带手工清理路径；「裁决终止」措辞对 reopen/reclaim 场景不适用，建议按场景分文案。
5. `GET /api/workspaces` 逐 workspace 取 ticketCount 注意 N+1（r1 观测 4 延续；本地规模可接受，建议一条 group by 查询）。
6. migration 元数据：L19「drizzle meta/_journal 同步」方向正确，建议注明 `drizzle-kit generate --name s2w1`（防随机 tag，S2a 同款教训）。
7. impl L22 ① 括注「dispatcher（allocate/assertReady）」与事实略偏（`assertReady` 经 app.ts:87 guards 闭包装配、由 ticket-service.ts:420 调用；dispatcher 只用 allocate/baseline）——D1 L77 已正确拆分，建议同步措辞，不影响实现选择。
8. 正向：D4 未明写「repoRef 复校先于 worktree 构造」，但 `(id, repoPath)` 签名 + service 内复校的写法实际强制该顺序，与 r1 D4 建议一致；`workspaces/atd.yaml` 不在 `.gitignore` 排除范围（已核），仓内自带无遗漏。

## 结论

# PASS

状态：IMPL_REVIEWING → IMPL_APPROVED（预期；本次任务书明确不碰 `.stage`，落定由调度者执行）

一句话理由：r1 的 1 high（reclaim 调用面/pathFor/D1）与 4 medium（装配通道、fixture 与适配面、D3 口径、契约冻结）已逐条闭合且与真实代码对得上，L6-L9 全闭合、L10 部分闭合；修订未引入新 high/medium，残余 3 项 low（FR-2 机制偏离声明、path 解析规则、上游文本残留）均为一句话级/上游侧，可随编码并行处理，不构成编码阻塞。

> 注：仅审文档与既有代码，未修改任何代码，未触碰 `.stage`；本报告由 Oracle 复制至仓内 `.specpipe/reviews/`。
