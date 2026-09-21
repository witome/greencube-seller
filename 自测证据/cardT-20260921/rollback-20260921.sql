-- 卡T 自测种子回滚（仅本机开发库 lvlifang）
-- 删掉本卡自建的 4 单及其明细/流水，恢复本机库到种子前状态
DELETE p FROM payment_record p
  JOIN `order` o ON o.id = p.order_id
 WHERE o.remark LIKE 'CARD-T-SEED-%';
DELETE i FROM order_item i
  JOIN `order` o ON o.id = i.order_id
 WHERE o.remark LIKE 'CARD-T-SEED-%';
DELETE FROM `order` WHERE remark LIKE 'CARD-T-SEED-%';
