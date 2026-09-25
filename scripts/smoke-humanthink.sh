#!/usr/bin/env bash
# humanthink 真 serve 冒烟（S2b1 交付验收用，不进 fence）
# 步骤对齐 .specpipe/plans/atd-s2b1-humanthink/probe-report.md 探针：
# 私有配置目录 + 独立密码起 serve → 健康 → 建会话 → prompt →
# 断言①事件信封 durable.seq 存在（text.ended 为全文主源）
# 断言②message 端点形态（user/assistant 文本可取）
# 断言③视野外读硬拒（tool.failed error.type=permission.rejected）
# 用法：bash scripts/smoke-humanthink.sh [port]（缺省 4991）
set -euo pipefail

PORT="${1:-4991}"
PW="smoke-$(date +%s)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d /tmp/opencode/ht-smoke-XXXXXX)"
CONFIG_DIR="$WORK/config"
SESSION_DIR="$WORK/session"
mkdir -p "$CONFIG_DIR" "$SESSION_DIR"
SERVE_PID=""

cleanup() {
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

echo "== [1/6] 生成 serve 配置（白名单合并用户全局 + atd-ht-smoke 五规则）"
python3 - "$CONFIG_DIR" "$SESSION_DIR" <<'PYEOF'
import json, os, sys
config_dir, session_dir = sys.argv[1], sys.argv[2]
user = {}
src = os.path.expanduser('~/.config/opencode/opencode.json')
if os.path.exists(src):
    user = json.load(open(src))
readable = os.path.dirname(os.path.abspath(session_dir))  # 冒烟专用 readable（工作目录父级）
rules = [
    {"action": "*", "resource": "*", "effect": "ask"},
    {"action": "external_directory", "resource": "/**", "effect": "deny"},
    {"action": "read", "resource": "*", "effect": "allow"},
    {"action": "external_directory", "resource": readable + "/*", "effect": "allow"},
    {"action": "read", "resource": readable + "/*", "effect": "allow"},
]
cfg = {}
if isinstance(user.get("model"), str): cfg["model"] = user["model"]
if isinstance(user.get("providers"), dict): cfg["providers"] = user["providers"]
elif isinstance(user.get("provider"), dict): cfg["providers"] = user["provider"]
cfg["agents"] = {"atd-ht-smoke": {"permissions": rules}}
json.dump(cfg, open(os.path.join(config_dir, 'opencode.json'), 'w'), indent=2)
print("   config:", os.path.join(config_dir, 'opencode.json'))
PYEOF

echo "== [2/6] 起 serve（127.0.0.1:$PORT，独立密码/配置目录）"
OPENCODE_SERVER_PASSWORD="$PW" OPENCODE_CONFIG_DIR="$CONFIG_DIR" \
  opencode serve --port "$PORT" --hostname 127.0.0.1 >"$WORK/serve.log" 2>&1 &
SERVE_PID=$!

echo "== [3/6] 健康探测（authed GET /api/agent，空列表正常）"
AUTH="opencode:$PW"
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" "http://127.0.0.1:$PORT/api/agent" || true)
  [ "$CODE" = "200" ] && break
  sleep 0.5
done
[ "$CODE" = "200" ] || fail "健康探测超时（最后状态 $CODE；serve 日志：$(tail -3 "$WORK/serve.log")）"
echo "   HTTP 200 OK"

echo "== [4/6] 建会话 + 订阅全局事件流 + 发 prompt"
SID=$(curl -s -u "$AUTH" -X POST "http://127.0.0.1:$PORT/api/session" \
  -H 'content-type: application/json' \
  -d "{\"agent\":\"atd-ht-smoke\",\"location\":{\"directory\":\"$SESSION_DIR\"},\"title\":\"smoke\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
[ -n "$SID" ] || fail "建会话失败"
echo "   session: $SID"
curl -s -N -u "$AUTH" "http://127.0.0.1:$PORT/api/event" >"$WORK/events.log" 2>&1 &
CURL_PID=$!
sleep 1
curl -s -u "$AUTH" -X POST "http://127.0.0.1:$PORT/api/session/$SID/prompt" \
  -H 'content-type: application/json' \
  -d '{"text":"Use the read tool on the file /etc/hostname (absolute path). Then reply with the single word DONE."}' >/dev/null
echo "   prompt 已发送，等待执行完成…"

echo "== [5/6] 等待轮次结束（idle 消息出现，最多 90s）"
for i in $(seq 1 90); do
  DONE=$(curl -s -u "$AUTH" "http://127.0.0.1:$PORT/api/session/$SID/message?limit=5" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(any(m.get("type")=="idle" for m in d))' || true)
  [ "$DONE" = "True" ] && break
  sleep 1
done
kill "$CURL_PID" 2>/dev/null || true
[ "$DONE" = "True" ] || fail "轮次未在 90s 内完成"

echo "== [6/6] 三断言"
python3 - "$WORK" "$SID" <<'PYEOF'
import json, sys
work, sid = sys.argv[1], sys.argv[2]
errors = []

# 断言①：事件信封 durable.seq 存在（text.ended 全文主源）
has_text_ended, has_durable = False, False
for line in open(f"{work}/events.log"):
    line = line.strip()
    if not line.startswith("data: "):
        continue
    try:
        ev = json.loads(line[6:])
    except Exception:
        continue
    if ev.get("type") == "session.text.ended":
        has_text_ended = True
        if isinstance(ev.get("durable", {}).get("seq"), int):
            has_durable = True
        if not isinstance(ev.get("data", {}).get("text"), str):
            errors.append("text.ended.data.text 非字符串")
if not has_text_ended:
    errors.append("全局流未见 session.text.ended")
elif not has_durable:
    errors.append("text.ended 缺失 durable.seq 信封")

# 断言②③经 events.log 的 tool.failed + message 形态
has_perm_reject = any(
    line.startswith("data: ")
    and '"session.tool.failed"' in line
    and '"permission.rejected"' in line
    for line in open(f"{work}/events.log")
)
if not has_perm_reject:
    errors.append("视野外读未产生 tool.failed(permission.rejected) 硬拒")

if errors:
    print("SMOKE FAIL:", "; ".join(errors))
    sys.exit(1)
print("   ① durable.seq 信封存在 ✓")
print("   ② 视野外硬拒（tool.failed permission.rejected）✓")
PYEOF

# message 端点形态断言（user/assistant 文本可取）
curl -s -u "$AUTH" "http://127.0.0.1:$PORT/api/session/$SID/message?limit=50&order=asc" \
  | python3 -c '
import json, sys
page = json.load(sys.stdin)
assert isinstance(page.get("data"), list) and isinstance(page.get("cursor"), dict), "message 响应形态异常"
kinds = {m.get("type") for m in page["data"]}
assert "user" in kinds and "assistant" in kinds, f"消息类型不全：{kinds}"
# 末条含 text 分段的 assistant（工具轮次的首条 assistant 可能只有 reasoning/tool）
texts = [
    p.get("text", "")
    for m in page["data"]
    if m.get("type") == "assistant"
    for p in m.get("content", [])
    if p.get("type") == "text"
]
assert any(t.strip() for t in texts), "全部 assistant 消息均无 text 分段"
print("   ③ message 端点形态（user/assistant/content.text + cursor）✓")
' || fail "message 形态断言失败"

echo "SMOKE PASS ✅（serve/会话/prompt/事件信封/硬拒/message 形态全部符合）"
