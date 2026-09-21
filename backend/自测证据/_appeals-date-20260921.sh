#!/usr/bin/env bash
# 卡Q ① 申诉日期筛选改服务端：接口层取证
#   每组都把「接口返回的 total」与「同一条件的 SQL 真值」并排对照
# 跑法： cd "C:/Users/Administrator/Documents/绿立方开发/backend" && bash 自测证据/_appeals-date-20260921.sh
#
# 环境注意（本机踩过）：
#  - 不要用 mktemp：它返回 MSYS 路径（/tmp/...），原生 node 读不到（会解析成 cwd 下的怪路径）
#  - 不要用 dirname：本机 shim 坏了，dirname 找不到；直接用绝对路径 cd
set -uo pipefail

API=http://127.0.0.1:3001/api/v1
TMP="C:/Users/Administrator/AppData/Local/Temp/cardq"
mkdir -p "$TMP"
cd "C:/Users/Administrator/Documents/绿立方开发/backend"

DBURL=$(grep '^DATABASE_URL' .env | sed 's/^DATABASE_URL="//; s/"$//')
USERPASS=$(echo "$DBURL" | sed 's|mysql://||; s|@.*||'); DBUSER=${USERPASS%%:*}; DBPASS=${USERPASS#*:}
MYSQL="mysql -h 127.0.0.1 -P 3306 -u $DBUSER -p$DBPASS --default-character-set=utf8mb4 -N -B lvlifang"

curl -s --noproxy '*' -m 20 -X POST "$API/auth/wx-login" -H 'Content-Type: application/json' -d '{"code":"admin"}' -o "$TMP/tok.json"
AT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP/tok.json','utf8')).data.token)")
echo "== 运营登录 =="
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP/tok.json','utf8'));console.log('  code='+j.code+' role='+j.data.currentRole)"

# 一组对照：$1=标签  $2=附加 query  $3=等价 SQL 条件
probe() {
  local label="$1" qs="$2" sqlw="$3"
  MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 "$API/admin/appeals?pageSize=50$qs" -H "Authorization: Bearer $AT" -o "$TMP/r.json"
  local api_total api_ids sql_cnt flag
  api_total=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP/r.json','utf8')).data.total)")
  api_ids=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP/r.json','utf8')).data.list.map(x=>x.appealId).join(','))")
  sql_cnt=$($MYSQL -e "SELECT COUNT(*) FROM appeal_record WHERE 1=1 $sqlw" 2>/dev/null | tr -d '\r')
  flag="✅"; [ "$api_total" = "$sql_cnt" ] || flag="❌"
  printf '  %s %-40s 接口total=%-3s SQL真值=%-3s 返回id=[%s]\n' "$flag" "$label" "$api_total" "$sql_cnt" "$api_ids"
}

echo ""
echo "== 接口 total 与 SQL 真值对照（pageSize=50 一次取全）=="
probe "不传日期（= 改前行为）"                  ""                                       ""
probe "09-19~09-19（当天）"                    "&startDate=2026-09-19&endDate=2026-09-19" "AND created_at >= '2026-09-19 00:00:00' AND created_at < '2026-09-20 00:00:00'"
probe "仅 startDate=09-19"                     "&startDate=2026-09-19"                  "AND created_at >= '2026-09-19 00:00:00'"
probe "仅 endDate=09-19"                       "&endDate=2026-09-19"                    "AND created_at < '2026-09-20 00:00:00'"
probe "09-01~09-18（无数据）"                  "&startDate=2026-09-01&endDate=2026-09-18" "AND created_at >= '2026-09-01 00:00:00' AND created_at < '2026-09-19 00:00:00'"
probe "09-20~09-20（数据之后）"                "&startDate=2026-09-20&endDate=2026-09-20" "AND created_at >= '2026-09-20 00:00:00' AND created_at < '2026-09-21 00:00:00'"
probe "倒置区间 09-19~09-18"                   "&startDate=2026-09-19&endDate=2026-09-18" "AND created_at >= '2026-09-19 00:00:00' AND created_at < '2026-09-19 00:00:00'"
probe "非法格式 startDate=abc（应忽略）"        "&startDate=abc"                         ""
probe "配合 status=1（已处理）"                 "&status=1&startDate=2026-09-19&endDate=2026-09-19" "AND status = 1 AND created_at >= '2026-09-19 00:00:00' AND created_at < '2026-09-20 00:00:00'"

echo ""
echo "== 分页行为：pageSize=1 时 total 仍按整段筛选算（证明是服务端筛）=="
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 "$API/admin/appeals?pageSize=1&page=1&startDate=2026-09-19&endDate=2026-09-19" -H "Authorization: Bearer $AT" -o "$TMP/p1.json"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP/p1.json','utf8'));console.log('  pageSize=1 page=1 → total='+j.data.total+' 本页条数='+j.data.list.length+' id='+j.data.list.map(x=>x.appealId).join(','))"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 "$API/admin/appeals?pageSize=1&page=2&startDate=2026-09-19&endDate=2026-09-19" -H "Authorization: Bearer $AT" -o "$TMP/p2.json"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP/p2.json','utf8'));console.log('  pageSize=1 page=2 → total='+j.data.total+' 本页条数='+j.data.list.length+' id='+j.data.list.map(x=>x.appealId).join(','))"

echo ""
echo "== 库内申诉数据（全部）=="
$MYSQL -e "SELECT id, status, created_at FROM appeal_record ORDER BY created_at" 2>/dev/null | tr -d '\r' | sed 's/^/  /'
