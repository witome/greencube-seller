-- 卡L · 2026-09-19 大辉拍板：货到付款订单「送达后」的付款闭环
-- 背景：采购方订单详情的支付卡片只在 status=10 && payMethod=0 时出现（下单时选支付方式那一步），
--       一旦选了「货到付款」并**送达之后**，采购方那边没有任何付款入口。
--       本迁移给 order 加一个字段，记录采购方自己点「我已付款」的时间。
--
-- ⚠️ 口径边界（务必保持）：
--   本字段只是「客户称已付」，**不是核销**。是否真收到钱仍以既有 order.pay_proof
--   （配送员上传的收款凭证 photos/courierId/paidAt）为准 —— 两个状态必须分开显示，
--   本迁移与相关代码**不改变 payProof 的既有语义**，也不动配送员既有 COD 收款流程。
--
-- 非破坏性：纯 ADD COLUMN（可空、无默认值），不新增/修改/删除任何业务数据。
--   存量订单该列为 NULL，语义 = 「采购方尚未声明已付款」，与旧行为一致。
--
-- ⚠️ 执行方式遵循项目既有惯例（lvlifang_app 无影子库权限，prisma migrate dev 报 P3014）：
--     手写 migration.sql → prisma db execute --file → prisma migrate resolve --applied
--     （同 20260919173000_add_service_fee_unique_global / 20260919094500_add_appeal_record）
--
-- 字段口径：
--   buyer_paid_claim_at  采购方在订单详情点「我已付款」的时刻（NULL = 未声明）
--                        由 POST /buyer/order/:orderId/claim-paid 写入，仅允许
--                        本人订单 + payMethod=2（货到付款）+ 状态 60 已送达 / 70 已完成；
--                        重复声明幂等（返回既有时间，不报错、不重复写审计）

ALTER TABLE `order`
  ADD COLUMN `buyer_paid_claim_at` DATETIME(3) NULL
  COMMENT '采购方「我已付款」声明时间（仅声明，非核销；核销以 pay_proof 为准）';
