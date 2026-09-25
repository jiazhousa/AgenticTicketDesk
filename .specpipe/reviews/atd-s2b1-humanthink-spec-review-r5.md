# 审查报告: atd-s2b1-humanthink spec (Revision 5)

- **审查类型**：Spec 轻量审查（r5 终审：r4 六项闭合核验 + v6 编辑残留/新旧口径扫描）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2b1-humanthink/spec.md`（v6 形态，78 行，commit 0bec985）
- **基准材料**：r4 报告 `.specpipe/reviews/atd-s2b1-humanthink-spec-review-r4.md`；Epic `agentic-ticket-desk/epic-spec.md` §4.3/§4.4/§9
- **源码级核对仓**：`/home/starlex/project/opencode/packages/`（1.18.21 快照，只读，同 r1-r4 版本）
  - 本轮核对面：`core/src/v1/config/migrate.ts`、`core/src/config.ts`、`core/src/location-mutation.ts`、`core/src/tool/read.ts`、`core/src/util/wildcard.ts`、`core/src/permission.ts`、`core/src/config/plugin/agent.ts`、`core/src/plugin/agent.ts`、`core/src/global.ts`、`protocol/src/groups/agent.ts`
- **日期**：2026-09-25

## 总体评价

[通过]

r4 六项（2 medium + 4 low）**逐项均已闭合**，且两处 medium 的修订经源码级复核**成立且正确**：规则 3 的 resource 形态已按 r4 意见纠偏（外部仓绝对路径 + `external_directory` 动作、主仓 `read` 相对 allow），与验收 4「readable 仓读正常」的冲突消除；生成文件 V2 键形约束（`model`+`providers` 复数）与 V1 触发键禁入清单写死，配合 P1a 的 `GET /api/agent` 注册判据，堵住了 r3-critical 静默失效链在生成文件侧的原样复现路径。

v6 快速扫描仅余 **3 处 low**（背景事实链与规则 3 的新旧口径并存、风险表配置合并行的单数 `provider` 残留、用户全局配置定位基准未写），均不影响 P1b/P1a 探针的语义冻结与 impl 执行口径，无 medium 及以上残留。对照仓内先例（S3 spec r2 PASS 87），判 **PASS**，进入 `SPEC_USER_AUDIT`。

## 分数

**94 / 100**（100 − 3×low 2 = 94）

## r4 → v6 逐项核验（六项）

| r4 项 | 结论 | 核验依据（v6 位置 + 源码事实） |
|---|---|---|
| **中-1（medium）** readable 仓 resource 形态错误 | **已闭合** | v6 行 58 规则 3 重写：② `external_directory` deny「resource 为**绝对路径**形态」；③ 主仓内读 allow「`read` 动作+相对通配（与内置 build agent 口径一致）」；④ 各 readable 仓 allow「`external_directory`（与 `read`）动作+**该仓绝对路径通配**（外部仓 resource 为绝对路径——相对形态永不命中）」。<br>源码复核：外部 resource=`slash(resolved.canonical)`（绝对）、`externalDirectory.resource=<绝对目录>/*`（`location-mutation.ts:131-147`）；内部 resource=`path.relative(locationRoot,…)`（`:134`）——③「相对」与④「绝对」分工与源码事实一致。`read.ts:60-68` 外部**先**断言 `external_directory`（资源=`<绝对目录>/*`）、`:72-79` 再断言 `read`（资源=absolute canonical）——④ 同时给两个动作与绝对通配，覆盖两处断言。次序 ①→②→③→④ + findLast（`permission.ts:76-86`）→ ④ 后于 ② 生效，readable 仓放行、其余外部落 ② deny；`wildcard.ts:3-13`（整串正则、`*`→`.*`）支撑 `*` 覆盖深层与绝对串。验收 4 冲突消除 ✓。行 42 P1b 已改「主仓相对与 readable 绝对两种 pattern 形态」，行 43 P1c 补「含绝对路径读法」✓ |
| **中-2（medium）** 生成文件 V1 触发键静默迁移 | **已闭合** | v6 行 22 写死「V2 键形：`model`（单数）+`providers`（复数）；V1 触发键禁入清单：单数 `agent`/`permission`/`provider`」+ 行 22 失败链括注（整文件 V1 迁移 → `onExcessProperty:ignore` 静默丢弃 `agents`）；行 41 P1a 判据加 `GET /api/agent` 确认 `atd-ht-x` 已注册；行 72 风险表新行。<br>源码复核：`migrate.ts:10-28` V1 触发键集含 `agent`/`provider`/`permission`（`isV1` `:30-33` 任一命中整文件走 V1）；V2 正确键名 `permissions`/`agents`/`providers`（`config.ts:60,63,106`），三者与 `model` 均**不在**触发键集 → V2 键形生成文件安全；`config.ts:143` `onExcessProperty:"ignore"` + `:155-159` isV1 分支成立；`GET /api/agent` 端点存在（`protocol/src/groups/agent.ts:7-11`，返回 `Agent.Info[]`）。r3-critical 失效链原样复现路径已堵 ✓ |
| **低-1（low）** P1a fallback「无」校准偏离 | **已闭合** | v6 行 41 fallback 链：载体 A（CONFIG_DIR 生成文件）→载体 B（workspace 项目级 `.opencode/opencode.json` 写 agents——污染面+gitignore 提示+用户确认后用）→仍失败→上报用户重审整体路径③（探针失败即停 impl）。行 71 风险表第 1 行同步「污染面用户确认 → 上报用户重审（探针失败即停 impl，不硬闯）」。中间载体补上、主体/对象（上报用户重审整体路径③）明确 ✓（原「24h」窗口改由「探针失败即停」承接，语义更强） |
| **低-2（low）** 项目级配置仍被读入 | **已闭合** | v6 行 73 风险表新行：「core 无开关关断 workspace 内 `.opencode` 读取，`OPENCODE_DISABLE_PROJECT_CONFIG` 只管 instruction / 已知事实记档：接入 workspace 自带项目级配置会叠加生效；验收 3 口径为「进程/端口/数据面零干扰」不含配置面」。r4 要求的「已知事实记档 + 验收 3 口径澄清」均已落地 ✓ |
| **低-3（low）** `deleted_at` 读语义只定义到列表 | **已闭合** | v6 行 32：「已删除会话：详情返回带 deletedAt 标记（历史可查），SSE/操作类端点 422 `SESSION_TERMINATED`」——详情读、SSE、写操作三分语义齐备，与行 32 列表「默认排除 deleted_at 非空行」、行 30 错误码枚举自洽 ✓ |
| **低-4（low）** 合并白名单过窄 + 读取路径硬编码 | **已闭合** | v6 行 22：「合并范围刻意最小集（仅 model/providers；用户 plugins/skills/mcp 不并入——ATD serve 保持干净环境，记档：如需扩展再议）」+「读取用户全局配置时兼容 `opencode.json` 与 `opencode.jsonc`（存在者优先，避免静默失配）」。r4 要求的「最小集记档 + jsonc 兼容读取」均已落地 ✓（v5 硬编码的 `~/.config/opencode/opencode.json` 已移除） |

> 六项全部**已闭合**，无一项未闭合。

## 编辑残留 / 新旧口径 / 行重复 扫描

- **行重复**：全文 78 行逐行通读，无重复行、无附加残留片段。
- **状态行**：行 4 正确更新为 v6（列 r4 修订四项 + 「待 r5 审查」）✓。
- **新旧口径并存（3 处，见「发现的问题」）**：背景⑤（行 15）未限定 read resource；风险表（行 76）单数 `provider`；用户全局配置定位基准（行 22）未写。
- **编辑残留（观测级）**：行 5 日期行未追加 v6/r4；行 23/25 `r3-l4` 标签（r4 观测 1 已提、未修）。

## 发现的问题

1. **背景事实链⑤ 与规则 3 ④ 新旧口径并存** — 严重程度：low
   - 位置：行 15 ⑤「read 的 resource 为**相对路径**，越界动作=`external_directory`」vs 行 58 规则 3 ④「外部仓 resource 为绝对路径」
   - 影响：背景节以「r1-r3 核定最终口径」的无限定措辞陈述「read resource 为相对路径」，与 r4-m1 修正后的规则 3（外部=绝对、内部=相对）同文件并存。impl 若以背景为地面真值，仍有把相对 pattern 套到 readable 仓的复发风险（规则 3 已显式纠偏、且行 58 带「r4 修正」标注，复发概率低）。
   - 建议：行 15 ⑤ 改「read 的 resource：主仓内为**相对路径**，跨仓（外部）为**绝对 canonical 路径**；越界动作=`external_directory`」；标题「r1-r3 逐轮核定的最终口径」改为「r1-r4」。

2. **风险表配置合并行残留单数 `provider`** — 严重程度：low
   - 位置：行 76「配置合并面（model/provider 键集）不全」
   - 影响：行 22 已把合并集写死为 `model`+`providers`（复数），并把单数 `provider` 明列为 V1 禁入触发键；行 76 却仍用单数 `provider` 描述同一键集——恰是 r4-m2 点名的混淆命名在风险表中残留，审计口径不一致。
   - 建议：行 76 改「配置合并面（`model`/`providers` 键集）不全」。

3. **用户全局配置的定位基准未写** — 严重程度：low
   - 位置：行 22「读取用户全局配置时兼容 `opencode.json` 与 `opencode.jsonc`（存在者优先）」
   - 影响：v5 的硬编码路径已移除、v6 补了双文件名+JSONC 兼容，但未写明「用户全局配置」的**基准目录**取 `OPENCODE_CONFIG_DIR ?? ~/.config/opencode`（core 解析规则，`global.ts:64`）以及用户全局若为 **V1 键形**时的处理（提取 `providers` 落空 → 退化为 ModelNotSelectedError）。自定义 CONFIG_DIR 或 V1 键形用户配置下会静默失配；该失败态被 P1a「ModelNotSelectedError 反例」兜住，故为 low。
   - 建议：行 22 补「基准目录按 core 解析规则 `OPENCODE_CONFIG_DIR ?? ~/.config/opencode`；用户全局若为 V1 键形则显式拒绝并报错（不静默提取空 providers）」。

## 观测（不计分）

1. **禁入清单枚举为定向子集**：行 22 列「单数 `agent`/`permission`/`provider`」3 项，而 `migrate.ts:10-28` 触发键集共 17 项。因生成文件仅写 `agents`/`permissions`/`model`/`providers`，其单数形态恰为这 3 项——对本 Story 的写入键集**功能性完整**，无需补全；如求审计完备可加「（其余触发键见 core `migrate.ts`）」括注。
2. **`permission/requests` 对已删除会话的分类未明**：行 32 界定「SSE/操作类端点 422」，`GET .../:id/permission/requests`（行 36）属读类还是操作类未逐端点标注；语义边界（已删除会话已无在途请求）低风险。
3. **行 5 日期行未追加 v6/r4**：「v1 草案 / v2 澄清 / v3 r1 / v4 r2 / v5 r3 修订」缺 v6/r4 项。
4. **`r3-l4` 标签仍在**：行 23/25 两处（r4 观测 1 已指出 r3 报告无 `r3-l4`，措辞项实为 r3 低-3）；审计链标签宜校正。
5. **验收 3 口径澄清仅落风险表**：行 50 验收 3 正文「并存互不影响」未改，澄清句在行 73 风险表；r4-l2 要求的记档已达成，正文层面如需可加「（配置面见风险表）」脚注。

## 结论

# PASS

状态：SPEC_REVIEWING → SPEC_USER_AUDIT

> r4 六项（2 medium + 4 low）**全部闭合**：中-1（readable 仓 resource 绝对形态 + `external_directory`/`read` 双动作）与中-2（生成文件 V2 键形 + V1 禁入清单 + `GET /api/agent` 注册判据）经 1.18.21 源码逐点复核成立，r3-critical 失效链在生成文件侧的复现路径已堵；低-1/2/3/4 的 fallback 链、项目级配置记档、`deleted_at` 读语义、最小集+jsonc 均落地。v6 全文扫描无行重复、无未闭合 medium；仅余 3 处 low（背景⑤ 相对/绝对口径并存、风险表单数 `provider` 残留、用户全局配置定位基准未写）与若干观测项，不影响 P1a/P1b 探针语义与 impl 执行口径。质量评分 **94/100**，对照 S3 spec r2 PASS 87 先例判 PASS。未修改 spec 正文与任何业务代码。
