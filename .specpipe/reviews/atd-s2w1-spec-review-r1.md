# 审查报告: atd-s2w1-workspace spec (Revision 1)

- **审查类型**：Spec 轻量审查（S-S5 维度）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2w1-workspace/spec.md`（v1/v1.1，80 行）
- **上位基准**：Epic §4.6 Workspace / §9 路线图 S2w1（验收三条款）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk-s2a`（config.ts / worktree.ts / schema.ts / ticket-service.ts / dispatcher.ts / index.ts / web 三页 + CreateTicketModal）
- **日期**：2026-09-23

## 总体评价

[不通过]

范围与架构方向正确：Workspace 一等实体、声明式 yaml、repoRef 逐仓指向、default 合成零迁移，与 Epic §4.6 概念模型逐项对齐；epic 验收三条款均有 FR 与验收场景承接；不做清单未误伤 S2b1/S2b2 地基（可读范围注入留 S2b1、知识库留 S4、跨仓 DAG ≠ 跨 workspace 不冲突）。但存在 **2 处用户可见语义空洞**（default workspace 归属解析未闭合、TASK 的 workspace 归属传播未定义），会直接导致 impl 期猜测实现或验收场景构造歧义，需 rev2 补齐后再放行。

## 分数

**80 / 100**（100 − 2×medium5 − 5×low2）

必改项：M-1、M-2；L-1~L-5 为建议项（可随 rev2 一并处理）。

## 发现的问题

### M-1（medium）default workspace 归属语义未闭合 — FR-2 / FR-5 / 验收场景 1

- **位置**：FR-2 第 2 条、FR-5、§6 验收场景 1
- **描述**：
  1. FR-1 的校验规则（path 存在 / primary 恰一个 / repo id 内唯一 / workspace id 全局唯一）**不要求**声明集合中存在 `id=default`；而 FR-2 的「自动合成 default」按字面**仅在 workspaces/ 目录缺失或为空时**触发。于是「目录存在、声明了两个 workspace 且均非 id=default」这一合法配置下，`workspaceId=NULL` 的存量工单**没有任何归属载体**——与「NULL 语义=default workspace」直接矛盾。
  2. 验收场景 1 的写法正是这一形态：「default-atd 自吃 + 双仓测试 workspace」——`default-atd` 是否为 `id=default` 无法从 spec 判定；若不是，该场景自身就踩中上述空洞（场景 4 删目录后依赖合成 default，两场景口径断裂）。
  3. FR-5 未定义「缺省 workspace」在响应中的标识字段（前端切换器「缺省」标签与默认选中项要依赖它，FR-6 只给了展示文案）。
- **影响**：存量工单归属解析在常见配置下未定义；前端缺省选择无 API 契约；后续质量门无法判定场景 1/4 的归属断言。
- **建议**：补一条显式的 default 解析规则（推荐二选一：① 合成 default **恒注册为兜底**，仅当显式声明 `id=default` 时被覆盖；② 启动校验要求声明集合必须含 `id=default`，否则启动失败）。FR-5 响应增加 `isDefault` 标识或顶层 `defaultWorkspaceId` 字段；验收场景 1 写明两个 workspace 的 id 字面值。

### M-2（medium）TASK 的 workspace 归属传播规则未定义 — FR-3 / FR-6 / §5

- **位置**：FR-3、FR-6、§5 末条
- **描述**：FR-3 仅规定「建单可选 workspaceId，缺省=default」。以下四处行为全部未定义：
  1. 带 `parentId` 的 TASK 是否继承父单（STORY）的 workspace？父单在 workspace X 而显式传入 workspaceId=Y 时是否拒绝？（BLOCKER 已明确继承父单，TASK 未提，形成不对称）
  2. 前端切换器处于「全部」视图时建单，workspaceId 缺省取什么（无法沿用「当前选择」）？FR-6 只描述了 TASK 目标仓下拉取「所属 workspace 的 repos」，而「所属」在「全部」视图下无所指。
  3. CreateTicketModal 的父单候选（`listTickets({type:'STORY'})`）是否随所选 workspace 过滤？不过滤则把 TASK 挂到别的 workspace 的 STORY 上（叠加第 1 点的未定义）。
  4. §5「跨 workspace 的 Task 依赖（DAG 边限同 workspace）」只覆盖 `blockedBy` 边，`parentId` 边是否同受约束未说；且该行为写在「不做」清单而非 FR，无错误码/触发时机约定。
- **影响**：验收场景 3「同 workspace 建 STORY + 跨仓 Task 链」的构造方式无定论（每个子单是否必须显式传 workspaceId？）；若不继承，切换器过滤视图会出现「父单可见、子单失踪」的割裂展示；跨 workspace 父子边若被放行，与 DAG 限同 workspace 的约束自相矛盾。
- **建议**：明确（推荐口径）：带 parentId 时 `workspaceId` 缺省继承父单、显式不一致时 422；顶层建单缺省取切换器当前选择，「全部」视图缺省 default 并在弹窗内显示 workspace；父单候选列表随 workspace 过滤（纳入 FR-6）；把「跨 workspace 边拒绝」从 §5 提升为 FR（明确覆盖 blockedBy 与 parentId 两类边 + 错误码 + 校验时机=建单/建依赖时）。

### L-1（low）「分支/日志按仓隔离」口径与 Epic 验收②字面表述需对齐 — FR-4

- **位置**：FR-4 第 3 条 vs Epic §9 S2w1 验收②
- **描述**：Epic 写作「worktree 建在该仓、分支/日志按仓隔离」；spec 保留 `atd/t{id}`、`t{id}.r{round}.*` 命名不变，worktree 跨仓分目录但**日志/prompt 落在 dataDir 单一平面目录**，仅靠 ticket id 全局唯一保证不冲突，并非字面「按仓隔离」。分支侧隔离成立（分支建在目标仓 refs），日志侧是「单号唯一性兜底」。
- **建议**：补一句口径说明（隔离性由全局唯一单号保证，不另设按仓日志目录），避免后续质量门按 Epic 字面判定不符；若要求物理分区则升级为 FR。

### L-2（low）验收场景 3 缺「预绑定 worker」前提 — §6 场景 3

- **位置**：§6 场景 3
- **描述**：编排链自动放行在现实现中是硬条件——`dispatcher.onTicketSettled` 仅对「有 parent 且 **已绑定 workerId** 且状态 SPEC_READY 且其余依赖全 DONE」的下游 TASK 自动放行；未预绑定则保持 SPEC_READY 等待人工放行。场景 3 未说明 Task2 需带 workerId，照字面构造会「不自动放行」而被误判为功能缺陷。
- **建议**：场景 3 补注「建单即预绑定 worker（放行四件套照常校验）」或直接在场景正文写明携带 workerId。

### L-3（low）入参契约补全 — FR-1 / FR-3 / FR-4 / FR-5

- **位置**：FR-1 path 措辞、FR-3、FR-4、FR-5
- **描述**：
  1. FR-1「path 相对仓根」的「仓根」有歧义（ATD 仓根 vs 目标仓自身）；对照 config.ts 现状（相对路径以 repoRoot=ATD 仓根为基准）宜写死。
  2. 建单传未知 `workspaceId` 的行为未定义（对照现有错误码风格应 422 并指明可选集）。
  3. `repoRef` 传于非 TASK 类型（STORY/BLOCKER 建单）时的行为未定义（拒绝 or 忽略）。
  4. `GET /api/workspaces/:id` 未知 id 未定义（404？）。
- **建议**：四条各补一行契约，与既有 AppError 码风格（VALIDATION/DAG_INVALID 等）对齐。

### L-4（low）实现细节前置 — FR-2 / FR-4

- **位置**：FR-2 第 2 条、FR-4 第 3 条
- **描述**：`DB 侧 workspaceId 列`（列名）、worktree 路径模板 `{dataDir}/worktrees/{repoName}-t{id}`、分支/日志命名规则属实现层表述，与「spec=需求具现，技术下沉 impl」的方法论有张力。理解为验收断言锚点（场景 2/4 需断言路径形态）可接受，但应显式标注理由。
- **建议**：在 FR-4 该条加一句「命名沿用 S2a 约定，作为跨 Story 验收锚点保留」；否则下沉 impl。

### L-5（low）repoRef 悬空后的兜底缺失 — FR-2 / FR-4

- **位置**：FR-2 第 3 条（repoRef 不可变）+ FR-4 放行复校
- **描述**：yaml 变更（删除/重命名 repo id）后，在途工单的 repoRef 会命中「repoRef 仓存在且 ∈workspace」复校而**永久不可放行**，且 repoRef 不可变导致无修复通道（除手改 DB）。spec 未提兜底。
- **建议**：补一句运维兜底说明（改回 yaml 即恢复；或限 DRAFT 期允许清空 repoRef 回落主仓）。

## 核查通过项（供 Oracle 参考，不计分）

1. **Epic §4.6 一致性**：primary/readable 语义、repos 即白名单、default 合成零迁移、TASK 缺省主仓、readable 仓亦可为 TASK 目标 —— 逐项对齐；知识库挂载点留 S4、可读范围注入留 S2b1，未越界。
2. **BLOCKER 继承父单 workspace**：FR-3 明确（对应 dispatcher.createBlocker 路径，可行）。
3. **编排链自动放行跨仓**：FR-4 明确「与仓无关」；核对 dispatcher.onTicketSettled / recoverOnStartup / reopen / resolveBlocker 均按单定位，无仓耦合，仅需 repoRef 解析（见下方观察）。
4. **可实现性留白**（非缺陷，提示 impl 切分）：WorktreeManager 现为构造期单仓绑定（worktree.ts:24-29；app.ts:83 单例装配），FR-4 的执行链要求按目标仓解析——impl 需按仓实例化/参数化，并让放行四件套 guards（`assertWorktreeReady(ticketId)`）内部经工单行解析 repoRef；装配顺序上 workspaces 需在 guards 构造前加载。spec 需求侧表述已足够，留白可接受。
5. **验收场景覆盖度**：Epic 三条款 → 场景 1/2/5（多 workspace 声明+切换+互不串仓）、场景 2（非主仓 repoRef 落对应仓）、场景 4（零迁移 + S2a 套件回归）；场景 5 覆盖「两页一表」——与现有实现事实一致（工作台/仪表盘/列表三页均走 `listTickets`，单端点加 workspaceId 过滤即全覆盖）。
6. **不做清单未误伤后续地基**：S2b1 的实例权限注入、S2b2 的跨仓拆单（跨仓 ≠ 跨 workspace）均不被 §5 限制；仅需保持「Story 与其 Task 同 workspace」的口径自洽（与 M-2 的修复方向一致）。

## 结论

# REJECT

状态：SPEC_DRAFT → SPEC_DRAFT（rev2 待修订；M-1/M-2 为必改项，rev2 修订后可快速复审）

> 注：仅审文档未触碰任何业务代码；`.stage` 由调度者管理，本报告未更新状态机。
