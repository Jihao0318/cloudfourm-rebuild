-- 补：shop_items 渠道 3 商品 + 自定义称号的完整详情（059 只覆盖了 shop_extras 8 项）
UPDATE shop_items SET data = '{"description":"修改一次用户名","detail":"· 修改一次用户名（仅此渠道可获得）\n· 购买后到「仓库」使用\n· 改名后所有页面同步更新新用户名\n· 永久生效，不消耗其他资源"}'
  WHERE type = 'rename_card';
UPDATE shop_items SET data = '{"css_class":"decoration-border-simple","description":"帖子卡片添加天蓝色边框","detail":"· 帖子卡片添加天蓝色细边框\n· 购买后到「仓库」选择帖子使用\n· 永久生效（与背景卡互不冲突）"}'
  WHERE type = 'post_decoration' AND name = '简约边框';
UPDATE shop_items SET data = '{"css_class":"decoration-title-gold","description":"帖子标题变为金色渐变文字","detail":"· 帖子标题变为金色渐变文字，醒目高级\n· 购买后到「仓库」选择帖子使用\n· 永久生效"}'
  WHERE type = 'post_decoration' AND name = '鎏金标题';
UPDATE shop_extras SET data = '{"description":"昵称旁显示自定义文字3天","detail":"· 昵称旁显示自定义文字（最多 30 字）\n· 购买后到「仓库」中使用\n· 持续 3 天，到期自动恢复\n· 与 VIP 永久头衔互斥（已有 VIP 头衔时需先清除）"}'
  WHERE type = 'custom_title';
