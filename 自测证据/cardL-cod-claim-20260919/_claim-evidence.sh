#!/usr/bin/env bash
# 卡L 接口层取证：采购方「我已付款」声明
#   - 三个反例：别人的订单 / 未送达 / 非货到付款
#   - 正例 + 幂等
#   - SQL 直查那一行 + 审计
#   - 订单详情两个状态分开返回
# 跑法：后端需在 3001 运行 → bash 自测证据/cardL-cod-claim-20260919/_claim-evidence.sh
set -uo pipefail

API=http://127.0.0.1:3001/api/v1
D="C:/Users/Administrator/AppData/Local/Temp/cardl"; mkdir -p "$D"
BACKEND="C:/Users/Administrator/Documents/绿立方开发/backend"
MY_ORDER="${1:-1086}"     # 本人 COD 已送达单
ELSE_ORDER="${2:-1082}"   # 别人的 COD 已送达单（purchaser 339）
UNDELIVERED="${3:-233}"   # 本人 COD 但未送达（status 30）
NOT_COD="${4:-108}"       # 本人非货到付款

say() { echo; echo "== $* =="; }

curl -s --noproxy '*' -m 20 -X POST "$API/auth/wx-login" -H 'Content-Type: application/json' -d '{"code":"buyer"}' -o "$D/buyer.json"
BT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$D/buyer.json','utf8')).data.token)")

say "0. 采购方身份（code=buyer）"
node -e "const j=JSON.parse(require('fs').readFileSync('$D/buyer.json','utf8'));console.log('  code='+j.code+' userId='+j.data.userId+' currentRole='+j.data.currentRole)"

say "1. 反例A · 别人的订单 orderId=$ELSE_ORDER → 期望 4001"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 -w "\n  HTTP=%{http_code}\n" -X POST "$API/buyer/order/$ELSE_ORDER/claim-paid" -H "Authorization: Bearer $BT"

say "2. 反例B · 未送达（COD 但 status=30）orderId=$UNDELIVERED → 期望 3002"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 -w "\n  HTTP=%{http_code}\n" -X POST "$API/buyer/order/$UNDELIVERED/claim-paid" -H "Authorization: Bearer $BT"

say "3. 反例C · 非货到付款 orderId=$NOT_COD → 期望 3002"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 -w "\n  HTTP=%{http_code}\n" -X POST "$API/buyer/order/$NOT_COD/claim-paid" -H "Authorization: Bearer $BT"

say "4. 正例 · 本人的 COD 已送达单 orderId=$MY_ORDER → 期望 code 0"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 -w "\n  HTTP=%{http_code}\n" -X POST "$API/buyer/order/$MY_ORDER/claim-paid" -H "Authorization: Bearer $BT"

say "5. 幂等 · 再声明一次 → 期望仍 code 0 且 alreadyClaimed=true（不报错）"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 -w "\n  HTTP=%{http_code}\n" -X POST "$API/buyer/order/$MY_ORDER/claim-paid" -H "Authorization: Bearer $BT"

say "6. 订单详情：两个状态分开返回（buyerPaidClaimAt = 客户称已付；paidProofAt = 已核销）"
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 "$API/order/$MY_ORDER" -H "Authorization: Bearer $BT" -o "$D/detail.json"
node -e "
const j=JSON.parse(require('fs').readFileSync('$D/detail.json','utf8'));
const d=j.data;
console.log('  status='+d.status+' statusText='+d.statusText+' payMethod='+d.payMethod+' amountFinal='+d.amountFinal);
console.log('  buyerPaidClaimAt = '+JSON.stringify(d.buyerPaidClaimAt)+'   ← 客户称已付（非核销）');
console.log('  paidProofAt      = '+JSON.stringify(d.paidProofAt)+'   ← 已核销（配送员凭证）');
"

say "7. SQL 直查那一行（证明真进库，不是接口回显）"
cd "$BACKEND" && timeout 180 node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
const S=(o)=>JSON.stringify(o,(k,v)=>typeof v==='bigint'?Number(v):v,2);
(async()=>{
 const r=await p.\$queryRawUnsafe('SELECT id, purchaser_id, status, pay_method, amount_final, buyer_paid_claim_at, pay_proof FROM \`order\` WHERE id = $MY_ORDER');
 console.log(S(r));
 const a=await p.\$queryRawUnsafe(\"SELECT id, operator_id, action, entity, entity_id, \`before\`, \`after\`, created_at FROM audit_log WHERE action='BUYER_CLAIM_PAID' ORDER BY id DESC LIMIT 3\");
 console.log('审计（BUYER_CLAIM_PAID 最近 3 条，重复声明不应新增）：');
 console.log(S(a));
 const lo=await p.\$queryRawUnsafe(\"SELECT action, COUNT(*) c FROM audit_log WHERE CAST(action AS BINARY) <> CAST(UPPER(action) AS BINARY) GROUP BY action\");
 console.log('全表小写 action（应仍只有 courier_report）:', S(lo));
 await p.\$disconnect()})()"

say "8. 配送员侧：todayTasks 是否带出 buyerPaidClaimAt"
curl -s --noproxy '*' -m 20 -X POST "$API/auth/wx-login" -H 'Content-Type: application/json' -d '{"code":"courier"}' -o "$D/courier.json"
CT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$D/courier.json','utf8')).data.token)")
MSYS_NO_PATHCONV=1 curl -s --noproxy '*' -m 20 "$API/courier/today-tasks" -H "Authorization: Bearer $CT" -o "$D/tasks.json"
node -e "
const j=JSON.parse(require('fs').readFileSync('$D/tasks.json','utf8'));
const hits=[];
for (const t of j.data||[]) for (const s of t.stationList||[]) if (s.type==='deliver' && s.orderId!==undefined) hits.push({taskId:t.taskId,orderId:s.orderId,payMethod:s.payMethod,buyerPaidClaimAt:s.buyerPaidClaimAt});
console.log('  任务站点（orderId / payMethod / buyerPaidClaimAt）：');
hits.forEach(h=>console.log('   '+JSON.stringify(h)));
"
