-- 后台「仅邀请注册」开关（settings.invite_only）落地为显式配置项。
-- 改造前注册端点是按「站内有无管理员」隐式判定的：已有管理员 → 必须邀请码。
-- 补这一行让状态显式化（后台系统设置里显示为开启），避免新逻辑按「未设置 = 关闭」读时，
-- 部署瞬间把注册从「必须邀请码」静默放开成「人人可注册」。
-- 管理员在后台手动关掉才会进入「不强制邀请码」模式。
INSERT INTO settings (key, value) VALUES ('invite_only', '1')
ON CONFLICT(key) DO NOTHING;
