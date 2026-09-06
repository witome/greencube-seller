-- CreateTable
CREATE TABLE `supplier_category` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `supplier_id` BIGINT NOT NULL,
    `category_id` BIGINT NOT NULL,

    UNIQUE INDEX `supplier_category_supplier_id_category_id_key`(`supplier_id`, `category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `supplier_category` ADD CONSTRAINT `supplier_category_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_category` ADD CONSTRAINT `supplier_category_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
