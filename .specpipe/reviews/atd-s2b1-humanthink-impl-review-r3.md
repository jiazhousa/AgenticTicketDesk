# 审查报告: atd-s2b1-humanthink — Impl (Revision 3)

- **类型**：Story Impl 完整审查（S-S8 第三轮 / r2 REJECT 87 复评·终审）
- **审查对象**：`.specpipe/plans/atd-s2b1-humanthink/impl.md`（**v2.1**，98 行，commit 04ed8ef）
- **基准材料**：r2 报告 `.specpipe/reviews/atd-s2b1-humanthink-impl-review-r2.md`；r1 报告 `...-impl-review-r1.md`；同目录 `spec.md`（v7 业务语言版，SPEC_APPROVED）；契约唯一事实源 `probe-report.md`（探针 8 项漂移 + 补录 0 号）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（HEAD 04ed8ef，工作区干净，只读）
- **v2→v2.1 变更范围**：`git diff --stat 7f85af6..04ed8ef` = `impl.md`(+10/-5) + 本轮 r2 报告归档 + `.stage-history`(+2)——**纯文档增量，零业务代码改动**
- **核对面**：impl.md 全文 + spec.md（规则 5 / 范围 4）+ `apps/server/test/*.test.ts`（计数）+ r1/r2 报告逐项对照
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（`stage_get` 实测，与派发口径一致）
- **日期**：2026-09-25

## 总体评价

**通过**——r2 的 **1 medium + 4 low + 1 观测计数**共 6 项**全部闭合**：r2 m2（已删会话「历史可查」无实现路径）以「详情内嵌只读镜像事件」落地，规则 5 与范围 4 的用户面读取通道回到可验证；low-1~low-4（对账应用层幂等 / config-gen 读写边界 / reasoning·tool 断流缺失接受面 / durable.seq 缺失定案）逐条落字，且 v2.1 新增文字自洽、未引入口径矛盾。收敛曲线 r1 REJECT 9 → r2 REJECT 87 → r3 **PASS**（余 2 low，无 medium+），与 S3 impl r4=92 先例同档。

## 质量评分

**96 / 100**（critical×0 / high×0 / medium×0 / low×2 = −4）

## r2 → v2.1 逐项闭合表

| r2 项 | 判定 | v2.1 落点与核验 |
|---|---|---|
| **m2** 已删会话「历史可查」无实现路径 | ✅ **闭合** | r2 建议 ①「`GET .../:id` 响应形状补 `{session, events?}` 并注明已删会话详情携带只读镜像事件」被**逐字采纳**：impl:68 `GET .../:id` → `{session（含 deletedAt）, events}`——**详情内嵌只读历史事件（镜像回放，规则 5「历史可查」的唯一读通道）**；422 名单收敛为 `prompt/interrupt/delete/reply/SSE`。对照 spec:46 规则 5 与 spec:24 范围 4——列表排除 / 详情携带只读历史 / 不能发消息三分齐，用户面「历史可查」恢复可验证路径。响应形状已冻结（块 2 并行依据补全） |
| **low-1** 对账行无幂等键（serve_seq NULL 不去重） | ✅ **闭合** | impl:18「对账行 serve_seq=NULL（唯一索引对 NULL 不约束），**应用层幂等=(session_id, payload.messageId) 先查后插（单进程串行无竞态）**」——采纳 r2 附加复审点 A 的建议；「唯一索引对 NULL 不约束」一句把 SQLite 语义显式记档，与 impl:40 `UNIQUE(session_id, serve_seq)` 自洽 |
| **low-2** config-gen 反向决策边界未闭合 | ✅ **闭合** | impl:16 写死读写两侧：**读取源=固定用户全局位（`~/.config/opencode` 的 `opencode.json`/`opencode.jsonc`，存在者优先）；写目标=仅 `{dataDir}/opencode-config/opencode.json`（绝不写其他任何路径）**，并补齐 r2 要求的「用户全局缺失时仅生成 agents 段，模型缺失风险由冒烟暴露」；providers 原样含凭据的取舍保留「dataDir 本地文件不入仓，MUST-6 边界内」记档 |
| **low-3** reasoning/tool 断流缺失接受面未声明 | ✅ **闭合** | impl:18 末句「**文本以 message 端点为权威兜底（与验收「不丢话」一致；「不丢话」指对话文本——断流窗口的 reasoning/tool 历史缺失为记档接受面）**」——采纳 r2 建议的「接受面」显式记档，且不触碰验收 2 的「不丢话=对话文本」硬约束边界（与 impl:94 风险表「无『接受缺失』fallback」口径一致，无冲突） |
| **low-4** durable.seq 退化路径幂等键不成立 + 索引表述不一致 | ✅ **闭合** | impl:18「信封缺失的事件**跳过落库仅转发 live+warn 日志，不做退化双键**」+ impl:97 风险表行改「事件信封 durable.seq 缺失（版本演进）→ 跳过落库仅转发 live+warn（技术方案 4 定案，无退化双键）；冒烟脚本覆盖信封存在性断言」——无效的「本地 seq 退化双键」已删，风险表「唯一索引局部」措辞与 schema 口径的矛盾随之消解 |
| **观测** 「既有 14 测试文件」实为 13 | ✅ **闭合** | impl:44 改为「既有 **13** 测试文件零 serve 进程」；`glob apps/server/test/**/*.test.ts` 实测 **13** 个（workspaces/api/ticket-service/file-set/state-machine-s2a/dispatcher/api-s3/state-machine/worktree/workspace-contract/perm-config/workspace-crossrepo/api-s2a）——计数勘误到位 |

**小计**：6/6 全部闭合，无 medium+ 残留。

## 快扫：v2.1 编辑残留 / 口径矛盾

| 扫描面 | 结果 |
|---|---|
| 「退化双键 / 唯一索引局部」残留 | ✅ 已清除——`grep 退化|局部|唯一索引` 仅命中 impl:18（新定案「不做退化双键」+「唯一索引对 NULL 不约束」）与 impl:97（无退化双键），旧口径无回流 |
| 「接受缺失」fallback 残留 | ✅ 已清除——仅 impl:94 以否定式保留（「无『接受缺失』fallback」），与 impl:18 接受面口径区分明确（缺=reasoning/tool 历史，不缺=对话文本） |
| 已删三分语义 vs 契约 422 名单 | ✅ 自洽——impl:68 详情（非 SSE）给只读历史，SSE/操作类 422；impl:69 SSE 帧语义仅对活跃会话，二者无交叉矛盾 |
| config-gen 读写边界 vs serve env | ✅ 自洽——impl:16 读=固定用户全局位，impl:15 env `OPENCODE_CONFIG_DIR` 指向生成目录（serve 加载生成配置），二者职责分离，无「读=写目标」混淆 |
| 双序（serve_seq 幂等键 / 本地展示 seq） | ✅ 自洽——impl:18/40：durable 用 serve_seq 幂等、对账行 serve_seq=NULL 走应用层幂等、展示用本地 seq；三个空间分列无碰撞 |
| 观测 O1 保留项（13 计数） | ✅ 已改（见上表末行） |
| 块 1 / 块 2 文件集不相交 | ✅ 维持——块 1=`apps/server/**`+`packages/worker-core/**`+`workers/**`+`config.yaml`+`scripts/**`，块 2=`apps/web/**`，v2.1 未变更文件表 |

## 发现的问题

### low

1. **修订记录「本版」标记滞留 v2，未记录 r2→v2.1 修订** — 严重程度：low
   - 位置：impl:7「**修订记录**：r1 REJECT 9 → **v2**（本版）：块文件集补齐…/config-gen 口径枚举/404 兜底」
   - 事实：commit 04ed8ef message 已标「impl **v2.1**——r2 修订（REJECT 87 收官级）」，但 impl.md 头部修订记录仍自称「v2（本版）」，且未记录本轮「已删详情内嵌历史 / 对账应用层幂等 / durable.seq 缺失定案 / config-gen 读写边界 / 13 计数」五项修订。
   - 影响：文档自述版本号与提交口径漂移，审计链（r1→v2→v2.1）在正文头部不可见；不影响 Builder 实现（正文契约字面完整），属文档元数据滞留。
   - 建议（一行级）：修订记录追加一条「r2 REJECT 87 → **v2.1**（本版）：已删会话详情内嵌只读历史/对账应用层幂等（messageId）/durable.seq 缺失跳过落库/config-gen 读写边界/13 测试计数勘误」。

2. **web 侧已删会话历史的用户可达入口未在块 2 明列** — 严重程度：low
   - 位置：impl:67 列表 `?workspaceId=&q=` **排除 deleted**；impl:68 详情 `{session, events}` 支持已删；impl:57 块 2 `HumanThinkPage.tsx` 职责=「会话列表（workspace 过滤+搜索）+ 聊天窗+建会话弹窗」——未含「已删会话历史」入口
   - 事实：API 读通道已冻结（m2 闭合），但列表与搜索恒排除已删会话，块 2 未声明 `HumanThinkPage` 有任何到达已删会话详情的 UI 路径（筛选「含已删除」/回收站/详情直达均未写），规则 5「历史可查」当前仅 API 级可达、UI 级未闭。
   - 影响：用户面「删除后历史仍可查」的体验路径不明确，Builder 可能只实现 API 而不给 UI 入口；属 UX 可达性留白，不阻塞后端契约（详情形状已冻结，UI 入口为一行级增量）。
   - 建议：块 2 `HumanThinkPage.tsx` 行补一句「会话列表支持『含已删除』切换（经详情端点 `{session(deletedAt), events}` 只读渲染，输入/删除/审批动作禁用）」或等价入口，把规则 5 的 UI 面闭合。

### 观测（不计分）

1. **详情端点 `events` 无分页/after 参数**：impl:68 详情恒内嵌全量镜像事件，长会话（会话永久保存）单次 GET 载荷随事件量线性增长；SSE 端点有 `?after=` 增量而详情无。MVP 单用户自用可接受，建议后续（或 Builder 顺手）给详情补可选 `?after=`/条数上限。
2. **已删会话 `GET .../:id/permission/requests` 未列 422 名单**：impl:68 的 422 名单为 prompt/interrupt/delete/reply/SSE，permission requests（只读）不在内——已删会话该端点行为未定（返回遗留 pending / 空列表均可）。属端点错误语义留白，Builder 自洽选择即可，不阻塞。
3. **config-gen 读取源改「固定 `~/.config/opencode`」较 r5 的 `OPENCODE_CONFIG_DIR ?? ~/.config/opencode` 略窄**：v2.1 impl:16 取更硬的「固定用户全局位」，未承 `OPENCODE_CONFIG_DIR` 环境变量兜底。为更强的边界收敛（验收 3「不干扰」），但与 spec-review-r5.md 的基准目录表述有细差；若用户/后续设了 `OPENCODE_CONFIG_DIR` 指他处，ATD 不读。记档即可。
4. **m2 建议二选项已择一，另一项未记**：r2 曾给「详情内嵌」或「events 允许已删回放」二选一，v2.1 取前者（impl:68），后者（SSE 对已删放行镜像回放）明确保持 422——选择清晰无歧义，无需补。
5. **r2 报告已随 commit 归档**（`git diff --stat` 含 `reviews/...-r2.md` +118 行），审计链完整。

## 结论

# PASS

状态：IMPL_REVIEWING → IMPL_APPROVED

一句话理由：r2 的 1 medium（已删会话历史读通道）+ 4 low（对账幂等 / config-gen 边界 / reasoning·tool 接受面 / durable.seq 退化）+ 1 观测（13 测试计数）**6/6 全部闭合**——impl:68 详情内嵌只读镜像事件把规则 5「历史可查」的唯一读通道落定，impl:18/97 的双序与 durable.seq 缺失定案自洽无残留，全篇口径无矛盾；余 2 low（修订记录版本标记滞留 v2、web 侧已删历史 UI 入口未明列）均一行级、不阻塞 Builder 实现，达标放行。

---

*本轮未修改 impl 正文与任何业务代码；`.stage` 经 `stage_set`（actor=审查者）落 `IMPL_APPROVED`。*
