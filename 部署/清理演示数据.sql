-- ============================================================
-- 辉崧鲜配 · 清理演示数据（上线前执行）
-- 用途：把 seed 灌进去的「演示供应商 / 演示配送员 / 演示商品」清掉，
--       保留分类与管理员账号，方便录入真实数据。
-- 执行：mysql -uroot lvlifang < 清理演示数据.sql
-- ⚠️ 执行前先备份：mysqldump -uroot lvlifang | gzip > /root/lvlifang_$(date +%F).sql.gz
-- ============================================================

-- 先看一眼会被删掉什么（只读，可单独执行）
SELECT '将被删除-演示供应商' AS 项, COUNT(*) AS 条数 FROM supplier WHERE userId IN (SELECT id FROM user WHERE wx_openid='dev_demo_supplier')
UNION ALL SELECT '将被删除-演示配送员', COUNT(*) FROM courier
UNION ALL SELECT '将被删除-演示商品',   COUNT(*) FROM product
UNION ALL SELECT '保留-分类',           COUNT(*) FROM category
UNION ALL SELECT '保留-管理员',         COUNT(*) FROM user WHERE wx_openid='dev_admin';

-- ---------------- 以下为实际删除 ----------------

SET FOREIGN_KEY_CHECKS = 0;

-- 1) 商品与供应商关联
DELETE FROM product_supplier_link;
DELETE FROM product;

-- 2) 供应商分类授权 + 演示供应商
DELETE FROM supplier_category;
DELETE FROM supplier WHERE userId IN (SELECT id FROM user WHERE wx_openid = 'dev_demo_supplier');

-- 3) 演示配送员
DELETE FROM delivery_task  WHERE courierId IN (SELECT id FROM courier);
DELETE FROM courier;
DELETE FROM user WHERE wx_openid = 'dev_courier';

-- 4) 演示供应商账号
DELETE FROM user WHERE wx_openid = 'dev_demo_supplier';

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------- 清理后核对 ----------------
SELECT '供应商' AS 表, COUNT(*) AS 剩余 FROM supplier
UNION ALL SELECT '配送员', COUNT(*) FROM courier
UNION ALL SELECT '商品',   COUNT(*) FROM product
UNION ALL SELECT '分类(保留)', COUNT(*) FROM category
UNION ALL SELECT '管理员(保留)', COUNT(*) FROM user WHERE wx_openid='dev_admin';
