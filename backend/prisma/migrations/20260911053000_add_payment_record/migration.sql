-- 支付流水表（任务卡：微信支付抽象层+模拟回调，2026-09-11 拍板岔路①=A）
CREATE TABLE `payment_record` (
    `id` BIGINT AUTO_INCREMENT NOT NULL,
    `order_id` BIGINT NOT NULL,
    `pay_no` VARCHAR(40) NOT NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'mock',
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `callback_payload` JSON NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_record_pay_no_key`(`pay_no`),
    INDEX `payment_record_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Prisma 关系约束（order 一对多 payment_record）
ALTER TABLE `payment_record` ADD CONSTRAINT `payment_record_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
