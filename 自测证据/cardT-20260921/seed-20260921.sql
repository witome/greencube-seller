-- 卡T 自测种子（仅本机开发库 lvlifang，绝不用于生产）
-- 目的：本机库里 status IN (60,70) 的订单中，0 单有真实收款凭证照片，
--       无法演示「收款凭证列 + 点开大图」；且无 amount_final IS NULL 的已送达单，
--       无法演示履约页金额列的回退分支。故按真实表结构补 4 单（含明细/流水快照）。
-- 标识：order.remark = 'CARD-T-SEED-1..4'，回滚见本目录 rollback-20260921.sql
-- 送达日 2026-09-21（对账页默认日期），status=60（已送达），purchaser_id=1

-- S1 微信已付（pay_method=1 + payment_record.status=1）
INSERT INTO `order`
 (purchaser_id, delivery_date, time_window, status, amount_ordered, amount_final, remark,
  shortage_policy, source, created_at, updated_at, pay_method, delivery_fee, urgent, pay_proof, buyer_paid_claim_at)
VALUES (1,'2026-09-21',1,60,30.42,35.42,'CARD-T-SEED-1','auto_replace',1,NOW(3),NOW(3),1,5.00,0,NULL,NULL);
SET @o1 = LAST_INSERT_ID();
INSERT INTO order_item (order_id,product_id,supplier_id,qty_ordered,qty_declared,qty_accepted,sale_price,supply_price,remark)
VALUES (@o1,1,1,20.00,20.00,20.00,1.28,0.95,'CARD-T-SEED-1'),
       (@o1,2,1,2.00,2.00,2.00,2.41,1.85,'CARD-T-SEED-1');
INSERT INTO payment_record (order_id,pay_no,channel,amount,status,paid_at,created_at,updated_at)
VALUES (@o1,'CARDT2026092100S1','wxpay',35.42,1,NOW(3),NOW(3),NOW(3));

-- S2 货到付款已核销（pay_method=2 + pay_proof.photos 非空）
INSERT INTO `order`
 (purchaser_id, delivery_date, time_window, status, amount_ordered, amount_final, remark,
  shortage_policy, source, created_at, updated_at, pay_method, delivery_fee, urgent, pay_proof, buyer_paid_claim_at)
VALUES (1,'2026-09-21',1,60,52.86,57.86,'CARD-T-SEED-2','auto_replace',1,NOW(3),NOW(3),2,5.00,0,
  CAST('{"photos":["/uploads/1789805263805_opz10l.jpg","/uploads/1789807416649_p9pw1h.jpg"],"courierId":155,"paidAt":"2026-09-21T02:30:00.000Z"}' AS JSON),NULL);
SET @o2 = LAST_INSERT_ID();
INSERT INTO order_item (order_id,product_id,supplier_id,qty_ordered,qty_declared,qty_accepted,sale_price,supply_price,remark)
VALUES (@o2,1,1,30.00,30.00,30.00,1.28,0.95,'CARD-T-SEED-2'),
       (@o2,2,1,6.00,6.00,6.00,2.41,1.85,'CARD-T-SEED-2');

-- S3 客户称已付（未核销）：pay_method=2 + 无凭证 + buyer_paid_claim_at 非空
INSERT INTO `order`
 (purchaser_id, delivery_date, time_window, status, amount_ordered, amount_final, remark,
  shortage_policy, source, created_at, updated_at, pay_method, delivery_fee, urgent, pay_proof, buyer_paid_claim_at)
VALUES (1,'2026-09-21',2,60,16.87,21.87,'CARD-T-SEED-3','auto_replace',1,NOW(3),NOW(3),2,5.00,0,NULL,'2026-09-21 03:20:00.000');
SET @o3 = LAST_INSERT_ID();
INSERT INTO order_item (order_id,product_id,supplier_id,qty_ordered,qty_declared,qty_accepted,sale_price,supply_price,remark)
VALUES (@o3,2,1,7.00,7.00,7.00,2.41,1.85,'CARD-T-SEED-3');

-- S4 未收：pay_method=2 + 无凭证 + 无客户称已付 + amount_final IS NULL（走回退口径）
INSERT INTO `order`
 (purchaser_id, delivery_date, time_window, status, amount_ordered, amount_final, remark,
  shortage_policy, source, created_at, updated_at, pay_method, delivery_fee, urgent, pay_proof, buyer_paid_claim_at)
VALUES (1,'2026-09-21',3,60,41.60,NULL,'CARD-T-SEED-4','auto_replace',1,NOW(3),NOW(3),2,5.00,0,NULL,NULL);
SET @o4 = LAST_INSERT_ID();
INSERT INTO order_item (order_id,product_id,supplier_id,qty_ordered,qty_declared,qty_accepted,sale_price,supply_price,remark)
VALUES (@o4,1,1,32.50,32.50,32.50,1.28,0.95,'CARD-T-SEED-4');
