-- 卡BN-1（2026-10-02）：未接单电话催办 · 仅两列，不动任何既有表/列/索引
-- Supplier.ack_call_enabled：供应商自己的拨打开关（0 关 / 1 开，默认开）
ALTER TABLE `supplier` ADD COLUMN `ack_call_enabled` TINYINT NOT NULL DEFAULT 1;

-- OrderSupplierAck.remind_stopped：运营点「已处理」→ 不再自动拨打
ALTER TABLE `order_supplier_ack` ADD COLUMN `remind_stopped` TINYINT NOT NULL DEFAULT 0;
