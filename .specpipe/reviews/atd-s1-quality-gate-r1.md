# 质量门审查报告: atd-s1-core-domain (Revision 1)

- 类型：Story 质量门全面审查（S-S10 终检）
- 对象：worktree `/home/starlex/project/AgenticTicketDesk-s1a`，分支 `dev/feat/atd-s1-core-domain` @ `e6670c4`
- commit 链：`e6670c4`（合流收尾）← `42c07e8`（merge 块B）← `98c9c2f`（块A 后端 25 文件）+ `de87992`（块B 前端 19 文件）
- 基准：`.specpipe/plans/atd-s1-core-domain/` 的 `spec.md` v2（A1-A7 唯一验收来源）与 `impl.md` v2（字段级契约 / 测试清单 / 双块并行方案）
- 状态校验：`.stage` = QUALITY_GATE（与任务书一致）；HEAD 分支正确、`git status` 干净
- 日期：2026-09-22

## 总体评价

通过——四项检查全部通过；A1-A7 全锚点落实且断言实质（非形式主义）；Checker 独立复跑 typecheck / 45 用例 / web build 全绿，另做 HTTP 冒烟抽查（3001 直连 + 5173 Vite 代理 + 404 信封）。发现 1 处 medium 与 1 处 low（见问题清单），均不阻塞用户验收。

## 质量评分

93 / 100（critical 0 / high 0 / medium ×1 = -5 / low ×1 = -2）

## fence 结果

- 说明：项目 `{wf}/fence.sh` 仍为 ocp init 模板占位（三条 run_step 均为 TODO 占位命令、未按技术栈改写），无有效围栏脚本可执行；按「项目无 fence 脚本则执行受影响模块测试」执行（以下均为 Checker 独立复跑）：
- typecheck：`@atd/server` tsc --noEmit 零错误
- 单元测试：45 用例，45 通过，0 失败，0 跳过（state-machine 20 / ticket-service 14 / api 11；约 1.0s）
- 根 `pnpm test`（-r 全 workspace）：45/45 通过（web 无测试脚本自动跳过）
- Web 构建：`@atd/web`（tsc --noEmit && vite build）通过，3045 模块产出正常（仅 antd 单包大于 500kB 的常规体积提示，非错误）
- E2E 测试：无（本项目无 E2E 基建，S1 范围内合理）
- 合计：45 用例，45 通过，0 失败
- HTTP 冒烟抽查：3001 直连与 5173 Vite 代理返回一致（列表 `{items}` + camelCase 字段、404 统一信封 `{error:{code,message}}`）；422 双门 / 聚合关单 / 留言 / 时间线 / hasCancelledChildren 由 Oracle 端到端冒烟覆盖
- 备注：3001 端口存在既有 S1 server 实例（含 Oracle 冒烟数据）；用户验收前如需干净环境，请先停止该实例再 `pnpm dev`

## 四项检查逐项结论

### 1. Commit 信息与编译测试验证 —— 通过

- 4 个 commit 语义清晰、中文、内容与 message 一致：
  - `98c9c2f`：块A 25 文件（server 全量 + workspace 骨架 + migration 进仓），自验 45/45；message 分条列出交付面
  - `de87992`：块B 19 文件（apps/web 全量 + README），按 impl §5 约定为文件级交付（编译由收尾统一执行）
  - `42c07e8`：合流 merge commit（apps/web 无冲突并入）
  - `e6670c4`：收尾——copyable.text String() 类型修复（antd 真实验证暴露）+ 全量 lockfile 补齐（含 @atd/web）；body 记录三项验证结论
- 独立可编译：块A 分支自验通过；块B 按 impl §5 方案由 Oracle 收尾统一验证；HEAD 状态经 Checker 独立复跑（typecheck + test + build）全绿
- 中间态说明：`42c07e8` 时 lockfile 尚未含 web 依赖，由 `e6670c4` 补齐——与 impl §5/§7 收尾顺序一致，分支 tip 完整
- 工作区干净（`git status` 无输出），无未提交残留

### 2. 代码质量迭代审查 —— 通过（1 medium + 1 low；规则注入：TS/TSX）

- 架构与 impl 一致性：文件集 / 命名 / 端点 / 字段与 impl §1-§4 逐项对齐；9 端点全实现
- 前端契约一致性（重点核对项）：`apps/web/src/api/types.ts` 手抄与 `apps/server/src/routes/types.ts` 字段级逐项比对——无实质漂移；仅 3 处安全方向差异：Comment.authorType 前端收窄为三值联合（server 为 string）、addDependency 返回 `{ok:boolean}`（server `{ok:true}`）、错误包裹类型命名不同但形状一致
- 同步驱动三铁则：① 事务回调全部纯同步（无 await）② 连接建立即 journal_mode=WAL + foreign_keys=ON ③ text 枚举无 DB CHECK、zod 兜底——全部落实
- 状态机边界完备：六边全量 + 白名单外全拒（含终态无出边）；USE_SPEC_ENDPOINT 前置于白名单、对任意来源态生效（与 impl §3 补注③一致，测试覆盖 4 来源态）；SPEC_READY 唯一入口 submitSpec；门禁/校验失败零写入（A2 断言覆盖）
- 并发安全：better-sqlite3 同步事务 + Node 单线程，每请求事务原子完成，check-then-act 无 TOCTOU 窗口；状态门禁均在事务内读-判-写
- DAG 正确性：禁自依赖 / 禁重复边 / 成环检测（沿 blockedBy 反向可达 DFS）/ 父子约束（父单必须 STORY）——算法与测试双向验证
- 错误处理统一：AppError 到 ERROR_STATUS 映射、zod 到 VALIDATION(400)、框架 4xx 归一、其余 500 INTERNAL；统一信封 `{error:{code,message,details?}}`
- 前端组件质量：TransitionActions 按态渲染（与 server 白名单同步且注释标注同步义务；DRAFT 走 /spec 独立路径；终态无按钮）；SpecCard 冻结/可编辑分支正确；A7 Alert 就位；DependencyPanel 父单标题懒加载 + 自依赖前端预校验；CommentStream 正序 + Enter 发送 + Ctrl/Shift 换行；Timeline 展示 from→to + note + 时间
- 注释规范：中文、仅终态与原因注释，无历史/过程类注释（全文 grep 历史/之前/曾经/改为/撤销/revert 无违规命中）；无 TODO/FIXME 残留（fence.sh 属项目脚手架，非 S1 代码）
- 发现问题见文末清单。

### 3. 测试用例覆盖与回归 —— 通过

- A1-A7 锚点核对（impl §6 三文件）：全数落实，映射如下：
  - A1：state-machine 六边合法转移（status 变更 + transitions 落行）；api.test 全链（STORY + 2 子 TASK 至父单 DONE）；PATCH 成功路径
  - A2：8 组非法转移（422 + status 不变 + transitions 零新增 before/after 计数）；api 422 信封断言（code/message；details 经 A5 链覆盖）
  - A3：留言正序（严格序列断言）；详情 transitions 时间线（含 spec 冻结行与 note）
  - A4：CHILDREN_PENDING details 含未完成子单 id 且不含已完成子单；全 DONE 通过；CANCELLED 子不阻塞 + hasCancelledChildren=true
  - A5：blockedBy 未 DONE 拒 + details 列依赖单；全 DONE 通过；DELETE 依赖后门解除
  - A6：4 来源态 transition 到 SPEC_READY 均 USE_SPEC_ENDPOINT；SPEC_READY 后 PATCH 到 NOT_DRAFT 且字段未变；DRAFT 可编辑
  - A7：两条 CANCELLED 边可用；终态拒一切转移；CANCELLED 子单不阻塞父单关单 + 详情提示锚点（前端 Alert）
- 断言质量抽查（防形式主义）：A2 零新增断言（长度比对）、A4/A5 details 内容断言（含「不含已完成子单」反向断言）、A1 时间线严格序列相等、A6 字段未变断言——均为实质断言
- 回归面：全新工程无存量测试；S1 改动均为新文件（apps/*），无既有功能波及；全量复跑绿
- 数量核对：45 = 20（state-machine）+ 14（ticket-service）+ 11（api），与 Builder / Oracle 报告一致
- 缺口（记录不扣分）：DAG 自依赖/环仅服务层单测（HTTP 层未重复覆盖）；前端无单测基建（按 impl §6 设计）；UI 渲染级复验受本会话无桌面浏览器限制未执行（browser 工具未连接、agent-browser 不在命令白名单）——建议用户验收时点一遍 UI 全链

### 4. 设计文档归档与 AGENTS.md —— 通过（含待办）

- `spec.md` v2 + `impl.md` v2 已归档于 `.specpipe/plans/atd-s1-core-domain/`（项目仓受版本管理）；审查链 spec-r1 / impl-r1 / impl-r2 / 本报告完整可追溯
- impl r2 遗留 4 处 low 核对：全部闭合（契约补注①②③落地且实现一致；DAG_INVALID 合并自依赖/成环；lockfile 收尾补齐；PATCH 成功路径与 DELETE 依赖用例补齐）
- 项目根尚未建 AGENTS.md——作为独立新项目，建议 Oracle 质量门后补最小档（技术栈 / 启动与测试命令 / 目录约定 / S1 关键机制），供 S2a+ 会话加载；非本 Story 交付物，不计分

## 发现的问题

1. **STORY 可带 parentId 建单——spec §3.1「STORY 无父」未落实，决策记录/代码注释/实际行为三方不一致** —— 严重程度：medium
   - 事实：`createTicket`（ticket-service.ts:81-91）仅在 parentId 非空时校验「父单存在且为 STORY」，无「带 parentId 的单必须为 TASK（STORY 不接受 parentId）」校验。Checker 实测（:memory:）：type=STORY + parentId 指向既有 STORY 时建单成功（返回 id=2、type=STORY、parentId=1）。前端 TicketListPage 新建弹窗对 STORY 类型同样始终展示父单选择、不拦截。
   - 对照三方：spec §3.1 表「parentId｜父单（STORY 的子 TASK 挂此）；STORY 无父」；任务书转述 Builder A 自决决策「STORY 不接受 parentId」；代码 jsdoc「parentId 必须指向存在的 STORY，且仅 TASK 可有父」——均指向应拒绝，实际未实现。
   - 影响：可产生 STORY 嵌套（子 STORY），偏离 M1 领域模型；无数据损坏、无 A1-A7 验收影响（单用户本地场景影响低）；S2a+ 聚合/调度语义可能受窄口径影响。
   - 建议：一行修复 + 单测——createTicket 增「parentId 非空且 type 非 TASK 则抛 DAG_INVALID」；补「STORY 带 parentId 到 422」用例；前端对 STORY 隐藏父单选（可选）。若判定接受现状，须同步修正 jsdoc 与决策记录，消除三方矛盾。

2. **未匹配路由返回 Fastify 默认错误体（非统一包裹）** —— 严重程度：low
   - 事实：`GET /api/nope` 返回 `{"message":"Route GET:/api/nope not found","error":"Not Found","statusCode":404}`（实测），与 impl §3「失败 = {error:{code,message,details?}}」不一致；`setErrorHandler` 不承接路由未匹配（需 `setNotFoundHandler`）。
   - 影响：一致性/可发现性问题——前端无未定义路由调用面；S2a worker 等未来消费者拼错 URL 时拿不到带 code 的错误体；已定义端点的 404（资源不存在）均为统一信封。
   - 建议：注册 `app.setNotFoundHandler` 输出统一信封（一行）；或由 Oracle 明确记录为接受项（impl 未要求，不阻塞）。

## 特别核对项结论（任务书预注）

- Builder A 自决决策相容性：① USE_SPEC_ENDPOINT 前置于白名单——相容（impl §3 契约补注③「对任意来源态生效」，测试覆盖 4 来源态）；② blockedBy 严格 DONE——相容（spec §3.3「未 DONE」，CANCELLED 需先删边解除、注释已说明）；③ STORY 不接受 parentId——决策与 spec 相容，但未实现（见问题 1）；④ 其余（类型收窄 STORY/TASK、重复依赖到 DAG_INVALID、删依赖幂等 204、列表 id DESC 二级排序）均与 impl 语义相容
- Builder B types.ts 手抄漂移：无实质漂移（3 处安全方向差异见第 2 项检查）
- 注释规范：合规（中文、终态、无历史/过程类）

## 结论

# PASS

状态：QUALITY_GATE → DONE

一句话理由：A1-A7 全锚点实质落实、独立复跑编译/45 用例/build 全绿、impl r1/r2 遗留全部闭合——仅 1 处 medium（STORY 带 parentId 未拦截，建议一行修复或显式记录）与 1 处 low 收口，不阻塞用户验收。
