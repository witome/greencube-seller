-- CreateTable
CREATE TABLE `user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `wx_openid` VARCHAR(64) NOT NULL,
    `wx_unionid` VARCHAR(64) NULL,
    `name` VARCHAR(32) NULL,
    `phone` VARCHAR(20) NULL,
    `roles` JSON NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `parent_id` BIGINT NULL,

    UNIQUE INDEX `user_wx_openid_key`(`wx_openid`),
    UNIQUE INDEX `user_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchaser` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `shop_name` VARCHAR(100) NOT NULL,
    `contact` VARCHAR(32) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    `delivery_windows` JSON NULL,
    `pay_mode` TINYINT NOT NULL DEFAULT 1,
    `credit_limit` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `qualification` JSON NULL,
    `account_status` TINYINT NOT NULL DEFAULT 1,
    `business_license_no` VARCHAR(64) NULL,
    `business_license_img` VARCHAR(255) NULL,
    `food_permit_img` VARCHAR(255) NULL,
    `registered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verified_by` BIGINT NULL,
    `verified_at` DATETIME(3) NULL,
    `appeal_count_30d` TINYINT NOT NULL DEFAULT 0,
    `reject_reason_code` TINYINT NULL,
    `reject_reason_text` TEXT NULL,

    UNIQUE INDEX `purchaser_user_id_key`(`user_id`),
    UNIQUE INDEX `purchaser_business_license_no_key`(`business_license_no`),
    INDEX `purchaser_account_status_idx`(`account_status`),
    INDEX `purchaser_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `purchaser_id` BIGINT NOT NULL,
    `operator_id` BIGINT NOT NULL,
    `method` JSON NOT NULL,
    `result` TINYINT NOT NULL,
    `reason_code` TINYINT NULL,
    `reason_text` TEXT NULL,
    `attachments` JSON NULL,
    `duration_min` INTEGER NULL,
    `signature` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `verification_log_purchaser_id_idx`(`purchaser_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `stall_name` VARCHAR(100) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `qualification` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `supplier_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courier` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `source` TINYINT NOT NULL DEFAULT 1,
    `id_card_no` VARCHAR(32) NULL,
    `health_cert_expiry` DATE NULL,
    `vehicle_type` TINYINT NOT NULL DEFAULT 1,
    `trial_status` TINYINT NOT NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `courier_user_id_key`(`user_id`),
    UNIQUE INDEX `courier_id_card_no_key`(`id_card_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `category` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `parent_id` BIGINT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `category_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `cover` VARCHAR(255) NULL,
    `images` JSON NULL,
    `weigh_type` TINYINT NOT NULL DEFAULT 1,
    `unit` VARCHAR(10) NOT NULL DEFAULT '斤',
    `spec_text` VARCHAR(100) NULL,
    `weigh_note` VARCHAR(255) NULL,
    `sale_price` DECIMAL(10, 2) NOT NULL,
    `markup_rate` DECIMAL(5, 4) NOT NULL DEFAULT 0.30,
    `status` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `product_category_id_status_idx`(`category_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_supplier_link` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT NOT NULL,
    `supplier_id` BIGINT NOT NULL,
    `supply_price` DECIMAL(10, 2) NOT NULL,
    `daily_supply` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `priority` TINYINT NOT NULL DEFAULT 9,
    `status` TINYINT NOT NULL DEFAULT 1,

    INDEX `product_supplier_link_product_id_priority_idx`(`product_id`, `priority`),
    UNIQUE INDEX `product_supplier_link_product_id_supplier_id_key`(`product_id`, `supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `product_id` BIGINT NOT NULL,
    `qty` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cart_item_user_id_product_id_key`(`user_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `purchaser_id` BIGINT NOT NULL,
    `delivery_date` DATE NOT NULL,
    `time_window` TINYINT NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 10,
    `amount_ordered` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amount_final` DECIMAL(12, 2) NULL,
    `remark` VARCHAR(255) NULL,
    `shortage_policy` VARCHAR(20) NOT NULL DEFAULT 'auto_replace',
    `source` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `order_purchaser_id_status_idx`(`purchaser_id`, `status`),
    INDEX `order_delivery_date_idx`(`delivery_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `product_id` BIGINT NOT NULL,
    `supplier_id` BIGINT NULL,
    `qty_ordered` DECIMAL(10, 2) NOT NULL,
    `qty_declared` DECIMAL(10, 2) NULL,
    `qty_accepted` DECIMAL(10, 2) NULL,
    `qty_sorted` DECIMAL(10, 2) NULL,
    `qty_received` DECIMAL(10, 2) NULL,
    `is_auto_declared` TINYINT NOT NULL DEFAULT 0,
    `shortage_reason` VARCHAR(255) NULL,
    `reject_reason` VARCHAR(255) NULL,
    `supply_price` DECIMAL(10, 2) NULL,
    `sale_price` DECIMAL(10, 2) NOT NULL,

    INDEX `order_item_order_id_idx`(`order_id`),
    INDEX `order_item_supplier_id_idx`(`supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_task` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `courier_id` BIGINT NOT NULL,
    `route_no` VARCHAR(40) NOT NULL,
    `station_list` JSON NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `proof` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delivery_task_courier_id_status_idx`(`courier_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlement` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `supplier_id` BIGINT NOT NULL,
    `period` CHAR(7) NOT NULL,
    `gross_amount` DECIMAL(12, 2) NOT NULL,
    `service_fee_rate` DECIMAL(5, 4) NOT NULL,
    `service_fee` DECIMAL(12, 2) NOT NULL,
    `net_amount` DECIMAL(12, 2) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `settlement_supplier_id_period_key`(`supplier_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_bill` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `purchaser_id` BIGINT NOT NULL,
    `period` CHAR(7) NOT NULL,
    `gross_amount` DECIMAL(12, 2) NOT NULL,
    `paid_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `purchase_bill_purchaser_id_period_key`(`purchaser_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aftersale_order` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `order_item_id` BIGINT NOT NULL,
    `type` TINYINT NOT NULL,
    `reason` VARCHAR(255) NULL,
    `qty_diff` DECIMAL(10, 2) NOT NULL,
    `amount_diff` DECIMAL(12, 2) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `handled_by` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `aftersale_order_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `operator_id` BIGINT NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity` VARCHAR(64) NOT NULL,
    `entity_id` BIGINT NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_entity_entity_id_idx`(`entity`, `entity_id`),
    INDEX `audit_log_operator_id_idx`(`operator_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchaser` ADD CONSTRAINT `purchaser_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verification_log` ADD CONSTRAINT `verification_log_purchaser_id_fkey` FOREIGN KEY (`purchaser_id`) REFERENCES `purchaser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier` ADD CONSTRAINT `supplier_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courier` ADD CONSTRAINT `courier_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `category` ADD CONSTRAINT `category_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product` ADD CONSTRAINT `product_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_supplier_link` ADD CONSTRAINT `product_supplier_link_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_supplier_link` ADD CONSTRAINT `product_supplier_link_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_item` ADD CONSTRAINT `cart_item_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_item` ADD CONSTRAINT `cart_item_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order` ADD CONSTRAINT `order_purchaser_id_fkey` FOREIGN KEY (`purchaser_id`) REFERENCES `purchaser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item` ADD CONSTRAINT `order_item_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item` ADD CONSTRAINT `order_item_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `settlement` ADD CONSTRAINT `settlement_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
