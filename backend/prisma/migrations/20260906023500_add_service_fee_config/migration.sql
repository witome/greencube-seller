-- CreateTable
CREATE TABLE `service_fee_config` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `category_id` BIGINT NULL,
    `rate` DECIMAL(5, 4) NOT NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
