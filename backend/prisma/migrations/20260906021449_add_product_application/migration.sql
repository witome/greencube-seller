-- CreateTable
CREATE TABLE `product_application` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` TINYINT NOT NULL,
    `product_id` BIGINT NULL,
    `supplier_id` BIGINT NOT NULL,
    `payload` JSON NOT NULL,
    `diffs` JSON NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `reject_reason` VARCHAR(191) NULL,
    `reviewed_by` BIGINT NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_application_supplier_id_status_idx`(`supplier_id`, `status`),
    INDEX `product_application_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_application` ADD CONSTRAINT `product_application_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_application` ADD CONSTRAINT `product_application_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
