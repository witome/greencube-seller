-- 卡BP（2026-10-02）：拍照快速上架 + 供应商备注
-- 给 product_supplier_link 加 remark VARCHAR(30)（供应商对商品的备注）。
--
-- 为什么挂在 link 上：同一商品可有多个供货商，备注是「供应商对自家这路货的说明」
-- （如「今天刚到的老姜，辣味足」），挂 Product 全局表会互相覆盖 —— 任务卡明确禁止。
-- 买家端列表只展示主供货商（priority 最小）的 remark。
--
-- 写入路径：供应商新品申请 / 变更申请 payload 带 remark（≤30 字）→ 运营审核通过后
-- 由 admin-goods.service 写入对应 link；AI 识别/上传链路绝不直接写库。
--
-- 非破坏性：纯新增可空列，不碰任何既有列与数据，可重复执行（information_schema 判重）。
-- 执行方式（本机无影子库，见 lvlifang-prisma-migration 技能）：
--   npx prisma db execute --file <本文件> --schema prisma/schema.prisma
--   npx prisma migrate resolve --applied 20261002174500_add_product_supplier_remark

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product_supplier_link'
    AND COLUMN_NAME = 'remark'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `product_supplier_link` ADD COLUMN `remark` VARCHAR(30) NULL AFTER `status`',
  'SELECT ''product_supplier_link.remark 已存在，跳过'' AS info'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
