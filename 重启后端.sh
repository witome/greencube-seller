#!/usr/bin/env bash
# 重启后端（规范动作）
# 用途：本机 3001 上跑的后端实例必须重启才会加载新代码——源码改了不重启 = 改了不生效。
#
# 用法（在 Git Bash 里，项目根目录）：
#   bash 重启后端.sh
#   PORT=3011 bash 重启后端.sh      # 换端口起临时实例
#
# 做三件事：① 杀掉占用端口的旧实例 ② 先构建一遍（兜底）③ 以 watch 模式后台启动并等就绪
#
# 注：请在**交互式终端**（Git Bash 窗口）里运行。若在自动化 shell（如 AI 代理的一次性命令）里调用，
#     后台子进程可能随该 shell 结束被回收——那种场景请改用 Windows 的 Start-Process 拉起常驻进程。
set -uo pipefail

PORT="${PORT:-3001}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend" || { echo "❌ 找不到 backend 目录"; exit 1; }
LOG="${TEMP:-/tmp}/lvlifang-backend-${PORT}.log"

echo "=== 重启后端（端口 $PORT）==="

# ── 1. 停掉占用端口的旧实例 ──
PIDS="$(netstat -ano 2>/dev/null | grep -E ":${PORT}[[:space:]]+.*LISTENING" | awk '{print $NF}' | sort -u)"
if [ -n "$PIDS" ]; then
  for p in $PIDS; do
    echo "  停止旧实例 PID $p"
    MSYS_NO_PATHCONV=1 taskkill /PID "$p" /F >/dev/null 2>&1 || echo "  （PID $p 停止失败，可能已退出）"
  done
  sleep 2
else
  echo "  端口 $PORT 当前无人监听"
fi

# ── 2. 先构建：即使 watch 没生效，dist 也是最新代码 ──
echo "  构建中…"
if ! npm run build >/dev/null 2>&1; then
  echo "  ❌ 构建失败，已中止（不会用旧代码启动）"
  npm run build 2>&1 | tail -20
  exit 1
fi
echo "  ✅ 构建完成"

# ── 3. 以 watch 模式后台启动（源码改动自动重编译 + 重启）──
echo "  启动中（watch 模式）…"
nohup node node_modules/@nestjs/cli/bin/nest.js start --watch >"$LOG" 2>&1 &
NEW_PID=$!
echo "  已拉起 PID $NEW_PID，日志：$LOG"

# ── 4. 等待端口就绪 ──
for i in $(seq 1 60); do
  sleep 1
  if netstat -ano 2>/dev/null | grep -qE ":${PORT}[[:space:]]+.*LISTENING"; then
    echo "  ✅ 后端就绪（${i}s）：http://localhost:${PORT}/api/v1"
    echo
    echo "提示：以后改完后端源码，watch 会自动生效；若发现改了不生效，重跑本脚本即可。"
    exit 0
  fi
done

echo "  ❌ 等待 60s 仍未监听，日志末尾："
tail -30 "$LOG"
exit 1
