-- 道具详情扩充：在售道具的 data 增加 detail 字段（完整特性说明，前端"查看详情"弹窗展示）
UPDATE shop_extras SET data = '{"duration_days":30,"description":"为你的头像添加个性化边框","detail":"· 为头像添加个性化边框，资料页/评论/列表全站展示\n· 购买后到「仓库」选择使用\n· 持续 30 天，到期自动失效\n· 可叠加续期，总时长不限"}'
  WHERE type = 'item_avatar_frame';
UPDATE shop_extras SET data = '{"duration_days":7,"description":"帖子标题显示炫彩渐变动画","detail":"· 帖子标题显示炫彩渐变动画效果\n· 在「仓库」或发帖页对帖子使用\n· 持续 7 天，到期自动失效\n· 全站唯一动态标题特效，醒目吸睛"}'
  WHERE type = 'item_rainbow_title';
UPDATE shop_extras SET data = '{"description":"帖子进入首页侧边栏推荐位展示12小时","detail":"· 帖子进入首页侧边栏「🔥 推荐」曝光位\n· 每次使用增加 12 小时推荐时长，可重复使用续费\n· 单个帖子累计推荐时长上限 3 天（72 小时）\n· 推荐位共 5 个槽位，先到先得，到期自动下架\n· 槽位满时：可支付「被挤者剩余时长价值 × 2」的挤人费抢占\n· 被挤下的帖子自动获得剩余价值 × 1.15 的积分补偿\n· 不占用「效果管理」机会，不影响主页列表正常排序"}'
  WHERE type = 'item_bump';
UPDATE shop_extras SET data = '{"description":"帖子列表金色高亮，持续24小时","detail":"· 帖子在主页列表显示金色高亮背景与左侧色条\n· 持续 24 小时，到期自动恢复普通样式\n· 在「仓库」中选择帖子使用\n· 仅自己的帖子可用"}'
  WHERE type = 'item_highlight';
UPDATE shop_extras SET data = '{"description":"自己的帖子置顶24小时","detail":"· 帖子置顶显示（列表顶部固定位置）\n· 持续 24 小时\n· 在「仓库」中选择帖子使用\n· 管理员可随时取消置顶\n· 与推荐位互不冲突，可同时生效"}'
  WHERE type = 'item_pin_top';
UPDATE shop_extras SET data = '{"description":"发帖时挂一个积分红包，评论区可抢","detail":"· 发帖时可挂一个积分红包，评论区用户评论即抢\n· 发帖时自动消耗 1 张红包卡\n· 红包总额 1-10000 积分，份数 1-100 份\n· 每份金额随机分配（二倍均值法），手气最佳有专属标识\n· 未抢完可随时取消，剩余积分全额退回\n· 抢红包进度与排行在帖子详情页实时展示"}'
  WHERE type = 'item_red_packet';
UPDATE shop_extras SET data = '{"description":"在不支持匿名的板块匿名发帖","detail":"· 在不支持匿名的板块匿名发帖\n· 发帖时自动消耗：支持匿名的板块 1 张，不支持匿名的板块 3 张\n· 新用户注册自动获得 2 张\n· 匿名帖前台一律显示「匿名同学」，仅管理员可见真实作者\n· 收藏/详情等所有页面均脱敏展示"}'
  WHERE type = 'item_anonymous_card';
UPDATE shop_extras SET data = '{"description":"给帖子设置专属渐变背景","detail":"· 为帖子设置专属渐变背景（6 种样式可选）\n· 发帖时选择背景自动消耗 1 张；也可在「效果管理」中更换\n· 每个帖子仅一次「效果管理」机会（换背景/取消背景/加装饰）\n· 暗色模式下自动适配深色渐变，阅读不刺眼\n· 背景仅自己帖子可用"}'
  WHERE type = 'item_post_bg';

-- shop_items 渠道的 3 个商品 + 自定义称号
UPDATE shop_items SET data = '{"description":"修改一次用户名","detail":"· 修改一次用户名（仅此渠道可获得）\n· 购买后到「仓库」使用\n· 改名后所有页面同步更新新用户名\n· 永久生效，不消耗其他资源"}'
  WHERE type = 'rename_card';
UPDATE shop_items SET data = '{"css_class":"decoration-border-simple","description":"帖子卡片添加天蓝色边框","detail":"· 帖子卡片添加天蓝色细边框\n· 购买后到「仓库」选择帖子使用\n· 永久生效（与背景卡互不冲突）"}'
  WHERE type = 'post_decoration' AND name = '简约边框';
UPDATE shop_items SET data = '{"css_class":"decoration-title-gold","description":"帖子标题变为金色渐变文字","detail":"· 帖子标题变为金色渐变文字，醒目高级\n· 购买后到「仓库」选择帖子使用\n· 永久生效"}'
  WHERE type = 'post_decoration' AND name = '鎏金标题';
UPDATE shop_extras SET data = '{"description":"昵称旁显示自定义文字3天","detail":"· 昵称旁显示自定义文字（最多 30 字）\n· 购买后到「仓库」中使用\n· 持续 3 天，到期自动恢复\n· 与 VIP 永久头衔互斥（已有 VIP 头衔时需先清除）"}'
  WHERE type = 'custom_title';
