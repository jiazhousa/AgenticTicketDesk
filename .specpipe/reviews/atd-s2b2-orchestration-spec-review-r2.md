# 审查报告: atd-s2b2-orchestration spec (Revision 2)

- **审查类型**：Spec 审查（r2，r1 REJECT 84 后修订闭合复审）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2b2-orchestration/spec.md`（v3，56 行；commit `955c04b`）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md` §9 S2b2 行（+§4.3）；r1 报告 `atd-s2b2-orchestration-spec-review-r1.md`（REJECT 84）；`AGENTS.md`；同项目先例 `atd-s2w1-spec-review-r2.md` / `atd-s2b1-humanthink-spec-review-r5.md`
- **代码事实核对（只读）**：`apps/server/src/dispatcher.ts`（`onTicketSettled:534` / 调用点 `:301` / 前置 `:550` / `releaseAndRecheck:581`）、`apps/server/src/domain/ticket-service.ts`（`createTicket:188-200` 收 `parentId/workerId`、`submitSpec:431`、`addDependency:775`、各方法 `db.transaction`）
- **日期**：2026-09-26

## 总体评价

[通过]

r1 的 **2 项 medium 与 3 项 low 五项全部闭合**，且修订文本与既有实现事实逐项相符：m1 的新触发入口经 `dispatcher.ts` 事实核验成立（既有自动放行唯一入口 `onTicketSettled` 仅由 DONE settle 在 `:301` 调用，前置链 `:550` 要求 parent+预绑定，`releaseAndRecheck` 只管带 `queuedReason` 的排队单）——v3 规则 6 已把「建单完成即触发点」与「既有机制只由上游 DONE 激活」的对立写清并显式撤回「零新做」措辞，新入口与既有入口收敛于同一 system 放行前置链（闸门/文件集排队语义照旧）；m2 已把 Epic §9 验收③ 绑进验收 4。修订未引入新的语义矛盾，范围/规则/验收三方在「原子建单、校验、流转、编辑态代价」四组语义上互相印证。仅余 1 项 low（业务规则内嵌过程记号，文档级），不阻塞进入 SPEC_USER_AUDIT。

## 分数

**98 / 100**（100 − 1×low 2）

## r1 问题闭合核验（逐项，附 v3 行号与实现证据）

| 项 | r1 问题 | v3 修订位置 | 判定 | 核验依据 |
|---|---|---|---|---|
| **m1** | 首任务放行触发点未声明，与「零新做」冲突 | 规则 6（行 44）+ 范围 4（行 22）+ 验收 4（行 31） | ✅ **闭合** | 规则 6 写明「建单**事务提交后**即刻触发链上无依赖任务的自动放行（建单完成即触发点——既有自动放行只由上游 DONE 激活，新链根任务需此入口）」。事实核验：`dispatcher.ts:534` `onTicketSettled` 唯一调用点 `:301`（settle 分支），语义=「以落定单为 blockedBy 的下游」；根任务无上游 DONE，不会被激活；`releaseAndRecheck:581-589` 仅取 `SPEC_READY 且 queuedReason 非空` 行，根任务不满足——r1 判断成立，v3 声明必要。**收敛性**：新入口描述「此后接力/排队/闸门/重试全部走既有机制」与既有 `service.transition(...,'DISPATCHED',{actor:'system'})`（`:559-566`，闸门满/文件冲突时内部落排队、非 DISPATCHED 不 spawn 的 `:563` 注释）同一条前置链，无第二套放行语义。**边界**：规则 6 的「无依赖任务」沿用 `:550` 前置（TASK + SPEC_READY + parentId + workerId）与 `:558` 依赖全 DONE 判据，「预绑定=建单时落 workerId」由 `createTicket` 入参支持（`ticket-service.ts:194/265`）；多根并行（跨仓 DAG 语义）由「无依赖任务」复数形态承接 |
| **m2** | Epic §9 验收③「跨仓 DAG 各 Task 在正确仓执行」无验收绑定 | 验收 4（行 31，标题改「自动流转与跨仓」） | ✅ **闭合** | 「验收用**跨仓计划**（主仓任务+readable 仓任务各≥1，后者真跑通 DONE，worktree 落对应仓）——Epic §9 验收③ 同时收口」：主/可读两侧均≥1，且指定真跑通 DONE 的任务落在 readable 仓并断言 worktree 所在仓；配合 5 章「commits 以 git 实测为准（基线 diff）」，「真跑通 DONE」即隐含 commit 实测于该仓 worktree，覆盖②「各 Task 在正确仓执行」的判定面 |
| **l1** | 校验双层语义未合并（本地标红 vs 服务端预校验） | 规则 4（行 42）+ 风险表行 | ✅ **闭合** | 规则 4 改为「**校验单源**……**预检与提交共用服务端同一套校验**，违规项由卡上标红展示并阻止确认」——权威方唯一（服务端）、回显路径唯一（卡上标红+阻止确认）；风险表「提交前服务端预校验（规则 4）」与之一致，不再出现「本地预校验标红」的平行语义。触发时机（编辑即时往返/提交往返）留 impl，属实现细节 |
| **l2** | 编辑态不落库的刷新代价未记档 | 规则 9（行 47） | ✅ **闭合** | 「**编辑未提交态不持久**——刷新后回到助手原稿（确认前请完成编辑，代价记档）」；与不做清单「计划草稿落库」自洽（行 24），用户可见行为已声明 |
| **l3** | 多次拆单的计划内任务引用协议未定义 | 规则 4（行 42） | ✅ **闭合** | 「依赖限**本计划内任务**（计划内局部任务 id 引用，跨计划引用非法）」：引用域=单次计划块闭包，跨块引用非法，与澄清③/验收 6「各自成链互不影响」一致；块内标识形态留 impl |

## Epic §9 S2b2 三条验收 + 偏离两条（终核）

| Epic §9 | 承接位置 | 结论 |
|---|---|---|
| ① 会话产出 spec+DAG 草稿（Task 含 repoRef/workerId/依赖）可编辑 | 范围 1/2 + 验收 1/2 + 规则 1/2 | **承接**（完整） |
| ② 确认门放行→自动建单（含快照+预绑定），编排链自动流转生效 | 范围 3/4 + 验收 3/4 + 规则 3/5/6 | **承接**（完整；m1 入口已补明） |
| ③ 跨仓 DAG（如三仓并行→测试→MR）各 Task 在正确仓执行 | 验收 4（跨仓计划 + readable 真跑 DONE 落对应仓） | **承接**（m2 收口） |

**对 Epic 的偏离两条**（行 8）：① 单助手双职责取代独立 oracle/explorer agent 与 `{{agent}}` 切换；② 确认门形态=聊天内计划卡（非独立页面）——均带 2026-09-26 用户拍板记录（行 7 澄清记录），**完备**；Epic 行内「预绑定+依赖」「泳道呈现」等非偏离项无遗漏。

## 三方一致性快扫与编辑残留

- 范围 3 ↔ 规则 3 ↔ 验收 3：原子建单「一次事务完成 / 全成或全不建」三处一致（`ticket-service.ts` 既有 `db.transaction` 于 `createTicket:200`/`submitSpec:432`/`addDependency:776`，批量建链需外层包一个事务——需求级约束成立，实现形态留 impl）
- 范围 4 ↔ 规则 6 ↔ 验收 4：均为「无依赖任务即刻放行 + 前序 DONE 接力」，措辞「最后一步 / 事务提交后 / 确认后」语义等价无冲突
- 范围 2 ↔ 规则 4 ↔ 验收 2：编辑维度（标题/描述/增删/依赖/文件集/目标仓/worker）与校验项（仓储/worker/依赖/环）对应无缺
- 规则 9 ↔ 不做「计划草稿落库」；规则 2「唯一建单入口」↔ 规则 8「确认后再拆单」：自洽
- 残留扫描：v2 的「零新做」「首任务自动放行」表述已无正文残留（仅剩行 4 版本说明与行 44 括注两处过程记号）

## 新发现的问题

1. **业务规则内嵌过程记号，与「业务语言 spec」定位及终态化约定不符** — 严重程度：low
   - 位置：规则 6（行 44）括注「（r1-m1 修正：非「零新做」）」
   - 影响：「既有自动放行只由上游 DONE 激活，新链根任务需此入口」已完整表达终态语义，`r1-m1 修正` 属审查过程记号；对照 `AGENTS.md` §四「只陈述事实与原因，不带历史演进」的项目约定，正文内混入轮次记号削弱业务语言一致性（不影响可读性与可实现性，纯文档级）
   - 建议：删去「r1-m1 修正：」前缀，保留「非「零新做」」的边界提示或改写为「（既有机制外仅此一处新增触发点）」

## 观测（不计分，供 impl / 后续轮次参考）

1. **r1 观测 1 仍未闭合**（不计分）：偏离清单未注 Epic §9 同步时机（S3 先例「终稿放行后随 Epic 修订同步」）；建议 impl 阶段或 Epic 修订时补注，不影响本轮结论。
2. **新入口实现收敛提示**：新增「建单完成」触发点在实现上应复用与 `onTicketSettled` 相同的放行前置（TASK + SPEC_READY + parentId + workerId + 其余依赖全 DONE）并同样以 `actor=system` 走 `service.transition`，使闸门满/文件冲突自动落排队（`dispatcher.ts:563`）、非 DISPATCHED 不 spawn；避免新写一套直连 spawn 的放行路径。属 impl 实现建议，spec 口径已足够。
3. **验收 4 证据建议**：报告验收时以该 readable 仓 worktree 的 `git log`（分支 `atd/{workspaceId}-t{id}`）与基线 diff 作为「commit 落对应仓」的实证，比仅断言 worktree 路径更可复核。
4. **验收 7（无干扰）真机回归落点**（承接 r1 观测 2）：验收 8 的「真机冒烟」建议显式包含一轮纯讨论会话，验证同一 `atd-ht-{ws}` agent 在扩系统提示后日常讨论行为不变。

## 结论

# PASS

状态：SPEC_REVIEWING → SPEC_USER_AUDIT

> 仅审文档：未修改 spec 正文与任何业务代码；`.stage` 经 `stage_set`（actor=审查者）落定。low 与观测项建议随后续轮次或 impl 阶段一并收口，不阻塞用户审计。
