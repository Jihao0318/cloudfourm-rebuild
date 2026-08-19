-- 013_remove_lottery_vip.sql: 调整概率——降低大奖概率, 提高小奖概率

-- 删除 VIP 旧数据（如果存在）
DELETE FROM lottery_coin_prizes WHERE type = 'vip';

-- 重新调整所有奖品的权重（总和 1000，正好 100%）
REPLACE INTO lottery_coin_prizes (id, name, emoji, type, value, weight) VALUES
  (1, '参与奖', '🥉', 'coins', '10', 350),
  (2, '幸运奖', '🥈', 'coins', '30', 250),
  (3, '好运奖', '🥇', 'coins', '50', 200),
  (4, '财富奖', '💎', 'coins', '100', 100),
  (5, '改名卡', '🃏', 'rename', '1', 60),
  (6, '好运奖+', '🎉', 'coins', '80', 25),
  (7, '大奖池+', '💎', 'coins', '150', 10),
  (8, '大奖池', '👑', 'coins', '500', 5);
