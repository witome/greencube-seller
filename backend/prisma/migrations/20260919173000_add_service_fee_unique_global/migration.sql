-- 卡J · 2026-09-19 大辉拍板：堵住「并发下可能出两条全局费率」
-- 背景：admin-finance.service.ts serviceFeeConfig() 用 findFirst → create，两步非原子；
--       两个并发请求同时读到「无配置」就会各插一条。而 service_fee_config 上原本只有
--       PRIMARY(id)，没有任何唯一约束 —— 数据库层完全不设防。
--
-- ⚠️ 为什么不能直接给 category_id 加 @@unique：
--   category_id 可空，而 MySQL 的唯一索引**不约束 NULL**（多行 NULL 被视为互不相同），
--   所以 @@unique([categoryId]) 恰好挡不住最要紧的那条 —— 全局费率（category_id IS NULL）。
--   那是「看起来对、其实没用」的修复，本卡明确排除。
--
-- 本迁移的做法（方案 A）：
--   加一个生成列 global_key = COALESCE(category_id, 0)，把「全局」归一成 0
--   （category.id 自增从 1 起，0 不是合法分类 id，故 0 可安全作哨兵），
--   再对 global_key 加唯一键。于是不论 category_id 是 NULL 还是具体值，
--   同一分类（含全局）都只可能有一行。
--
-- 非破坏性：仅 ADD COLUMN / ADD UNIQUE KEY，不新增、不修改、不删除任何业务数据。
--   执行前已查重：service_fee_config 全表 1 行（全局，rate=0.05），无重复，唯一键可安全建立。
--
-- ⚠️ 执行方式遵循项目既有惯例（lvlifang_app 无影子库权限，prisma migrate dev 报 P3014）：
--     手写 migration.sql → prisma db execute --file → prisma migrate resolve --applied
--     （同 20260919094500_add_appeal_record / 20260919083000_add_admin_password）
--
-- ⚠️ 后续维护须知：Prisma schema 表达不了生成列，故 schema.prisma 的 ServiceFeeConfig
--   **不声明** global_key（一旦声明，Prisma 的 create 会尝试写入该列，MySQL 报 3105）。
--   该列只由本迁移创建；写入路径见 admin-finance.service.ts 的 serviceFeeConfig()
--   （改为单条原子 `INSERT ... ON DUPLICATE KEY UPDATE`）。
--   若将来有人跑 prisma db pull / migrate diff，会看到这条「多余」列与唯一键——
--   那是**预期**的，不要删：删掉并发就又不设防了。

ALTER TABLE `service_fee_config`
  ADD COLUMN `global_key` BIGINT
    GENERATED ALWAYS AS (COALESCE(`category_id`, 0)) STORED NOT NULL
    COMMENT '唯一键载体：全局行(category_id IS NULL)归一为 0（category.id 自 1 起）。MySQL 唯一索引不约束 NULL，故靠本列兜底',
  ADD UNIQUE KEY `uk_service_fee_config_global_key` (`global_key`);
