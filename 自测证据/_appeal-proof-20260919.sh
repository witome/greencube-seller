#!/usr/bin/env bash
# 卡E 取证：申诉内容与附件必须入库（决策 6 · 2026-09-19）
# 运行：bash 自测证据/_appeal-proof-20260919.sh   （需后端已启动在 3001 端口）
#
# 全程用 **curl** 打真实 HTTP 接口；落库事实用 **SQL 直查** 证明（不只看接口返回）。
#
# ⚠️ 本机三个坑（均已规避，写在脚本里避免下次再踩）：
#   1. 环境变量 http_proxy/https_proxy 指向沙箱代理 → curl 打 localhost 报
#      「upstream connect failed」，必须加 --noproxy '*'
#   2. **curl 的 argv 编码会破坏中文**（Git Bash 传参给原生 curl.exe 时按系统码页转换）：
#      直接 curl -d '{"text":"中文"}' 落库会变成乱码。⇒ 所有带中文的 body 一律先落成
#      UTF-8 文件，再 curl -d @<文件>（文件路径必须是 Windows 形式，MSYS_NO_PATHCONV=1）
#   3. node 读不了 MSYS 的 /tmp/xxx 路径，必须用 Windows 形式（故用 $TEMP）
set -uo pipefail

API=http://localhost:3001/api/v1
OUT="${TEMP:-/tmp}/appeal-proof"
mkdir -p "$OUT"
TS=$(date +%s)

# curl 包装：绕开沙箱代理
CURL() { curl -s --noproxy '*' -m 30 "$@"; }
# 以 UTF-8 文件投递 body（规避 argv 编码）
CURLJ() { # CURLJ <body文件> <其余 curl 参数...>
  local body="$1"; shift
  MSYS_NO_PATHCONV=1 CURL -H 'Content-Type: application/json' -d "@$body" "$@"
}
# 取 JSON 字段：jget <文件> <a.b.c>
jget() {
  node -e "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));let x=v;for(const k of process.argv[2].split('.'))x=(x==null?undefined:x[k]);console.log(x===undefined||x===null?'':String(x))" "$1" "$2"
}
# SQL 直查（需在 backend 目录下跑，才能解析 @prisma/client）
sqlq() {
  node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const r=await p.\$queryRawUnsafe(process.argv[1]);console.log(JSON.stringify(r,(k,v)=>typeof v==='bigint'?Number(v):v,2));await p.\$disconnect()})().catch(e=>{console.error('SQL_ERR',e.message);process.exit(1)})" "$1"
}
hr() { echo ""; echo "────────── $1 ──────────"; }
die() { echo ""; echo "❌ 取证中止：$1"; exit 1; }

echo "============================================================"
echo "卡E 取证 · 申诉入库 / 运营可查 / 权限反例"
echo "TS=$TS"
echo "============================================================"

# ══════════════════════════════════════════════════════════
# 0. 造一个「已被驳回」的采购方（申诉前置状态 REJECTED=3）
# ══════════════════════════════════════════════════════════
hr "0. 准备数据：注册采购方 → 运营驳回为 REJECTED(3)"

CURL -X POST "$API/auth/wx-login" -H 'Content-Type: application/json' \
  -d "{\"code\":\"appeal_$TS\"}" -o "$OUT/login_buyer.json"
BT=$(jget "$OUT/login_buyer.json" data.token)
[ -n "$BT" ] || die "采购方登录失败：$(cat "$OUT/login_buyer.json")"
echo "[0.1] 采购方 mock 登录成功 token = ${BT:0:24}…"

cat > "$OUT/body_register.json" <<EOF
{"shopName":"申诉取证餐馆$TS","contact":"取证员","phone":"139$(echo "$TS" | tail -c 9)","address":"申诉取证路 $TS 号"}
EOF
CURLJ "$OUT/body_register.json" -X POST "$API/buyer/register" -H "Authorization: Bearer $BT" \
  -o "$OUT/register.json"
PID=$(jget "$OUT/register.json" data.purchaserId)
[ -n "$PID" ] || die "注册失败：$(cat "$OUT/register.json")"
echo "[0.2] 注册返回：$(cat "$OUT/register.json")"
echo "      → purchaserId = $PID"

CURL -X POST "$API/auth/wx-login" -H 'Content-Type: application/json' \
  -d '{"code":"admin"}' -o "$OUT/login_admin.json"
AT=$(jget "$OUT/login_admin.json" data.token)
[ -n "$AT" ] || die "运营登录失败：$(cat "$OUT/login_admin.json")"

cat > "$OUT/body_verify.json" <<'EOF'
{"methods":[1],"result":2,"reasonCode":1,"reasonText":"营业执照不符（卡E 申诉取证）"}
EOF
CURLJ "$OUT/body_verify.json" -X POST "$API/admin/buyers/$PID/verify" -H "Authorization: Bearer $AT" \
  -o "$OUT/verify_reject.json"
echo "[0.3] 运营驳回：$(cat "$OUT/verify_reject.json")"

# ══════════════════════════════════════════════════════════
# 1. 采购方提交申诉（不带附件 —— 小程序端当前真实流程）
# ══════════════════════════════════════════════════════════
hr "1. curl 提交申诉（不带附件）"

cat > "$OUT/body_appeal.json" <<EOF
{"text":"卡E取证：我们执照当年年检已完成，附件我随后补，请运营再核一次。TS=$TS"}
EOF
echo "curl --noproxy '*' -X POST $API/buyer/appeal -H 'Authorization: Bearer <buyer>' \\"
echo "     -H 'Content-Type: application/json' -d @body_appeal.json"
echo "body_appeal.json = $(cat "$OUT/body_appeal.json")"
CURLJ "$OUT/body_appeal.json" -X POST "$API/buyer/appeal" -H "Authorization: Bearer $BT" \
  -o "$OUT/appeal_submit.json"
echo "→ 返回：$(cat "$OUT/appeal_submit.json")"
AID=$(jget "$OUT/appeal_submit.json" data.appealId)
[ -n "$AID" ] || die "提交申诉失败：$(cat "$OUT/appeal_submit.json")"
echo "→ appealId = $AID   （原实现恒为 0，现为真实自增 id）"

hr "2. SQL 直查 appeal_record —— 证明正文真进了库（含中文原样）"
cd "$(dirname "$0")/../backend" || die "找不到 backend 目录"
sqlq "SELECT id, purchaser_id, user_id, text, attachments, reason_code, reject_reason, status, created_at, handled_by, handled_at FROM appeal_record WHERE id = $AID"

# ══════════════════════════════════════════════════════════
# 3. 附件可存（为下一张「拍照留证」卡铺路）
# ══════════════════════════════════════════════════════════
hr "3. 附件可存性：另造一个被驳回采购方，带 attachments 提交"
CURL -X POST "$API/auth/wx-login" -H 'Content-Type: application/json' \
  -d "{\"code\":\"appeal2_$TS\"}" -o "$OUT/login_buyer2.json"
BT2=$(jget "$OUT/login_buyer2.json" data.token)
[ -n "$BT2" ] || die "采购方2 登录失败"

cat > "$OUT/body_register2.json" <<EOF
{"shopName":"申诉附件取证餐馆$TS","contact":"取证员二","phone":"138$(echo "$TS" | tail -c 9)","address":"申诉附件路 $TS 号"}
EOF
CURLJ "$OUT/body_register2.json" -X POST "$API/buyer/register" -H "Authorization: Bearer $BT2" \
  -o "$OUT/register2.json"
PID2=$(jget "$OUT/register2.json" data.purchaserId)
[ -n "$PID2" ] || die "注册2 失败：$(cat "$OUT/register2.json")"

cat > "$OUT/body_verify2.json" <<'EOF'
{"methods":[1],"result":2,"reasonCode":6,"reasonText":"资料不全（附件取证）"}
EOF
CURLJ "$OUT/body_verify2.json" -X POST "$API/admin/buyers/$PID2/verify" -H "Authorization: Bearer $AT" \
  -o "$OUT/verify_reject2.json"

cat > "$OUT/body_appeal2.json" <<EOF
{"text":"附件取证：补了执照年检页照片。TS=$TS","attachments":["https://example.com/license-2026.jpg","https://example.com/permit-2026.jpg"]}
EOF
CURLJ "$OUT/body_appeal2.json" -X POST "$API/buyer/appeal" -H "Authorization: Bearer $BT2" \
  -o "$OUT/appeal_submit2.json"
echo "→ 返回：$(cat "$OUT/appeal_submit2.json")"
AID2=$(jget "$OUT/appeal_submit2.json" data.appealId)
[ -n "$AID2" ] || die "带附件提交失败：$(cat "$OUT/appeal_submit2.json")"
sqlq "SELECT id, attachments, status FROM appeal_record WHERE id = $AID2"

# ══════════════════════════════════════════════════════════
# 4. 运营查询接口
# ══════════════════════════════════════════════════════════
hr "4. 运营查询：GET /admin/appeals?status=0"
echo "curl --noproxy '*' -s '$API/admin/appeals?status=0&pageSize=20' -H 'Authorization: Bearer <admin>'"
CURL "$API/admin/appeals?status=0&pageSize=20" -H "Authorization: Bearer $AT" -o "$OUT/admin_appeals.json"
echo "→ 返回：$(cat "$OUT/admin_appeals.json")"

echo ""
echo "[4.1] 命中刚提交的 appealId=$AID / $AID2（运营确实看得到正文与附件）"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const ids=[Number(process.argv[2]),Number(process.argv[3])];const hit=(r.data?.list||[]).filter(x=>ids.includes(x.appealId));console.log(JSON.stringify(hit,null,2))" "$OUT/admin_appeals.json" "$AID" "$AID2"

# ══════════════════════════════════════════════════════════
# 5. 权限反例
# ══════════════════════════════════════════════════════════
hr "5. 权限反例：采购方 token 调 /admin/appeals（期望 2002 无权限）"
echo "curl --noproxy '*' -s '$API/admin/appeals' -H 'Authorization: Bearer <buyer>'"
CURL "$API/admin/appeals" -H "Authorization: Bearer $BT" -o "$OUT/deny_admin_appeals.json"
echo "→ 返回：$(cat "$OUT/deny_admin_appeals.json")"

echo ""
echo "[5.1] 采购方只能看自己的：GET /buyer/appeals（只返回自己那 1 条）"
CURL "$API/buyer/appeals" -H "Authorization: Bearer $BT" -o "$OUT/buyer_own_appeals.json"
echo "→ 返回：$(cat "$OUT/buyer_own_appeals.json")"
echo ""
echo "[5.2] 交叉验证：采购方 A 的 token 看不到采购方 B 的申诉"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const target=Number(process.argv[2]);const list=r.data||[];console.log('A 名下申诉 id 列表 =',JSON.stringify(list.map(x=>x.appealId)));console.log('B 的 appealId='+target+' 是否出现在 A 的列表里 =',list.some(x=>x.appealId===target))" "$OUT/buyer_own_appeals.json" "$AID2"

# ══════════════════════════════════════════════════════════
# 6. 运营受理 → 申诉记录处理留痕
# ══════════════════════════════════════════════════════════
hr "6. 运营受理申诉 → appeal_record 打处理留痕"
echo "curl --noproxy '*' -X POST $API/admin/buyers/$PID/appeal-review -H 'Authorization: Bearer <admin>' -d '{\"approved\":true}'"
CURL -X POST "$API/admin/buyers/$PID/appeal-review" -H "Authorization: Bearer $AT" \
  -H 'Content-Type: application/json' -d '{"approved":true}' -o "$OUT/appeal_review.json"
echo "→ 返回：$(cat "$OUT/appeal_review.json")"
sqlq "SELECT id, status, handled_by, handled_at FROM appeal_record WHERE id = $AID"

hr "7. 审计：申诉受理/处理都写 audit_log（action 全大写）"
sqlq "SELECT id, operator_id, action, entity, entity_id FROM audit_log WHERE action IN ('BUYER_APPEAL_SUBMIT','REVIEW_BUYER_APPEAL') ORDER BY id DESC LIMIT 4"

hr "8. 全表校对：本次新增后是否仍只有一个小写 action"
sqlq "SELECT action, COUNT(*) c FROM audit_log GROUP BY action HAVING action <> UPPER(action)"

echo ""
echo "============================================================"
echo "取证完毕。原始响应 JSON 落在：$OUT/"
echo "============================================================"
