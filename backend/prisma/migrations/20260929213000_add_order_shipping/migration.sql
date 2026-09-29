-- 卡S1（2026-09-29）：小程序发货信息管理 · 录入台账
--
-- 背景：官方《实物电商类小程序运营规范》要求卖实物+配送（含同城配送）的小程序接入平台订单
-- 发货管理；不接入 = 限制支付（真机撞过 errno 102 / wxa_trade_controlled），接入后不录入
-- 发货信息 = 用户的钱一直冻结（快递 T+10、自提/同城配送 T+2 自动确认收货后才结算）。
--
-- 为什么单独一张表：微信侧「一笔支付单只有一次重新发货机会」（改发货模式也算），
-- 「录没录过 / 失败几次 / 还能不能重试 / 报什么错」必须落库，不能靠日志或审计反推。
--
-- 纯新增表 + 外键，无破坏性变更，全新环境可直接执行。
CREATE TABLE `order_shipping` (
    `id` BIGINT AUTO_INCREMENT NOT NULL,
    `order_id` BIGINT NOT NULL,
    `pay_no` VARCHAR(40) NULL,
    `logistics_type` TINYINT NOT NULL DEFAULT 2,
    `delivery_mode` TINYINT NOT NULL DEFAULT 1,
    `status` TINYINT NOT NULL DEFAULT 0,
    `attempts` TINYINT NOT NULL DEFAULT 0,
    `last_error` VARCHAR(255) NULL,
    `item_desc` VARCHAR(255) NULL,
    `uploaded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `order_shipping_order_id_key`(`order_id`),
    INDEX `order_shipping_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Prisma 关系约束（order 一对多 order_shipping）
ALTER TABLE `order_shipping` ADD CONSTRAINT `order_shipping_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
