-- AftersaleOrder 增加运营处理字段（修复单缺陷 3，2026-09-10）
ALTER TABLE `aftersale_order` ADD COLUMN `compensate_amount` DECIMAL(12,2) NULL;
ALTER TABLE `aftersale_order` ADD COLUMN `compensate_method` TINYINT NULL;
ALTER TABLE `aftersale_order` ADD COLUMN `handle_remark` VARCHAR(255) NULL;
