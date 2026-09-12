-- 收尾：把后台「系统设置」页面用到的配置键在库里补全，并归一历史遗留键名。
--
-- 背景：后台设置页只渲染 settings 表里**已有行**的键（前端 allEntries = Object.entries(settings)），
-- 所以「允许注册」「需要邮箱验证」「签到功能」「巡查体系」这些开关/数值在线上后台一直看不到——
-- 代码里都有消费端，但库里没有对应的行。本迁移把这些键补齐，值一律取「当前代码里的默认值」，
-- 保证部署后实际行为不变，只是从此这些项在后台可见可调。
--
-- 同时把两处历史遗留键名归一到新键（旧键只在新键缺失时提供值，随后删除），
-- 避免出现「新旧两个键同时存在、读取顺序不确定」的隐患。

-- 1) 旧键归一：registration_open → registration_enabled（注册开关；仅 ='0' 视为关闭）
INSERT INTO settings (key, value)
SELECT 'registration_enabled', value FROM settings WHERE key = 'registration_open'
ON CONFLICT(key) DO NOTHING;
DELETE FROM settings WHERE key = 'registration_open';

-- 2) 旧键归一：require_email_verify → email_verification_required
INSERT INTO settings (key, value)
SELECT 'email_verification_required', value FROM settings WHERE key = 'require_email_verify'
ON CONFLICT(key) DO NOTHING;
DELETE FROM settings WHERE key = 'require_email_verify';

-- 3) 补齐被后端读取的配置键（值 = 代码默认值，行为不变；ON CONFLICT 保证不覆盖管理员已改过的值）
--    注册与内容
INSERT INTO settings (key, value) VALUES ('registration_enabled', 'true')       ON CONFLICT(key) DO NOTHING; -- 默认允许注册
INSERT INTO settings (key, value) VALUES ('email_verification_required', 'true') ON CONFLICT(key) DO NOTHING; -- 默认需要邮箱验证（沿用旧键 require_email_verify='true'）
INSERT INTO settings (key, value) VALUES ('invite_only', '1')                    ON CONFLICT(key) DO NOTHING; -- 迁移 080 已写入，这里兜底
INSERT INTO settings (key, value) VALUES ('check_in_enabled', 'true')            ON CONFLICT(key) DO NOTHING; -- 签到功能开关（本次接上消费端）
INSERT INTO settings (key, value) VALUES ('default_user_coins', '200')           ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('invite_reward_coins', '120')          ON CONFLICT(key) DO NOTHING; -- 邀请人奖励（auth.ts 默认 120）

--    巡查体系（阈值/扣分：moderation.ts、appeals.ts、admin.ts 消费）
INSERT INTO settings (key, value) VALUES ('patrol_pass_limit', '2')              ON CONFLICT(key) DO NOTHING; -- 帖子巡查放行票
INSERT INTO settings (key, value) VALUES ('patrol_violation_limit', '3')         ON CONFLICT(key) DO NOTHING; -- 帖子巡查违规票
INSERT INTO settings (key, value) VALUES ('report_pass_limit', '3')              ON CONFLICT(key) DO NOTHING; -- 举报放行票
INSERT INTO settings (key, value) VALUES ('report_violation_limit', '3')         ON CONFLICT(key) DO NOTHING; -- 举报违规票
INSERT INTO settings (key, value) VALUES ('review_reject_coins', '50')           ON CONFLICT(key) DO NOTHING; -- 打回扣分
INSERT INTO settings (key, value) VALUES ('review_takedown_coins', '50')         ON CONFLICT(key) DO NOTHING; -- 举报下架扣分
INSERT INTO settings (key, value) VALUES ('report_reward_coins', '10')           ON CONFLICT(key) DO NOTHING; -- 举报成功奖励
INSERT INTO settings (key, value) VALUES ('appeal_review_level', '5')            ON CONFLICT(key) DO NOTHING; -- 已下架复审等级门槛
INSERT INTO settings (key, value) VALUES ('soft_delete_retention_days', '30')    ON CONFLICT(key) DO NOTHING; -- 软删保留天数
