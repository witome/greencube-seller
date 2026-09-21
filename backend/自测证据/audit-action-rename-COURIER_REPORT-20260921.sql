-- ════════════════════════════════════════════════════════════════════════════
-- 卡Q ② 审计 action 命名统一：courier_report → COURIER_REPORT
-- ════════════════════════════════════════════════════════════════════════════
-- 背景：全仓唯一的非 UPPER_SNAKE action。2026-09-11 审计复核登记为 A2，2026-09-21 大辉拍板统一。
-- 为什么要改历史数据：审计页 `actionText()` 命中映射才显示中文，未命中回落成英文原文；
--   只改代码不改数据，历史记录会从「配送异常上报」变成 `COURIER_REPORT` 英文，前后显示不一致。
--
-- ⚠️⚠️ 两条必须遵守的执行前提（本机首跑时踩到了第 1 条）：
--   1) **先换代码、再改数据**。`audit_log.action` 由业务代码写入；若旧代码（写小写）
--      还在运行，改完数据它立刻又写进新的小写行 —— 本机首跑就撞上了：
--      UPDATE 之后库里又冒出 1 行小写（旧进程写的），需二次执行才归零。
--      ⇒ 执行前请确认**已发布新代码且旧进程已重启**。
--   2) **所有比较必须用二进制**。库是 utf8mb4_unicode_ci（**大小写不敏感**），
--      `WHERE action = 'courier_report'` 会把 `COURIER_REPORT` 也匹配上 ——
--      校验会得出「还有 86 行小写」这种**完全误导**的结论（本机首跑即如此）。
--      统一用 `CAST(action AS BINARY) = '...'`（MySQL 8 里 `REGEXP BINARY` 报 3995，别用）。
--
-- ⚠️ 本文件对**本机开发库**与**生产库**是同一份，但：
--   - 本机开发库：已由卡Q 执行过（证据见 backend/自测证据/_audit-rename-*.txt）。
--   - **生产库：只交付文件，由 Hermes 执行**；卡Q **绝对没有**在生产库上跑过。
--
-- ⚠️ 上线顺序：代码里 action 已写成 COURIER_REPORT，页面映射也只认大写 ——
--   若代码先上、数据后改，历史记录会短暂显示英文。**建议代码与数据同批上线**。
--
-- 可重复执行：备份表用 IF NOT EXISTS + INSERT IGNORE（同一批行不会重复备份，也不会丢早先的备份）。
-- 执行：mysql -h <host> -P 3306 -u <user> -p <db> < 本文件
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- [0] 改名前行数（二进制比较；生产库请重跑取值并记下来）
-- ────────────────────────────────────────────────────────────
SELECT COUNT(*) AS before_old_cnt FROM audit_log WHERE CAST(action AS BINARY) = 'courier_report';
SELECT COUNT(*) AS before_total_cnt FROM audit_log;

-- ────────────────────────────────────────────────────────────
-- [1] 备份成表（只备份「小写那些行」，二进制比较）
--     幂等：表已存在则跳过建表；已备份过的行靠主键 + INSERT IGNORE 去重
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log_backup_20260921_courier_report LIKE audit_log;
INSERT IGNORE INTO audit_log_backup_20260921_courier_report
  SELECT * FROM audit_log WHERE CAST(action AS BINARY) = 'courier_report';

SELECT COUNT(*) AS backup_cnt FROM audit_log_backup_20260921_courier_report;
SELECT COUNT(*) AS backup_lowercase_cnt FROM audit_log_backup_20260921_courier_report
  WHERE CAST(action AS BINARY) = 'courier_report';

-- ────────────────────────────────────────────────────────────
-- [2] 改名（只动 action 一列；其余列、行数、时间都不动）
-- ────────────────────────────────────────────────────────────
UPDATE audit_log SET action = 'COURIER_REPORT'
  WHERE CAST(action AS BINARY) = 'courier_report';

-- ────────────────────────────────────────────────────────────
-- [3] 校验（全部二进制比较）
--     预期：after_old_cnt = 0；after_new_cnt = 备份行数；全表非大写 = 空集
-- ────────────────────────────────────────────────────────────
SELECT COUNT(*) AS after_old_cnt FROM audit_log WHERE CAST(action AS BINARY) = 'courier_report';
SELECT COUNT(*) AS after_new_cnt FROM audit_log WHERE CAST(action AS BINARY) = 'COURIER_REPORT';
SELECT COUNT(*) AS after_total_cnt FROM audit_log;
SELECT action, COUNT(*) AS c FROM audit_log
  WHERE CAST(action AS BINARY) <> CAST(UPPER(action) AS BINARY)
  GROUP BY action;                      -- 预期空集 = 全仓小写 action 归零

-- ────────────────────────────────────────────────────────────
-- [4] 回滚（只把「备份表里那批 id」改回小写；
--     改名之后新产生的 COURIER_REPORT 记录 id 不在备份表里，不受影响）
-- ────────────────────────────────────────────────────────────
-- UPDATE audit_log SET action = 'courier_report'
--   WHERE CAST(action AS BINARY) = 'COURIER_REPORT'
--     AND id IN (SELECT id FROM audit_log_backup_20260921_courier_report);
--
-- 回滚后校验：
-- SELECT COUNT(*) FROM audit_log WHERE CAST(action AS BINARY) = 'courier_report';  -- 应 = 备份行数
-- SELECT COUNT(*) FROM audit_log WHERE CAST(action AS BINARY) = 'COURIER_REPORT';  -- 应 = 0（若改名后无新写入）

-- ────────────────────────────────────────────────────────────
-- [5] 确认无误后再清理备份表（**建议保留一段时间**，别急着删）
-- ────────────────────────────────────────────────────────────
-- DROP TABLE audit_log_backup_20260921_courier_report;
