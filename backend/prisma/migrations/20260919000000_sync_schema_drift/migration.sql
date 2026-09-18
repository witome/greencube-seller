-- 2026-09-19 补齐 schema.prisma 与迁移历史的漂移
--
-- 背景：本地开发库曾用 `prisma db push` 直接改结构，未生成迁移文件，
--       导致 schema.prisma 比 `prisma/migrations/` 多出 7 个字段。
-- 影响：任何「从迁移文件全新部署」的库都会缺这些字段 —— 首次部署即暴露
--       `P2022: The column lvlifang.supplier.address does not exist`（服务器首次部署实测命中）。
-- 本迁移全部为 ADD COLUMN，非破坏性、可安全重复部署。

-- AlterTable
ALTER TABLE `courier` ADD COLUMN `has_driver_license` TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN `license_type` VARCHAR(20) NULL,
    ADD COLUMN `own_vehicle` TINYINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `pay_proof` JSON NULL,
    ADD COLUMN `urgent` TINYINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `order_item` ADD COLUMN `remark` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `supplier` ADD COLUMN `address` VARCHAR(255) NULL;
