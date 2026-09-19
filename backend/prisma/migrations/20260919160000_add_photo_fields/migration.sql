-- 决策 7 · 2026-09-19 大辉拍板：售后申请 / 配送员上报支持拍照留证
-- 背景：两处前端按钮原是占位残留（点了只弹「真实场景接 uni.chooseImage」提示），
--       后端也没有存照片的地方 —— 售后表与异常工单表都没有照片字段。
-- 本迁移给两处各加一个可空 JSON 列，存照片 URL 数组（与既有
--       delivery_task.proof / order.pay_proof 同口径：只存 URL，绝不存 base64）。
-- 非破坏性：纯 ADD COLUMN，不动既有表结构与既有数据，可安全重复部署。
--
-- ⚠️ 执行方式遵循项目既有惯例（lvlifang_app 无影子库权限，prisma migrate dev 报 P3014）：
--     手写 migration.sql → prisma db execute --file → prisma migrate resolve --applied
--     （同 20260919094500_add_appeal_record / 20260919083000_add_admin_password）
--
-- 字段命名口径：
--   aftersale_order.attachments  与 verification_log.attachments（同域「证据附件」）一致
--   delivery_exception.photos    与 ReportDto.photos（既有 DTO 字段名）/ order.pay_proof 内的 photos 键一致

-- AlterTable
ALTER TABLE `aftersale_order` ADD COLUMN `attachments` JSON NULL;

-- AlterTable
ALTER TABLE `delivery_exception` ADD COLUMN `photos` JSON NULL;
