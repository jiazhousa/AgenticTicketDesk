# S2b1 动工前验证报告（P1a/P1b/P1c 探针）

- **日期**：2026-09-25
- **执行**：调度者（真机二进制实测，spec v7「动工前验证」节）
- **环境**：探针 serve（127.0.0.1:4990，独立密码，`OPENCODE_CONFIG_DIR` 私有配置目录）；对照源码快照 /home/starlex/project/opencode（1.18.21 系）
- **结论**：**三项探针全部通过**，路径②（V2 agent 级动态权限）端到端成立；另录得 8 项与源码快照的二进制漂移/事实，impl 必须照此执行（快照与调研口径以此为准修正）

## 探针结果

| 项 | 内容 | 结果 |
|---|---|---|
| P1a | 动态 agent 注册：OPENCODE_CONFIG_DIR + 生成 opencode.json（V2 键形 `agents.atd-ht-probe` + 合并用户全局 model/providers）→ serve 起 → agent 可见、会话可用 | ✅ 注册成功；模型可用（无 ModelNotSelectedError） |
| P1b | 三档行为：视野内读=自由；视野外读=硬拒（`permission.rejected: "Permission denied: external_directory"`，无弹审）；敏感动作=ask | ✅ 三档全部实测符合 |
| P1c | 请示闭环：bash→ask 挂起（会话级待审可查）→ reply reject → 模型继续输出新消息（会话不死） | ✅ 全链通过 |

## 权限规则实测口径（P1b 定案）

- 规则形状 `{action, resource, effect}`，effect ∈ ask/allow/deny
- **动作词汇**：`shell`（bash 工具）、`read`（相对路径）、`external_directory`（绝对路径，外部仓/越界）
- **通配必须是 `{"action":"*","resource":"*","effect":"ask"}`——`"*:*"` 形态永不匹配（实测教训）**
- **本二进制无匹配默认=allow**（与源码快照的默认 ask 相反——实测：错误通配下 bash 直接放行）→ **catch-all ask 为强制硬编码项**，无它则三档语义崩塌
- findLast 后置胜出实测成立：`external_directory deny /**` + `external_directory allow <仓绝对路径>/*` 组合正确放行/拒绝

## 二进制漂移与事实清单（impl 契约依据，覆盖快照口径）

0. **（r1 审查后补录）`session.text.ended` 存在且为镜像全文主源**：`data.text` 载全文 + 事件信封带 **`durable:{aggregateID, seq, version}`**（serve 侧持久序号，镜像幂等键与游标原生依据）；`session.tool.failed` 存在（read 被拒后模型 shell 兜底失败实测）；`session.reasoning.ended` 存在（全文载荷以 Builder 实测为准）

1. **prompt 请求体字段是 `text`**（非快照的 `prompt`；错误字段返回 `Missing key ["text"]`）
2. **事件名前缀 `session.*`**（非快照 `session.next.*`）：`session.text.delta`、`session.reasoning.{started,delta,ended}`、`session.step.{started,streamed,ended}`、`session.tool.{input.started,input.ended,called,progress,success}`、`session.usage.updated`；权限事件 `permission.{asked,rejected}`——均在全局 `/api/event`
3. **无 per-session 事件端点、无 /history 端点**（快照有、二进制无）——durable 回放走 `GET /api/session/:id/message`（+ `/message/:messageID` 详情；列表不含 payload，详情待 impl 核形状）
4. **全局 `/api/event` 可用**（server.connected + heartbeat + 全事件流）；SSE 与普通端点同用 Basic auth（`?auth_token=` 未用）
5. **权限待审查询**：会话级 `GET /api/session/:id/permission`（实测返回 pending 请求：id/action/resources/save/source）与全局 `GET /api/permission/request` 均可用
6. **审批决策枚举 `once / always / reject`**（+可选 message）——「当次批准/永久批准/拒绝」，与 spec 业务规则 4「裁决只对当次生效」对应 UI 取 once/reject 两档，always 显式不提供（防静默授权扩散）
7. **已存权限（saved）按 projectID 作用域共享于同数据目录**：ATD serve 与用户自用服务在同一项目目录下共享 saved 规则——单用户可接受，但「always」决策会跨 ATD 聊天与用户自用会话生效，故上一条 always 不开放
8. **agent 列表瞬时性**：`GET /api/agent` 在 serve 刚起时可返回空（实例惰性加载），稍后/行为面正常——ATD 侧不依赖该列表做功能（仅诊断），无需重试逻辑

## 对 spec 的回注

- 业务规则 3「行为三档」实测成立；规则 4「裁决粒度」与 reply 枚举对齐（UI 只出 once/reject）
- 风险表「权限规则表达不了视野语义」——**已消除**（探针实证）
- 技术锚点补充：drift 清单 1-8 为 impl 契约唯一事实源（优先级高于源码快照与既往调研口径）
