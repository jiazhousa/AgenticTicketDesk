# 审查报告: atd-s2b1-humanthink spec (Revision 4)

- **审查类型**：Spec 轻量审查（r4：r3 八项闭合核验 + v5 载体方案复审 + 边角一致性核验）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2b1-humanthink/spec.md`（v5 形态，76 行）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md` §4.3/§4.4/§9（S2b1 行、决策 C/D、行 119-120 可读范围）；r3 报告 `.specpipe/reviews/atd-s2b1-humanthink-spec-review-r3.md`
- **源码级核对仓**：`/home/starlex/project/opencode/packages/`（1.18.21 快照，只读，与 r1-r3 同版本）
  - 本轮核对面：`core/src/{global,config,permission,agent,location,location-mutation,util/wildcard,flag/flag}.ts`、`core/src/config/{agent,plugin/agent,plugin/provider}.ts`、`core/src/v1/config/{config,migrate}.ts`、`core/src/tool/read.ts`、`core/src/instruction-context.ts`、`protocol/src/groups/agent.ts`、用户真实全局配置 `~/.config/opencode/opencode.json`
- **ATD 侧核对仓**：`/home/starlex/project/AgenticTicketDesk`（只读）——`workspaces/atd.yaml`、`apps/server/test/{workspaces,workspace-contract,workspace-crossrepo}.test.ts`（readable 仓形态实证）
- **日期**：2026-09-25

## 总体评价

[不通过]

v5 对 r3-critical 的修订**成立且论证正确**：换 `OPENCODE_CONFIG_DIR` 私有目录 + 生成 `opencode.json`（core V2 键形 `agents`）确为 core 唯一可用的用户级配置通道，且「整体替换语义 → 必须并入默认模型」的论证经源码复核成立（`core/src/global.ts:63-65` → `core/src/config.ts:173`；不并入则 `Config.latest(entries,"model")` 为空 → `ModelNotSelectedError`，`core/src/session/runner/model.ts:190-203`）。r3-m3 的收口方案（agent 自身首条通配 ask 前置）经**实测用户真实全局配置**（`~/.config/opencode/opencode.json:4-20` 三条 `external_directory` allow）验证有效——`plugin/agent.ts:70-78/88-90` 把全局/项目顶层 permissions 前置注入，agent 自身规则后置，findLast 下 catch-all ask 稳定压住全局宽松规则。r3-l1/l3 亦已实打实闭合。

但 r3-m1 的修订**在 readable 仓一侧反向引入了同类错误**：v5 把「相对路径」事实（仅适用主仓内 `read`）套到了 readable 仓规则上，而 readable 仓在本仓是**独立绝对路径的仓**（`apps/server/test/workspaces.test.ts:27,117`、`epic-spec.md:119`），core 对其生成的 `external_directory` 资源是 `<绝对目录>/*`、`read` 资源是绝对 canonical 路径（`core/src/location-mutation.ts:132-147`、`core/src/tool/read.ts:60-79`）。按现字面，规则 ② 的全量 `external_directory` deny 会**先于** ④ 生效且 ④ 永不命中 → readable 仓读硬拒，与验收 4「readable 仓读正常」直接冲突。

另有一处**未入档的静默失效分支**：行 22 写「合并用户全局配置的 `model/provider` 段」，而 `provider`（单数）恰是 core 判定 V1 配置的触发键（`core/src/v1/config/migrate.ts:10-33`）——一旦该键落入生成文件，整文件按 V1 迁移、V2 `agents` 被 `onExcessProperty:"ignore"` **静默丢弃**（`core/src/config.ts:143,155-159`；`ConfigV1.Info` 无 `agents`，`core/src/v1/config/config.ts:32-190`），r3-critical 的失效链原样复现。风险表第 4 行只覆盖「键集不全 → ModelNotSelectedError」，未覆盖此分支。

两处均属 spec 层可收敛（规则 3 ④ 改绝对形态 + 生成文件写死 V2 键形约束），**无需推翻路径②与载体选型**，但 impl 按现字面执行会在 readable 仓读与生成文件键形上走错通道，故判 **REJECT**，回 SPEC_DRAFT。

## 分数

**82 / 100**（100 − 2×medium 5 − 4×low 2 = 100 − 10 − 8）

## r3 → v5 逐项核验

| r3 项 | 结论 | 核验依据 |
|---|---|---|
| **高-1（critical）** 载体无执行路径 | **闭合** | 行 15③④ + 行 22 换 `OPENCODE_CONFIG_DIR` 私有目录 + 生成 core V2 键形 `agents` 文件；载体唯一性复核成立（core 仅消费 `OPENCODE_CONFIG_DIR`：`core/src/global.ts:64`；`OPENCODE_CONFIG_CONTENT` 在 core 仅声明无消费：`core/src/flag/flag.ts:22`；`OPENCODE_CONFIG` 在 core 亦无消费，仅 `opencode/src/config/config.ts:401` V1 链）；core config→agent 注册链完整（`core/src/config.ts:142,173-203` → `core/src/config/plugin/agent.ts:80-113`）；「静默 fail-closed」事实已入档（行 15④）。**残余**：键形分支未封 → 本文 medium-2 |
| **中-1（medium）** 越界读动作应为 `external_directory` | **部分闭合** | ② 动作名改对 ✓（`core/src/location-mutation.ts:30,137-147`、`core/src/tool/read.ts:60-68`）；但 ④ readable 前缀「相对主仓的路径形态」在外部仓上永不命中 → 本文 medium-1 |
| **中-2（medium）** 探针未定载体 / fallback 校准 | **部分闭合** | P1a/b/c 三分且各配 fallback ✓（行 41-43），载体已写明 ✓，P1b fallback「调整规则形态，不动架构」✓；**残余**：P1a fallback「无 → 重审路径③」与「24h 重审」主体/对象未写（core 文件通道并非唯一，项目级 discover 是第二通道）→ 本文 low-1 |
| **中-3（medium）** 用户全局 permissions 前置注入 | **闭合** | 行 58 规则 3 ① 首条通配 ask 收口；源码链复核：`core/src/config/plugin/agent.ts:70-78`（全局/项目顶层 permissions 推入所有 agent）、`:88-90`（新 agent 先推全局再推自身）、`core/src/permission.ts:76-86`（findLast，未命中回退 ask）；**实测**用户真实全局 3 条 `external_directory` allow 被压住。私有 CONFIG_DIR 另切断「全局读污染」→ 验收 3 的全局侧成立 ✓ |
| **低-1（low）** 恢复游标映射未定义 | **闭合** | 行 28 `humanthink_sessions.serve_cursor` 列 + 行 59 规则 4「每次 durable 落库同步更新，恢复直接用该列，不依赖镜像行反推」——消歧到位（新会话 `?after` 初值未逐字写 `0`，但列语义已无歧义，可接受） |
| **低-2（low）** 错误码未枚举 + `deleted_at` 读语义 | **部分闭合** | 行 30 四错误码枚举齐备（`WORKER_UNAVAILABLE` 503 / `SESSION_NOT_FOUND` 404 / `SESSION_TERMINATED` 422 / `VALIDATION` 422）；行 32 列表「默认排除 deleted_at 非空行」✓；**残余**：详情与事件补拉对已删除会话的读语义未写 → 本文 low-3 |
| **低-3（low）** 措辞残留（SSE / capabilities） | **闭合** | 行 25「ATD 本 Story 引入 SSE 端点形态——非既有模式复用」✓；行 23「启用 interactive 能力位（枚举已含，非 schema 扩展）」✓（标签误记为 `r3-l4`，见观测 1） |
| **低-4（low）** serve 启动失败降级（v4 已闭） | **未回退** | 行 21 重试 3 次 → degraded → 不阻塞主功能 + 随 ATD 销毁 ✓ |

## 发现的问题

### 中-1（medium）规则 3 ④ readable 仓 resource 形态错误：外部仓的 `external_directory`/`read` 资源是绝对路径，② 会先于 ④ 硬拒（与验收 4 冲突）

- **位置**：业务规则 3（行 58 ④）、验收 4（行 51）、P1b/P1c（行 42-43）
- **源码事实（1.18.21 快照）**：
  - 会话 location = 主仓绝对路径（规则 2），locationRoot = `realPath(location.directory)`（`core/src/location-mutation.ts:84`）。**readable 仓是独立绝对路径的仓**（`workspaces/atd.yaml:4` 注释「path 相对本仓根目录或 ~ 展开」；实证双仓用例主/读仓为两个独立临时目录：`apps/server/test/workspaces.test.ts:27,117`、`apps/server/test/workspace-contract.test.ts:165`、`workspace-crossrepo.test.ts:37`；`epic-spec.md:119`）。
  - `core/src/location-mutation.ts:120-149`：`external = !lexicallyInternal`；`resource = external ? slash(resolved.canonical) : slash(path.relative(locationRoot, …))`（外部=**绝对 canonical**，内部才是 location 相对）；`externalDirectory.resource = slash(path.join(externalDirectory, "*"))`（**`<绝对目录>/*`**，行 137,145）。
  - `core/src/tool/read.ts:53-79`：外部路径**先** assert `external_directory`（绝对资源）→ 命中 ② deny 即 `BlockedError`，**read 断言根本不会执行**；故 ④ 无论是 `external_directory` 还是 `read` 规则，只要资源写成「相对主仓形态」都永不命中（`core/src/util/wildcard.ts:3-13` 为整串正则，相对模式不匹配绝对串）。
  - 若模型改用相对路径跨仓（`../repo-b/x`），先被 `PathError relative_escape` 拦（`location-mutation.ts:124`）——两条路都不通。
- **影响**：readable 仓读被 ② 硬拒（或 `relative_escape` 报错），验收 4「主仓与 readable 仓读正常」失败，epic「workspace.repos 即白名单（行 120）」的注入语义落空。P1c 会暴露（判据含「主仓与 readable 仓读通」），但其 fallback「审批 UI 降级为纯轮询」只覆盖审批维度，**readable 读失败无对应 fallback**（应归 P1b 的「调整规则形态」，行 42）。
- **建议**（字面仍交 P1b 冻结，但语义写对）：
  - ④ 改 `{action:"external_directory", resource:"<readable 仓绝对路径>/*", effect:"allow"}`（`*`→`.*` 可覆盖其下深层路径，`wildcard.ts:8`）。
  - ③ 补/改为 `{action:"read", resource:"*", effect:"allow"}`（与 core 内置 build agent 口径一致，`r3 报告 §5` 引用 `core/src/plugin/agent.ts:102-118`）——`*` 同时匹配主仓内相对资源与外部绝对 canonical 资源。
  - 删除「相对主仓的路径形态」括注，明确「相对路径事实仅适用主仓内 ③；跨仓（外部）一律绝对前缀 + `external_directory` 动作」，并把该维度补进 P1c fallback（或明确归 P1b）。

### 中-2（medium）生成文件键形约束缺失：`provider`（单数）是 V1 触发键，混入即整文件按 V1 迁移、V2 `agents` 静默丢弃（r3-critical 失效链原样复现）

- **位置**：范围「配置生成」（行 22）、风险表第 4 行（行 74）、P1a（行 41）
- **源码事实**：
  - core 文件加载是**整文件二选一**：`ConfigMigrateV1.isV1(input)` 命中任一 V1 键即整文件走 V1 解码 + `migrate`（`core/src/config.ts:155-159`）；V1 触发键集含 `provider`/`permission`/`agent`/`mode`/`tools`/`plugin`/`snapshot`/`reference`/`command`/`server`/`layout`/`attachment`/`small_model`/`autoshare`/`disabled_providers`/`enabled_providers`/`logLevel`（`core/src/v1/config/migrate.ts:10-33`）。
  - `ConfigV1.Info`（`core/src/v1/config/config.ts:32-190`）**无 `agents`/`permissions`**（只有 `agent`/`permission`），加载参数 `onExcessProperty: "ignore"`（`core/src/config.ts:143`）→ V2 `agents`/`permissions` 被静默忽略，`migrate()`（`migrate.ts:35-72`）产出无 agents 的 Info。
  - 净效果与 r3 高-1 完全一致：动态 agent 不注册 → `PermissionV2.configured` 回退 `missingAgentPermissions` = 全 `deny`（`core/src/permission.ts:15,137-145`）→ 每次工具调用硬拒、`permission.v2.asked` 永不产生（`:190-195,201-205`），**无显式报错**。
  - core V2 正确键名是 `providers`（复数，`core/src/config.ts:106`）；本机用户全局文件实际键亦为 `providers`（`~/.config/opencode/opencode.json:82-85`），行 22 的「`provider` 段」单数写法与事实不符。
- **影响**：impl 若按行 22 字面把用户 `provider`（V1 键）写入生成文件（或整体透传 V1 键形的用户配置），载体静默失效，且风险表第 4 行只提 ModelNotSelectedError，实现者不会警觉；P1a 的「无静默 deny」判据会兜住，但这是 spec 把地雷留给探针。
- **建议**：spec 写死「生成文件为 **V2 键形**：`model`（字符串）+ `providers`（复数，core V2 键名）；MUST NOT 出现任何 V1 触发键（列全 `migrate.ts:10-28` 键集）；用户全局若为 V1 键形须先迁移或显式拒绝并报错」；风险表第 4 行补该失败形态（「混入 V1 键 → 整文件按 V1 迁移 → agents 静默丢弃」），P1a 判据加 `GET /api/agent` 含 `atd-ht-{ws}`（端点存在：`protocol/src/groups/agent.ts:7-10`）。

### 低-1（low）P1a fallback「无」校准偏离 + 「24h 重审」主体/对象未写

- **位置**：P1a（行 41）、风险表第 1 行（行 71）
- **描述**：core 的用户级配置通道确为 `OPENCODE_CONFIG_DIR` 唯一，但**文件通道不止一个**——`core/src/config.ts:177-203` 还会从 `location.directory` 向上 discover 到 `location.project.directory` 的 `.opencode/opencode.json(c)`（即 r3 列出的第二载体：主仓 `.opencode/`，代价=写入用户仓）。故「载体为源码事实级唯一路径，失败即重审路径③」把可选的中间 fallback 抹掉了；且 r3-m2 第三点（24h 重审的发起主体与对象：重跑探针还是复审 spec）仍未承接。
- **建议**：P1a fallback 写「私有 CONFIG_DIR 不生效 → 退项目级 `.opencode/opencode.json`（污染记档，需用户裁决）→ 二者皆败才重审路径③」；「24h 内重审」补「探针报告落 `plans/atd-s2b1-humanthink/probe-p1*.md` 后由 Oracle 派发同 topic spec 复审」。

### 低-2（low）项目级配置仍被读入：验收 3「并存互不影响」只覆盖全局侧（core 无开关可关）

- **位置**：验收 3（行 50）、背景③（行 15）、风险表
- **源码事实**：`core/src/config.ts:177-203` 项目级 discover 不受 `OPENCODE_CONFIG_DIR` 影响；`core/src/config/plugin/agent.ts:80-113` 按文档序（global → project → project `.opencode`）处理，项目级同 id `agents["atd-ht-{ws}"]` 的 rules 会**后置 append**（`draft.update` exists 分支）→ findLast 下可覆盖 ATD 注入规则（例如把 `external_directory` catch-all deny 改成 allow）。项目级顶层 `permissions` 已被 agent 首条 catch-all ask 中和（r3-m3 闭合稳健），故残余面仅「同 id agent 定义覆盖」（`atd-ht-` 命名空间即事实边界）。
- **注意**：core 侧 `OPENCODE_DISABLE_PROJECT_CONFIG` **只作用于 instruction-context**（`core/src/instruction-context.ts:48`；`core/src/config.ts` 无该 flag 消费），**不能**作为缓解写进 spec（app/V1 链的 `opencode/src/config/config.ts:406` 行为不适用）。
- **建议**：spec 记档「项目级 `.opencode/opencode.json` 仍被读入；（a）顶层 permissions 由首条 catch-all ask 中和（b）同 id agent 定义可后置覆盖，唯一防线是 `atd-ht-` 命名空间」；或在 P1c 加一条判据「主仓含 `.opencode/opencode.json` 时规则不被覆盖」（本仓无该文件，但 `~/project/opencode/.opencode/opencode.jsonc:1-20` 证明工作仓普遍存在此类文件，且为 V1 键形会被 migrate）。

### 低-3（low）`deleted_at` 读语义只定义到列表

- **位置**：行 28（列）、行 32（列表）、行 30（`SESSION_TERMINATED` 措辞）
- **描述**：列表已写「默认排除 deleted_at 非空行」，但详情 `GET .../:id`、事件补拉 `GET .../:id/events` 对已删除会话的行为未写；`SESSION_TERMINATED(422，已删除会话操作)` 的「操作」是否含只读语义仍模糊（r3 低-2 要求「详情 404 / 事件不再补拉」）。
- **建议**：一句话写死（建议：详情 404 `SESSION_NOT_FOUND`、事件端点不再补拉、`SESSION_TERMINATED` 仅管写操作）。

### 低-4（low）合并键集白名单只含 model/providers：用户全局工具面（mcp/skills/plugins/instructions/compaction）全丢失 + 读取路径硬编码

- **位置**：行 22（合并键集）、风险表第 4 行
- **描述**：`core/src/config.ts:29-107` 的 V2 Info 中，除 `model`/`providers` 外的用户全局键（`mcp`/`skills`/`plugins`/`instructions`/`compaction`/`formatter`/`lsp`/`shell`…）在私有 CONFIG_DIR 下全取默认 → humanthink 会话不继承用户全局 MCP 工具/skills/插件（验收 1「工具卡片」、验收 4「敏感工具 ask」的前提工具仍在，但用户扩展工具面静默缩水，未入档）。另：行 22 把读取路径硬编码为 `~/.config/opencode/opencode.json`，而 core 的解析规则是两文件名（`opencode.json`/`opencode.jsonc`）+ JSONC + `OPENCODE_CONFIG_DIR ?? ~/.config/opencode`（`core/src/global.ts:64`、`core/src/config.ts:142`）——用户若用 `.jsonc` 或自定义 CONFIG_DIR 会静默失配 → ModelNotSelectedError。
- **建议**：① 明确记档「humanthink 会话不继承用户全局 mcp/skills/plugins」为设计取舍，或改为「整体透传用户全局键集，仅覆盖 `agents`/`permissions`」——后者在本 Story 下同样安全（首条 catch-all ask 已实测压住用户全局 permissions），且不牺牲工具面、天然规避 medium-2 的 V1 键陷阱；② 读取用户全局配置复用 core 解析规则（两文件名 + JSONC + `OPENCODE_CONFIG_DIR` 未设前提），或直接拒绝并提示。

## 已闭合项（不计分，源码复核成立）

1. **载体选型与「整体替换语义」论证成立**（r3-critical 正面）：core 只消费 `OPENCODE_CONFIG_DIR`（`core/src/global.ts:63-65` → config `globalDirectory`，`core/src/config.ts:173`）；core 的 config→AgentV2 注册链完整（`core/src/config.ts:142` names 两文件 → `core/src/config/plugin/agent.ts:80-113` 读 `agents` + `permissions`，键形 `core/src/config/agent.ts:13-24` → `schema` V2 `{action,resource,effect}`）；不并入默认模型则 `ModelNotSelectedError`（`core/src/session/runner/model.ts:190-203`，`Config.latest(entries,"model")` 见 `core/src/config/plugin/provider.ts:45-49`）。凭据不受影响（auth 在 `Global.Path.data`，非 config）。
2. **r3-m3 收口稳健**（实测）：`core/src/config/plugin/agent.ts:70-78`（全局/项目顶层 permissions 推入所有 agent）+ `:88-90`（新 agent 先全局后自身）→ 首条 `{*:*,ask}` 位于 agent 规则最前，findLast（`core/src/permission.ts:76-86`）下压住用户全局 allow；用户真实全局 3 条 `external_directory` allow 为证。
3. **越界动作名正确**：外部路径的 `external_directory` 断言与 `<绝对目录>/*` 资源形态（`core/src/location-mutation.ts:29-42,137-147`；`core/src/tool/read.ts:60-68`）→ 验收 4「硬拒」措辞（deny → `BlockedError`，`core/src/permission.ts:197-205`）与新语义一致。
4. **`serve_cursor` 方案消歧**：列 + 规则 4 显式「不依赖镜像行反推」（r3-l1）。
5. **错误码四枚举 + SSE 帧形 + 列表过滤**（r3-l2 主项）：行 30/32/33。
6. **P1a/b/c 拆分各配 fallback**（r3-m2 主项）：行 41-43；P2/P3 保留。
7. **措辞修正**（r3 低-3）：SSE 净新增（行 25）、capabilities 启用（行 23）——源码侧 `packages/worker-core/src/profile.ts` 枚举已含 `interactive`（r3 §8 已核）。
8. **Epic 四条验收 + 决策 C/D 覆盖未回退**：验收 1-4 ↔ `epic-spec.md:193` S2b1 ①-④；偏离清单 4 条齐备（行 8）；决策 C 重释（durable 镜像）与决策 D 能力等价（自起常驻 serve + 密码）仍成立。
9. **生命周期与缓存一致性**：生成文件随 ATD 启动重写 + serve 生命周期内 workspace 集不变（行 21）+ location 配置打开时读一次并缓存（`core/src/config.ts:175-176`，背景⑧）三者自洽——serve 随 ATD 重启使缓存必然刷新，无「运行期新增 workspace 读不到」的隐性缺口（该缺口已被显式记为边界）。

## 观测（不计分）

1. **标签一致性**：行 4/23/25 引用的 `r3-l4` 在 r3 报告中不存在（r3 仅 低-1/低-2/低-3，措辞项为低-3；低-4 是「serve 启动失败降级」，已在 v4 闭合）。审计链标签宜校正，便于逐轮追溯。
2. **r3 建议的 P1a 判据未承接**：`GET /api/agent` 端点存在（`protocol/src/groups/agent.ts:7-10`，location 中间件 + 返回 `Agent.Info[]`），建议并入 P1a 的第一判据（比「会话事件流可见 agent 生效」更直接可断言）。
3. **澄清③边界宜写进验收 3**：`OPENCODE_CONFIG_DIR` 只改 `Global.config`（`core/src/global.ts:59-72`），data/cache/state/tmp 仍在 xdg 共享目录 → 「配置隔离 ≠ 数据隔离」（会话/日志落共享目录属澄清③范围）。验收 3 文义易被读成全面隔离。
4. **本仓 workspace 当前无 readable 仓**（`workspaces/atd.yaml:7-10` 仅主仓），故 medium-1 在自吃场景暂不可触发，但 S2w1 验收与 Epic 白名单语义要求双仓形态，P1c 需用双仓夹具（可复用 `apps/server/test/workspaces.test.ts:27` 的临时双仓构造）。

## 结论

# REJECT

状态：SPEC_REVIEWING → SPEC_DRAFT

> r3 八项中 **4 项（含 critical）完全闭合 / 3 项部分闭合 / 1 项未回退（本已闭合）**：载体换 `OPENCODE_CONFIG_DIR` + 生成文件的论证经源码复核成立且正确（r3-critical 闭合）；r3-m3 的 catch-all ask 收口经**用户真实全局配置实测**验证稳健；r3-l1（`serve_cursor`）、低-3（措辞）闭合。**r4 新核出 2 处 medium**：① 规则 3 ④「readable 仓前缀=相对主仓路径形态」在外部仓上永不命中（外部资源为绝对路径 + 先走 `external_directory`），② 被全量 deny 硬拒，与验收 4 冲突；② 生成文件键形约束缺失——`provider`（单数）为 V1 触发键，混入致整文件按 V1 迁移、V2 `agents` 被静默丢弃（r3-critical 失效链原样复现），风险表第 4 行未覆盖。另 4 处 low（P1a fallback/24h 主体、项目级配置读入无开关、`deleted_at` 详情/事件读语义、合并键集白名单过窄 + 读取路径硬编码）。**修订无需推翻路径②/载体选型**：规则 3 ④ 改绝对前缀 + `external_directory` 动作、生成文件写死 V2 键形约束即可回 SPEC_REVIEWING。未修改 spec 正文与任何业务代码。
