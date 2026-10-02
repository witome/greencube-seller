-- 卡BJ（2026-10-02）：供应商「开始备货」＋ 运营后台接单状态同步
--
-- 背景：拆单后订单直接是「备货中」，运营看不出供应商看没看到单、有没有开始备货。
-- 大辉要求供应商端加「收到，开始备货」按钮，并与运营后台同步接单状态。
--
-- 为什么单独一张表：订单状态机（10/20/30/40/…）被采购方进度条、取消窗口、报表多处引用，
-- 本卡**绝不允许新增或修改订单状态枚举** → 接单信息记在「订单 × 供应商」层（order_item 的供应商维度）。
--
-- 字段口径：
--   ack_at           供应商点「收到，开始备货」的时间；NULL = 未接单
--   remind_count     预留（本卡只建不用）：后续「超时未接单电话提醒」的次数
--   last_remind_at   预留（本卡只建不用）：最近一次提醒时间
--   唯一键 uk_order_supplier_ack_order (order_id, supplier_id)：一单一供应商最多一条，
--                    既是业务约束，也是接单接口并发双击的幂等兜底（P2002 → 返回原 ack_at）。
--
-- 非破坏性：纯新增表 + 外键，不动任何既有表/数据，全新环境可直接执行。
-- 执行方式（本机 lvlifang_app 无影子库权限，不用 migrate dev）：
--   npx prisma db execute --file prisma/migrations/20261002100000_add_order_supplier_ack/migration.sql --schema prisma/schema.prisma
--   npx prisma migrate resolve --applied 20261002100000_add_order_supplier_ack
CREATE TABLE `order_supplier_ack` (
    `id` BIGINT AUTO_INCREMENT NOT NULL,
    `order_id` BIGINT NOT NULL,
    `supplier_id` BIGINT NOT NULL,
    `ack_at` DATETIME(3) NULL,
    `remind_count` INTEGER NOT NULL DEFAULT 0,
    `last_remind_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `order_supplier_ack_order_id_supplier_id_key`(`order_id`, `supplier_id`),
    INDEX `order_supplier_ack_supplier_id_idx`(`supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Prisma 关系约束（order 一对多 order_supplier_ack；supplier 同理）
ALTER TABLE `order_supplier_ack` ADD CONSTRAINT `order_supplier_ack_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `order_supplier_ack` ADD CONSTRAINT `order_supplier_ack_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
