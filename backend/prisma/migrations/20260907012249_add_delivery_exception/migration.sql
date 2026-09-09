-- CreateTable
CREATE TABLE `delivery_exception` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `delivery_task_id` BIGINT NULL,
    `courier_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `handled_by` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delivery_exception_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
