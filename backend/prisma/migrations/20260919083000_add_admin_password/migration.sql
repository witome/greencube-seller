-- 2026-09-19 拍板 1A：运营后台「账号+密码」登录
-- User 加可空 password_hash：scrypt 哈希（格式 scrypt$<salt-hex>$<hash-hex>）
-- NULL = 未设置密码（该账号不可用密码方式登录后台）
-- ⚠️ 本迁移以「手写 migration.sql + prisma db execute + prisma migrate resolve --applied」方式执行
--    （lvlifang_app 无影子库权限，惯例见 任务卡-微信支付抽象层与模拟回调-20260911.md 迁移小贴士）

-- AlterTable
ALTER TABLE `user` ADD COLUMN `password_hash` VARCHAR(255) NULL;
