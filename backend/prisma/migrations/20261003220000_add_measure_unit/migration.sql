-- 卡BV-1（2026-10-03）：商品「计量单位」字典表
--
-- 背景：商品单位此前是写死兜底（后端 `unit ?? '斤'`、前端 chip 写死「斤」）。大辉拍板：
--   单位由**运营自己在后台维护**（新增「计量单位」页：新增 / 改名 / 排序 / 启停）。
--   ⇒ 必须是可维护的表，不能做成枚举常量、也不许塞进 Product 表当列。
-- 口径：① 只停用不删除（单位被商品/历史订单引用，删了会显示空白）⇒ 接口层不提供 DELETE；
--       ② 停用后新建商品与供应商端不再出现；③ 老商品照常显示原单位（应用侧放行「当前值」）；
--       ④ name 唯一且含已停用行 —— 先停用再新增同名也要拦。
--
-- 非破坏性：纯新建表 + 灌 18 条预置，**不碰任何既有表与既有商品/申请/订单数据**（大辉口径）。
-- 幂等：CREATE TABLE IF NOT EXISTS + name 唯一键 + INSERT IGNORE ⇒ 可重复执行，不会重复灌数据。
-- 执行方式（本机 lvlifang_app 无影子库权限 → 走 db execute + migrate resolve）：
--   npx prisma db execute --file prisma/migrations/20261003220000_add_measure_unit/migration.sql --schema prisma/schema.prisma
--   npx prisma migrate resolve --applied 20261003220000_add_measure_unit

CREATE TABLE IF NOT EXISTS `measure_unit` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(20) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `measure_unit_name_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 预置 18 条（sort 1..18，status=1，顺序由大辉定稿的原型「计量单位」页拍板）
-- INSERT IGNORE：撞 name 唯一键的行会被跳过 ⇒ 重复执行不会灌第二遍，也不会覆盖运营后来改的排序
INSERT IGNORE INTO `measure_unit` (`name`, `sort`, `status`) VALUES
  ('斤',  1,  1),
  ('公斤', 2,  1),
  ('袋',  3,  1),
  ('桶',  4,  1),
  ('箱',  5,  1),
  ('瓶',  6,  1),
  ('件',  7,  1),
  ('把',  8,  1),
  ('个',  9,  1),
  ('块',  10, 1),
  ('板',  11, 1),
  ('盒',  12, 1),
  ('包',  13, 1),
  ('罐',  14, 1),
  ('扎',  15, 1),
  ('提',  16, 1),
  ('捆',  17, 1),
  ('筐',  18, 1);
