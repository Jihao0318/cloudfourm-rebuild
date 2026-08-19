-- 为用户补建积分账户行：此前 user_balances 仅由 GET /coins/balance 懒创建，
-- 导致邀请奖励/抢红包/任务/升级礼包等入账路径 UPDATE 0 行静默丢分。
-- 与代码兜底保持一致：默认初始积分 200（auth.ts 注册处读取 settings default_user_coins，缺省 200）
-- 注：D1 外键开启，INSERT ... SELECT id FROM users 满足 user_balances.user_id 外键约束
INSERT OR IGNORE INTO user_balances (user_id, coins, total_earned)
  SELECT id, 200, 200 FROM users;
