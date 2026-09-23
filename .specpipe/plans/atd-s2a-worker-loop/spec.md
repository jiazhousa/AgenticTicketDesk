# Story Spec：S2a Worker 层 + 解单闭环

- **topic**：atd-s2a-worker-loop
- **Epic**：agentic-ticket-desk（v4 §9 S2a 行为范围来源；§4.4 Worker 抽象 / §6 MUST 条款为上位约束）
- **状态**：v4（r3 残余 N1-N6 清理），SPEC_USER_AUDIT 待放行
- **日期**：2026-09-22
- **实测契约依据**：`opencode run --format json` 事件流已采样（§3.3）

---

## 1. 背景与定位

S1 交付工单核心域（无执行）。S2a 接上执行层：**TASK 单放行后由 worker（OpenCode 首实现）在独立 worktree 解单、产出 commit 与结构化报告、正常关单或卡点升级**——本系统第一次真正「Agent 解单」。聊天框（interactive）属 S2b。

## 2. 范围

**做**（10 项）：
1. `packages/worker-core`：统一事件流类型（HarnessV1 命名）+ WorkerProfile yaml schema + Registry（加载/校验/注册表，含模板推送 token 校验与凭据扫描）+ Worker 生命周期接口位（`doPromptTurn/doStop/doDestroy` 保留声明，S2a task 模式仅实现 spawn+wait+kill，interactive/S3 扩展）
2. `packages/worker-opencode`：预置 profile + spawn-CLI 协议实现（task 模式）
3. worktree 管理（编排层独占：分配/复用/回收；worktree 建在 ATD 管理目录，不动目标仓文件）
4. dispatch 编排：放行前置三件套校验 → 建 worktree → spawn → 事件流落盘 → IN_PROGRESS → 进程结束 → 读报告 → DONE / BLOCKED / FAILED
5. 状态机扩展：BLOCKED(pending:l3)、FAILED 两态 + 转移边 + pendingLabel 字段启用
6. 卡点路由：L3 升级（BLOCKER 单创建/关联/裁决三路含改派）；L2 基础（超时/崩溃判定表 + 报告缺陷重试 1 次）；L1 留痕=事件流与报告本身（无独立机制）
7. 完成报告契约：`atd-report.json` schema 化 + commit 关联落库（以 git 实测为准）
8. `config.yaml`（项目根，启动缺失则报错；仓注册单仓：`repoPath` / `dataDir`（默认 `~/.local/share/atd`，日志/worktree/prompt 均其下）/ `defaultTimeoutMin` / `retryOnReportMiss`（默认 1））
9. MUST 六条实现点（§6）
10. UI 增量：worker 绑定/事件流尾部/报告卡/BLOCKER 裁决/放行选 worker

**不做**：interactive 与聊天框（S2b）；pending:agent 与重试引擎（S3）；worktree 池与文件集校验（S3）；DREAM/审计（S4）；多仓；发布产物。

## 3. 核心契约

### 3.1 WorkerProfile（`workers/*.yaml`，随仓版本化）

```yaml
id: opencode            # 唯一标识
name: OpenCode          # 展示名
protocol: spawn-cli     # S2a 仅实现 spawn-cli
capabilities: [task]    # interactive 随 S2b
command: opencode run --standalone --format json {{prompt}}
timeoutMin: 30          # 超时 → 杀进程树 → FAILED
```

- Registry 启动加载 `workers/` 全部 yaml；schema 校验失败启动报错
- **模板校验（MUST-3）**：含 `git push`/`remote`/`push -` 等推送类 token → 注册拒绝
- **凭据扫描（MUST-6）**：yaml 值含疑似 API key/token 模式（长随机串/`sk-`/`glpat-` 前缀等）→ 注册拒绝
- 预置 `workers/opencode.yaml`；用户自建 yaml 即接入（零代码）
- **spawn 以参数数组执行不经 shell**：`{{worktree}}`/`{{prompt}}` 由编排层替换为单参数（prompt 为完整字符串，读自 prompt 文件），无注入面

### 3.2 统一事件流（HarnessV1 命名对齐）

`text-start / text-delta / text-end / tool-call / tool-result / finish`（+ 内部 turn-start/turn-end）。opencode 事件映射：

| opencode 事件（实测） | 统一事件 |
|---|---|
| `step_start` | turn-start |
| `text`（整段） | text-start → text-delta(全文一次) → text-end |
| `tool_use`（state=completed） | tool-call + tool-result |
| `tool_use`（state=error） | tool-call + tool-result（携带 error 标记） |
| `step_finish` | turn-end |
| 进程退出（code=0） | finish(success) |

- 每轮 spawn 独立日志对：`data/logs/t{id}.r{n}.raw.jsonl` / `.events.jsonl`（n=执行轮次，首轮 1；**append 不覆盖**，MUST-5）；**raw 首行为执行元数据**（命令/env 注入摘要/基线 HEAD/轮次/timeoutMin——MUST-2 审计载体：permission 注入内容可见）；工单详情轮次列表可查
- 退出码非 0 → FAILED（崩溃不重试）；退出码 0 时以报告文件为准（stdout finish 事件由编排层补记留痕、仅审计用途——B6 锚点依赖此口径）

### 3.3 opencode 原生事件形态（实测样本，解析依据）

```
{"type":"step_start","timestamp":ms,"sessionID":"ses_*","part":{"type":"step-start","snapshot":"<git-tree-sha>"}}
{"type":"tool_use",...,"part":{"type":"tool","tool":"write","state":{"status":"completed","input":{...},"output":"..."},"time":{"start","end"}}}
{"type":"step_finish",...,"part":{"type":"step-finish","reason":"tool-calls|stop","cost":n,"tokens":{"input","output","reasoning","cache"}}}
{"type":"text",...,"part":{"type":"text","text":"...","time":{...}}}
```

### 3.4 完成报告（worker 在 worktree 根写 `atd-report.json`）

```json
{
  "status": "done | blocked",
  "summary": "一句话完成摘要（中文）",
  "commits": ["<sha>"],
  "blockReason": "卡点说明（blocked 时必填）：上下文+建议选项+影响面"
}
```

- prompt 注入 schema 与写入要求（prompt=spec 快照 + 报告要求 + 完成定义，编排层构造落临时文件）
- 进程正常结束后读文件 + zod 校验；commit 落库规则：**以 git 实测为准**（`git -C worktree log --format=%H` 对比 spawn 前基线 HEAD），报告 commits 仅作交叉校验（多余项留痕不采信）

### 3.5 状态机扩展（S1 六态之上；FAILED 入边不新增、保持 Epic §5 口径）

```
IN_PROGRESS → BLOCKED(pending:l3)   （L3 升级：报告 blocked / 报告缺陷重试耗尽）
IN_PROGRESS → FAILED                （worker 崩溃/超时/退出码非 0——Epic 两入边之一）
BLOCKED(pending:l3) → IN_PROGRESS   （裁决=继续：原 worktree 换轮次重新 spawn）
BLOCKED(pending:l3) → DISPATCHED    （裁决=改派：原 worktree 复用，换 worker profile 重新走 §4 步 2-5）
BLOCKED(pending:l3) → FAILED        （裁决=终止——Epic 两入边之二）
BLOCKED → CANCELLED                 （人为取消，Epic §5 已有）
```

- tickets 加 `pendingLabel TEXT NULL`（'l3'；S3 扩 'agent'）+ `worker_id`（S1 已建）+ `round INTEGER DEFAULT 0`（执行轮次）；**转出 BLOCKED 时 pendingLabel 置 NULL**
- BLOCKED(pending:l3) 存续期间恰好对应一张未关 BLOCKER 单（编排层保证）

### 3.6 BLOCKER 单生命周期（type=BLOCKER）

- 创建：L3 升级时自动建（title=`卡点: {父单标题}`，首条留言=blockReason 全文，blockedBy 挂父单），初始 IN_PROGRESS（绑定"人"）
- 关单：人留言结论 → 关单时选裁决：**继续 / 改派（选新 worker）/ 终止** → 按上表转移父单
- 不建 worktree、不绑 worker、无子单

### 3.7 失败判定表（进程结束后分流；**自上而下首个命中**）

| 情形 | 处置 |
|---|---|
| 退出码 0 + 报告 done + schema 过 | DONE（commits 落库） |
| 退出码 0 + 报告 blocked | L3 → BLOCKED(pending:l3) + BLOCKER 单 |
| 退出码 0 + 报告缺失/schema 错 | L2 重试 1 次（round+1 同 worktree 重 spawn）；再失败 → L3 |
| 退出码非 0 / stdout 无 finish | FAILED（崩溃，不重试——异常往往是环境性的） |
| 超时（timeoutMin） | 杀进程树（SIGTERM→3s→SIGKILL）→ FAILED |

### 3.8 worktree 管理（编排层独占）

- 路径：`{dataDir}/worktrees/{repoName}-t{id}`（**ATD 管理目录，不在目标仓内**——不动目标仓任何文件；分支 `atd/t{id}` 建在目标仓 refs，属正常 git 操作）
- 分配：放行时 `git -C {repo} worktree add <path> -b atd/t{id} <基线>`；**已存在同名单则复用**（改派/继续场景，分支与半成品保留）
- 基线：父 STORY 无则 repo 默认分支 HEAD；有父则父单最近 commit 所在分支 HEAD（S2a 简化：一律 repo 默认分支 HEAD，记录于 impl）
- 回收：`DELETE /api/tickets/:id/worktree?keepBranch=true|false`——默认 keepBranch=true（删 worktree 目录、留 atd/t{id} 分支与 commit）；false 时连分支删（commit 已在报告/关联表不受影响）

## 4. dispatch 编排流程（放行前置三件套 + 执行）

```
transition(to=DISPATCHED) 的前置校验（与 blockedBy 门同级，任一失败 422 不转移）：
  ① worker_id 非空（UI 放行时必选）
  ② blockedBy 全 DONE（S1 既有）
  ③ worktree 可建（路径可写 / 目标仓可访问）

转移成功后（异步执行）：
  1. 建/复用 worktree（运行期失败 → IN_PROGRESS→FAILED，见步骤 4 后的时序说明）
  2. 清理 worktree 内陈旧 atd-report.json（防复用场景误读旧报告）→ 记录本轮基线 HEAD（=worktree 当前 HEAD）→ 构造 prompt 文件（worktree 外 data/prompts/t{id}.r{n}.md）
  3. 渲染 profile 命令（参数数组）→ spawn（cwd=worktree，env 注入 §6-MUST2 配置）
  4. **spawn 发起成功（进程存在）即 IN_PROGRESS（round+1）**——进入点是执行启动而非首个事件；此后一切终局（正常结束/崩溃/超时/kill）都发生在 IN_PROGRESS 态，FAILED 仅走 IN_PROGRESS→FAILED 单边，与 Epic §5 口径一致
  5. 进程结束 → 按 §3.7 判定表分流

多轮基线与归集：每轮 spawn 前记录自己的基线 HEAD；该轮新增 commits=基线 diff；工单级 commit 关联=各轮并集（按轮落 ticket_commits，含轮次列）。报告 done 但零 commit 合法（如纯调研任务），summary 说明即可，不做硬校验。
**pre-spawn 失败路径**（worktree 运行期建失败 / spawn 发起失败 / 服务重启时 DISPATCHED 停留单）：单尚未进入 IN_PROGRESS，走 **DISPATCHED→CANCELLED** + system 留言「派发失败：<原因>，可重新放行」——语义诚实（执行未开始，回到可重派状态；FAILED 留给已开始执行的不可恢复终止）。pending:agent 技术性等待语义随 S3 接管该场景。
服务重启恢复：启动时扫描处于 DISPATCHED/IN_PROGRESS 的执行单（进程已随重启消亡）→ IN_PROGRESS 的走 IN_PROGRESS→FAILED + 留言「服务重启中断」（重试语义 S3）；DISPATCHED 停留的按上段 CANCELLED。
改派/继续：均从 BLOCKED(pending:l3) 出发，复用原 worktree 走步 2-5（改派仅换 profile）。
IN_PROGRESS 语义注记：本 Story 起 IN_PROGRESS 进入点=spawn 发起（Epic §5 注记「已产出首个事件」的表述以本口径为准，Epic 侧随下次修订同步）。
```

## 5. UI 增量（详情页）

- 放行弹层：选 worker（Registry 列表）→ 提交触发 transition（三件套失败 422 提示）
- worker 卡：profile/轮次/启动时间/事件流尾部（text 与工具名滚动，不展开参数）
- 报告卡：DONE 显示 summary+commits（sha 文本）
- BLOCKED 卡：BLOCKER 子单入口 + 关单裁决三选（继续/改派选 profile/终止）
- 卡点队列：列表页 type=BLOCKER 筛选（复用既有筛选器）

## 6. MUST 条款实现点对照（Epic §6）

| MUST | 实现点 |
|---|---|
| 1 worktree 硬校验 | 放行前置③ + 运行期失败走 FAILED；绝不裸 spawn |
| 2 宿主侧权限收口 | 编排层生成 opencode 配置（permission 对象规则：**bash catch-all allow（无人值守必需——ask 在无头下=auto-reject 全拒，B1 实证 r4）+ 推送类 deny 后置覆盖（last-match-wins）+ edit/write allow**），环境变量注入（OPENCODE_CONFIG_CONTENT 内联优先/OPENCODE_CONFIG 文件 fallback，CONTENT 实测生效——r5 auto-reject 证明注入在管权限）；注入摘要记 raw 首行可审计 |
| 3 无 push 通道 | 模板校验拒推送 token；ATD 代码零 push 路径 |
| 4 worktree 编排层独占 | 路径/分支仅 dispatch 与回收 API 触达；spawn cwd 限定 worktree |
| 5 输出全落盘 | 每轮双 JSONL（t{id}.r{n}.*），关单前不清理 |
| 6 凭据不进 profile | Registry 凭据扫描拒注册；opencode 用其全局凭证体系，profile 零凭据字段 |

## 7. 验收标准

| # | 条目 |
|---|---|
| B1 | 全链：建 TASK→选 opencode→提交 spec→放行（三件套过）→自动建 worktree→spawn→IN_PROGRESS→真实小任务（目标仓写文件+commit）→报告 done→git 实测 commits 落库→DONE；worktree 内可见 commit |
| B2 | MUST-1：worktree 前置失败（dataDir 只读）→放行 422，状态留 SPEC_READY，无 spawn |
| B3a | 卡点-终止：必然 blocked 的任务→父单 BLOCKED(pending:l3)+BLOCKER 单（含 blockReason）→关 BLOCKER 选终止→父单 FAILED |
| B3b | 卡点-继续：同上构造→选继续→原 worktree round+1 重新 spawn→DONE |
| B3c | 卡点-改派：同上构造→选改派（换临时 profile）→原 worktree 复用（分支延续）新 profile spawn→DONE |
| B4 | 崩溃：临时 profile 命令 `node -e "process.exit(1)"` → FAILED；t{id}.r1 双 JSONL 落盘 |
| B5 | 超时：timeoutMin=1 临时 profile + sleep 任务 → 杀进程树 → FAILED |
| B6 | 报告缺失：prompt 明示不写报告→L2 重试（round=2 可见）→仍缺→L3 BLOCKER |
| B7 | 注册防护：含 `git push` 的 yaml / 含疑似 token 的 yaml → 注册拒绝且报错可读 |
| B8 | 回收：keepBranch=true → worktree 删/分支留；false → 双删；commit 关联不受影响 |
| B9 | MUST-2 审计：任意一轮 raw.jsonl 首行执行元数据含 permission 注入摘要（deny 规则可见），且单测断言注入内容含正确 deny 规则（如 `git*push*`）。注：MUST-2 仅约束经 opencode 工具层的操作——profile 直跑外部命令（node/bash）不经该层，此类约束依赖 MUST-3 模板校验与 profile 人工审查（适用边界如实记录） |
| B6 补充 | 重试耗尽型 BLOCKER 的首条留言来源=「报告缺失/格式错误，重试 1 次后仍失败」+ 最后一轮 raw 日志路径 |

## 8. 非目标重申

无 interactive/聊天框、无 pending:agent、无并行池、无文件集校验、无 DREAM、无多仓、无发布产物。

## 9. 开放点（Builder 按倾向执行，无需等待）

- MUST-2 环境注入的具体键名：以 opencode 官方文档实测为准，落实后记录 impl
- 事件流 UI 呈现粒度：文本与工具名即可
- 多轮事件的轮次入口 UI：轮次下拉即可
