-- 卡BI · 加价比例体系（2026-10-02 大辉拍板定稿）
-- 背景：加价比例原本只有单品级 Product.markup_rate（新商品写死 0.30），
--       没有「统一默认比例」的持久化配置，分类/供应商也没有档位。
--       本迁移新增配置表 markup_config（一张表存三档）+ product.markup_overridden 标记位。
--
-- 生效优先级（业务规则，解析在 admin-pricing 的导出函数里）：单品 > 供应商 > 分类 > 全局默认 > 0.30
--   markup_config.scope   1 全局 / 2 分类 / 3 供应商
--   markup_config.ref_id  全局 = NULL；分类 = category.id；供应商 = supplier.id
--   product.markup_overridden  1 = 单品单独设过（配置重算/批量时跳过）；0 = 继承（默认）
--   product.markup_rate   继续作为**最终生效值**（现有计算路径、列表展示不改语义）
--
-- ⚠️ 为什么建表时就要 ref_key 生成列（service_fee_config 的同款先例，20260919173000）：
--   ref_id 可空，而 MySQL 唯一索引**不约束 NULL**——(scope, ref_id) 上的普通唯一键
--   挡不住「两条全局行 (1, NULL)」这种最要紧的重复。故加生成列
--   ref_key = COALESCE(ref_id, 0)（category/supplier 自增都从 1 起，0 是安全哨兵），
--   对 (scope, ref_key) 加唯一键。Prisma schema 表达不了生成列，
--   schema.prisma 的 MarkupConfig **不声明** ref_key（声明了 create 会写生成列，MySQL 报 3105）。
--
-- 非破坏性：CREATE TABLE 新表 + ADD COLUMN 带默认值（既有行全部落 0 = 继承，语义不变），不动任何业务数据。
--
-- ⚠️ 执行方式遵循项目既有惯例（lvlifang_app 无影子库权限，prisma migrate dev 报 P3014）：
--     手写 migration.sql → prisma db execute --file → prisma migrate resolve --applied
--
-- 时间口径：本迁移不写任何时间值；后续写入路径若用 raw SQL 必须 UTC_TIMESTAMP(3)（见 admin-pricing.service.ts）。

-- CreateTable
CREATE TABLE `markup_config` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scope` TINYINT NOT NULL,
    `ref_id` BIGINT NULL,
    `rate` DECIMAL(5, 4) NOT NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `ref_key` BIGINT GENERATED ALWAYS AS (COALESCE(`ref_id`, 0)) STORED NOT NULL
        COMMENT '唯一键载体：全局行(ref_id IS NULL)归一为 0。MySQL 唯一索引不约束 NULL，故靠本列兜底（勿删，Prisma 不感知）',

    UNIQUE INDEX `uk_markup_config_scope_ref_key`(`scope`, `ref_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable：单品级「是否单独设过」标记（既有商品默认 0 = 继承，行为不变）
ALTER TABLE `product` ADD COLUMN `markup_overridden` TINYINT NOT NULL DEFAULT 0
    COMMENT '1=单品单独设过加价比例（配置重算跳过）；0=继承（供应商>分类>全局默认）';
