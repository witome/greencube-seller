-- 采购需求登记 + 到货主动通知（2026-09-25 大辉拍板）
-- 背景：客户在 AI 客服里要的菜我们**还没有**（或已下架）时，现在只能回一句「没对上商品」，
--       运营既看不到「谁在要什么、几个人在要」，也没法在采回来之后主动通知客户。
--       本迁移新增采购需求三个业务表 + 一张订阅授权额度表。
--
-- ⚠️ 口径边界（务必保持）——这条线**不是**「下单后供应商缺货」那条线：
--   本域 = 客户还没下单、商品库里压根没有这个菜（或该菜已下架）；
--   `order_item.qty_accepted` 那套 = 已经下单了、到货不够。
--   两条线**完全独立**：不共用表、不共用页面、不互相回写。
--
-- 非破坏性：纯 CREATE TABLE，不动任何既有表结构、不改任何既有数据。
--   全新环境可跑：本迁移不依赖「本地本来就有哪张表」，四个表都自带 CREATE；
--   只有 demand_item / notify_log 两条 FK 指向本次新建的 purchase_demand（同迁移内，顺序已保证）。
--
-- ⚠️ 执行方式遵循项目既有惯例（lvlifang_app 无影子库权限，prisma migrate dev 报 P3014）：
--     手写 migration.sql → prisma db execute --file → prisma migrate resolve --applied
--     （同 20260919094500_add_appeal_record / 20260919190000_add_order_buyer_paid_claim）
--
-- 字段口径：
--   purchase_demand.demand_key     归一化键，**唯一**。唯一实现只有 demand.util.ts 的 normalizeDemandKey()
--   purchase_demand.status         0 待采购 / 1 已下单采购中 / 2 已到货 / 3 已放弃
--   purchase_demand.demand_count   总次数（= 明细行数，每次上报重算）
--   purchase_demand.purchaser_count 去重人数（每次上报重算）
--   purchase_demand.product_id     命中的**已下架**商品 id（未收录为 NULL）
--   item.raw_text                  ⚠️ **只存被识别成菜名的那一段**，不存整句对话
--                                  （防客户原话里的电话/地址/人名进运营导出 CSV）
--   item.kind                      0 未收录 / 1 已有商品·已下架
--   item.source                    1 AI 对话（自动）/ 2 后台手填（电话、微信来的需求）
--   notify_log.channel             1 订阅消息 / 2 客服消息 / 3 仅站内列表（没发出去，只登记原因）
--   notify_log.result              ok / fail
--   notify_log.err_code            微信 errcode（45015 = 客服消息已超 48 小时窗口）
--   quota.quota                    剩余可发次数（用户每同意一次 +1，成功发出一条 -1）

-- CreateTable
CREATE TABLE `purchase_demand` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `demand_key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `demand_count` INTEGER NOT NULL DEFAULT 0,
    `purchaser_count` INTEGER NOT NULL DEFAULT 0,
    `first_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `product_id` BIGINT NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_demand_demand_key_key`(`demand_key`),
    INDEX `purchase_demand_status_last_at_idx`(`status`, `last_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_demand_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `demand_id` BIGINT NOT NULL,
    `purchaser_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `raw_text` VARCHAR(64) NOT NULL,
    `qty_text` VARCHAR(32) NULL,
    `unit` VARCHAR(10) NULL,
    `qty` DECIMAL(10, 2) NULL,
    `kind` TINYINT NOT NULL DEFAULT 0,
    `source` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_demand_item_demand_id_idx`(`demand_id`),
    INDEX `purchase_demand_item_purchaser_id_idx`(`purchaser_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_notify_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `demand_id` BIGINT NOT NULL,
    `purchaser_id` BIGINT NOT NULL,
    `channel` TINYINT NOT NULL,
    `template_id` VARCHAR(64) NULL,
    `result` VARCHAR(8) NOT NULL,
    `err_code` INTEGER NULL,
    `err_msg` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `demand_notify_log_demand_id_idx`(`demand_id`),
    INDEX `demand_notify_log_purchaser_id_idx`(`purchaser_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_subscribe_quota` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `purchaser_id` BIGINT NOT NULL,
    `template_id` VARCHAR(64) NOT NULL,
    `quota` INTEGER NOT NULL DEFAULT 0,
    `accepted_at` DATETIME(3) NULL,
    `notified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `demand_subscribe_quota_purchaser_id_template_id_key`(`purchaser_id`, `template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_demand_item` ADD CONSTRAINT `purchase_demand_item_demand_id_fkey` FOREIGN KEY (`demand_id`) REFERENCES `purchase_demand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demand_notify_log` ADD CONSTRAINT `demand_notify_log_demand_id_fkey` FOREIGN KEY (`demand_id`) REFERENCES `purchase_demand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
