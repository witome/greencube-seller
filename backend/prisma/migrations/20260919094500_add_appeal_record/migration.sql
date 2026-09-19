-- 决策 6 · 2026-09-19 大辉拍板：申诉内容与附件必须入库
-- 背景：buyer.service.ts appeal() 原实现只把 account_status 改回待审核、appeal_count_30d+1，
--       把 dto.text（申诉正文）与 dto.attachments（附件）直接丢掉，并返回假 id 0 ——
--       采购方提交的申诉运营根本看不到，等于白交。本迁移新增申诉唯一权威留存表。
-- 非破坏性：纯 CREATE TABLE + ADD CONSTRAINT，不动任何既有表与既有数据，可安全重复部署。
--
-- ⚠️ 执行方式遵循项目既有惯例（lvlifang_app 无影子库权限，prisma migrate dev 报 P3014）：
--     手写 migration.sql → prisma db execute --file → prisma migrate resolve --applied
--     （同 20260919083000_add_admin_password 的登记方式，见该迁移头部注释）
--
-- 字段口径：
--   purchaser_id  权限归属（采购方档案），与 verification_log 等既有表同口径
--   user_id       提交申诉的账号（拍板字段名；purchaser.user_id 唯一，二者 1:1）
--   text          申诉正文（DTO 限 500 字，此处 TEXT 兜底）
--   attachments   附件 URL 数组（JSON）；小程序端当前不传，为「拍照留证」卡预留
--   reason_code / reject_reason  提交时刻的驳回原因快照（取自 purchaser.reject_reason_*）
--   status        0 待处理 / 1 已处理
--   handled_by / handled_at      运营（或业务员）处理留痕

-- CreateTable
CREATE TABLE `appeal_record` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `purchaser_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `text` TEXT NOT NULL,
    `attachments` JSON NULL,
    `reason_code` TINYINT NULL,
    `reject_reason` TEXT NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `handled_by` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,

    INDEX `appeal_record_purchaser_id_idx`(`purchaser_id`),
    INDEX `appeal_record_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `appeal_record` ADD CONSTRAINT `appeal_record_purchaser_id_fkey` FOREIGN KEY (`purchaser_id`) REFERENCES `purchaser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
