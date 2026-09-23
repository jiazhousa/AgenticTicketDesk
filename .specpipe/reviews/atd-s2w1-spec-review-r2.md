# 审查报告: atd-s2w1-workspace spec (Revision 2)

- **审查类型**：Spec 轻量审查（r1 REJECT 后修订闭合复审）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2w1-workspace/spec.md`（82 行；头部仍标 v1，见问题 1）
- **上位基准**：Epic §4.6 Workspace / §9 路线图 S2w1；r1 报告 `atd-s2w1-spec-review-r1.md`（REJECT 80）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk-s2a`（只读：`config.ts` / `errors.ts` / `worktree.ts` / `ticket-service.ts` / `dispatcher.ts` / `routes/tickets.ts` / web `CreateTicketModal.tsx` / `TicketListPage.tsx`）
- **日期**：2026-09-23

## 总体评价

[通过]

r1 的 2 项必改（M-1、M-2）与 5 项建议（L-1~L-5）**全部闭合**，且修订文本与 S2a 实现事实逐项相符；修订未引入新的语义矛盾（复核 FR-1↔FR-2 整合读法、FR-3 继承链与既有 parentId 唯一形态、FR-4 四件套与既有三件套测试的兼容性，均自洽）。剩余 2 项 low 属文档级瑕疵（版本标记未随修订更新、列表筛选器与顶栏切换器交互一句未定），不阻塞进入 SPEC_USER_AUDIT。

## 分数

**96 / 100**（100 − 2×low2）

## r1 问题闭合核验（逐项，附 spec 行号与实现证据）

| 项 | r1 问题 | 修订位置 | 判定 | 核验依据 |
|---|---|---|---|---|
| **M-1** | default workspace 归属语义未闭合 | 行 29（FR-1「default 恒注册兜底：显式声明者为准，否则合成，与目录是否存在无关」）+ 行 34（FR-2「NULL 语义=default，合成或显式声明者皆可承载」）+ 行 50（FR-5 isDefault）+ 行 78（场景 1 明确「id=default 显式声明」） | ✅ **闭合** | 「目录存在但未声明 id=default」的空洞配置被"恒注册兜底"覆盖，NULL 存量工单在任意合法配置下均有唯一归属载体；场景 1（显式声明）与场景 4（删目录合成）口径一致、无断裂；FR-5 补上 isDefault 后前端缺省选择有 API 契约 |
| **M-2** | TASK 归属传播未定义 | 行 39（parentId TASK 强制继承、异值 422；BLOCKER 自动继承）+ 行 40（parentId/blockedBy **双边**同 workspace 约束升入 FR）+ 行 54（「全部」视图建单缺省=default）+ 行 55（父单候选随所选 workspace 过滤） | ✅ **闭合** | 四个子点逐条落地；对照 `ticket-service.ts:116-143`（parentId 仅 TASK 可带且父必 STORY）与 `:541-592`（addDependency 唯一建边入口）——继承+双边约束覆盖全部父/依赖形态，无遗漏边；`routes/tickets.ts:30` 建单仅收 STORY/TASK，FR-3「STORY/TASK/BLOCKER 均挂 workspace」的类型覆盖准确（DREAM 不接受创建，`status.ts:14-15`） |
| **L-1** | 日志口径 | 行 46（日志按单号唯一性落盘、非按仓物理分区；跨仓隔离由 worktree 目录+分支承载） | ✅ 闭合 | 与 `worktree.ts:19` 既有注释口径一致 |
| **L-2** | 场景 3 缺预绑定前提 | 行 80（「两者均**预绑定 worker**」） | ✅ 闭合 | 与 `dispatcher.ts:429` 自动放行硬条件（TASK + SPEC_READY + parentId + workerId）一致 |
| **L-3** | 契约补全 4 条 | 行 27（仓根=config.yaml 所在目录、`~` 展开）+ 行 38（未知 workspaceId 422 指明可选集）+ 行 44（非 TASK 传 repoRef 422）+ 行 51（`:id` 未知 404） | ✅ 闭合 | `config.ts:31/34/53`（相对路径以 repoRoot 为基准 + expandHome）、`errors.ts:19-35`（NOT_FOUND→404；语义拒绝→422 与 spec 一致）、`ticket-service.ts:133-135`（非 TASK 传 parentId 即 DAG_INVALID 422，同为"422 拒绝非 TASK 参数"的既有先例） |
| **L-4** | 实现细节标注 | 行 46（「**此模板为验收锚点**：跨仓隔离以目录名可断言」） | ✅ 闭合 | 模板 `{dataDir}/worktrees/{repoName}-t{id}` 与 `worktree.ts:33` 现实现逐字一致，标注理由成立（FR-2 的「DB 侧 workspaceId 列」定义 NULL 语义，属需求级信息，保留可接受） |
| **L-5** | repoRef 悬空兜底 | 行 45（复校失败 → 422 指明已失效，人工修正 yaml 后重试或裁决终止） | ✅ 闭合 | 给出修复通道（改 yaml 恢复）与终止通道（裁决），消除「永久不可放行且无修复通道」死局 |

**整合读法复核（防修订引入新矛盾）**：FR-1 的「恒注册、与目录无关」是通则，FR-2 的「无目录合成 + NULL 语义」是其子集展开，两者叠加无歧义；FR-2 的「S2a 全部测试在无 workspaces/ 目录环境下原样通过」与 FR-3/FR-4 新增可选参数（缺省即旧行为、合成 default 下 repoRef 恒有效）兼容，回归保证成立。

## 新发现的问题

1. **版本标记未随修订更新** — 严重程度：low
   - 位置：spec 头部「状态：v1（2026-09-24）」（行 4）
   - 影响：本稿系 r1 REJECT 后的修订版（r1 审查对象即标 v1），头部未递增版本、亦无修订轮次说明，审计链上无法区分 v1 与修订稿；日期 2026-09-24 与 r1 报告/本次复审日期（2026-09-23）不一致
   - 建议：改为 `v2（r2：M-1/M-2/L-1~L-5 闭合）` 并校正日期（对照同项目 S2a spec 的「状态：v4（r3 残余清理）」约定）

2. **列表 workspace 筛选器与顶栏切换器的交互未定义** — 严重程度：low
   - 位置：FR-6（行 54-56）
   - 描述：顶栏切换器已是全局 workspace 过滤（含「全部」选项），同页又新增列表筛选器 workspace 维度——切换器=workspace X 而筛选器选 Y 时取交集（空列表）、筛选器是否随切换器锁定/隐藏，未说明；「全部」视图与非「全部」视图下的行为差异亦未区分
   - 影响：前端实现二义（两控件并存可能互相打架），验收场景 5「切换器过滤两页一表」无法判定该边界
   - 建议：补一句口径（推荐：切换器=全局作用域；列表 workspace 筛选仅在「全部」视图可用，非「全部」时随切换器锁定为当前值）——属 FR-6 行文的自然收口，非本轮 M-2 修复引入
   - 对照事实：`TicketListPage.tsx:26-27/67-76` 现有 status/type 两个筛选控件模式，新增第三维需明确与全局态的关系

## 观测（不计分，供 impl 参考）

1. **default 过滤/计数的并集展开**：FR-3 列表过滤与 FR-5 详情计数在 workspaceId=default 时，需按 FR-2 的 NULL 语义做「NULL ∪ 'default'」并集；建议 impl 收口单一 workspace 解析函数（API 过滤、详情计数、建单校验三处复用），避免降级为 `eq(workspaceId,'default')` 漏存量 NULL 行（否则场景 4「存量工单归属正确」名义通过而实际列表缺口）。
2. **合成 default 的 name 与主仓 repo id 未规定**（FR-5 响应/FR-6 切换器需展示与引用），impl 取缺省值（如 name=default、id=primary）即可，无需回改 spec。
3. **放行四件套顺序未写死**：无 workspaces/ 环境下 repoRef 恒有效，S2a 既有「blockedBy → workerId → worktree」顺序测试（`state-machine-s2a.test.ts:133`）不受影响；spec 不强制顺序，推荐实现将 repoRef 复校置于 worktree 构造前以给出更指向性错误码。

## 结论

# PASS

状态：SPEC_REVIEWING → SPEC_USER_AUDIT（按转移表预期；注：`stage_get('atd-s2w1-workspace')` 返回「未建档」——`~/doc/.specpipe/plans/` 下无该 topic 目录，本报告未更新状态机，落定由调度者执行）

> 注：仅审文档，未修改任何代码，未触碰 `.stage`；问题 1/2 建议随 v3 一并收口，不阻塞用户审计。
