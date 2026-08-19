-- 板块级「感谢」开关：只有启用了感谢的板块（如教程/互助类）内才能使用感谢功能
-- 默认关闭（0），由管理员在后台板块管理中按需开启
ALTER TABLE categories ADD COLUMN allow_thanks INTEGER DEFAULT 0;
