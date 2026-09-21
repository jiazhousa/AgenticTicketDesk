#!/bin/sh
# fence 脚本模板——ocp init 铺设至 {wf}/fence.sh，按项目技术栈改写各步骤后使用。
# fence（测试围栏，A 仓 10-composition「测试围栏编排」）：全部编码任务块完成后代码冻结，
# 跑全量单测 + E2E 作为客观产物；修复涉及生产代码则必须重跑。报告落 test-fence-reports/（已入 .gitignore）。
set -u

REPORT_DIR="test-fence-reports"
PASS=1

# run_step <名称> <命令...>：串行执行步骤，失败不短路（全部跑完汇总），输出与日志落 REPORT_DIR。
run_step() {
  name="$1"
  shift
  log="${REPORT_DIR}/fence-$(date +%Y%m%d-%H%M%S)-${name}.log"
  echo "[fence] ${name} 开始：$*"
  if "$@" >"${log}" 2>&1; then
    echo "[fence] ${name}：PASS"
  else
    echo "[fence] ${name}：FAIL（日志：${log}）"
    PASS=0
  fi
}

mkdir -p "${REPORT_DIR}"

# ---- 以下为占位步骤：按项目技术栈改写命令（增删步骤同理），保持可独立编译/运行的语义 ----
run_step typecheck echo "TODO: 替换为项目 typecheck 命令"
run_step test echo "TODO: 替换为项目全量单测命令"
run_step e2e echo "TODO: 替换为项目 E2E 命令（如无 E2E 可删除本行）"

if [ "${PASS}" -eq 1 ]; then
  echo "[fence] PASS"
  exit 0
fi
echo "[fence] FAIL"
exit 1
