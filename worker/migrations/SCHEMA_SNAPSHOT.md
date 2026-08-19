# 数据库 Schema 快照

当前最终 schema（由 12 个迁移文件叠加而成，此为汇总文档）。

## 表一览

| 表名 | 用途 | 创建迁移 |
|---|---|---|
| `users` | 用户 | 001_init + 003 + 006 |
| `categories` | 分类 | 001_init |
| `posts` | 帖子 | 001_init |
| `comments` | 评论 | 001_init |
| `likes` | 点赞 | 001_init |
| `verifications` | 验证码 | 001_init / 002_fix |
| `settings` | 系统设置 | 001_init |
| `page_views` | 浏览统计 | 001_init / 002_fix |
| `user_balances` | 用户积分余额 | 007 |
| `check_ins` | 签到记录 | 007 |
| `user_vips` | VIP 会员 | 007 |
| `coin_transactions` | 积分交易记录 | 007（010 重建） |
| `reports` | 举报 | 008 + 009 |
| `lottery_records` | 抽奖记录 | 010 |

---

## 各表完整字段

### `users`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 用户 ID | 001 |
| `username` | TEXT UNIQUE NOT NULL | 用户名 | 001 |
| `email` | TEXT UNIQUE NOT NULL | 邮箱 | 001 |
| `password_hash` | TEXT NOT NULL | 密码哈希 | 001 |
| `avatar_url` | TEXT DEFAULT '' | 头像 URL | 001 |
| `bio` | TEXT DEFAULT '' | 个人简介 | 001 |
| `role` | TEXT DEFAULT 'user' | 角色: user/moderator/admin | 001 |
| `twofa_secret` | TEXT | 2FA 密钥 | 001 |
| `twofa_enabled` | INTEGER DEFAULT 0 | 2FA 开关 | 001 |
| `email_verified` | INTEGER DEFAULT 0 | 邮箱已验证 | 001 |
| `notify_on_reply` | INTEGER DEFAULT 1 | 回复通知 | 001 |
| `notify_on_like` | INTEGER DEFAULT 1 | 点赞通知 | 001 |
| `created_at` | TEXT | 注册时间 | 001 |
| `updated_at` | TEXT | 更新时间 | 001 |
| `banned_until` | TEXT | 封禁截止时间 | 003 |
| `deleted_at` | TEXT | 软删除时间 | 003 |
| `scheduled_deleted_at` | TEXT | 计划删除时间（注销冷静期） | 006 |

### `categories`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 分类 ID | 001 |
| `name` | TEXT NOT NULL | 名称 | 001 |
| `slug` | TEXT UNIQUE NOT NULL | URL 别名 | 001 |
| `description` | TEXT DEFAULT '' | 描述 | 001 |
| `sort_order` | INTEGER DEFAULT 0 | 排序 | 001 |
| `created_at` | TEXT | 创建时间 | 001 |

### `posts`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 帖子 ID | 001 |
| `user_id` | INTEGER NOT NULL FK→users | 作者 | 001 |
| `title` | TEXT NOT NULL | 标题 | 001 |
| `content` | TEXT NOT NULL | 内容 | 001 |
| `category_id` | INTEGER FK→categories | 分类 | 001 |
| `is_pinned` | INTEGER DEFAULT 0 | 置顶 | 001 |
| `is_locked` | INTEGER DEFAULT 0 | 锁定 | 001 |
| `view_count` | INTEGER DEFAULT 0 | 浏览数 | 001 |
| `like_count` | INTEGER DEFAULT 0 | 点赞数 | 001 |
| `comment_count` | INTEGER DEFAULT 0 | 评论数 | 001 |
| `created_at` | TEXT | 发布时间 | 001 |
| `updated_at` | TEXT | 更新时间 | 001 |
| `deleted_at` | TEXT | 软删除时间 | 001 |

### `comments`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 评论 ID | 001 |
| `post_id` | INTEGER NOT NULL FK→posts | 所属帖子 | 001 |
| `user_id` | INTEGER NOT NULL FK→users | 作者 | 001 |
| `parent_id` | INTEGER FK→comments | 父评论（多级回复） | 001 |
| `content` | TEXT NOT NULL | 内容 | 001 |
| `like_count` | INTEGER DEFAULT 0 | 点赞数 | 001 |
| `created_at` | TEXT | 发布时间 | 001 |
| `deleted_at` | TEXT | 软删除时间 | 001 |

### `likes`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 点赞 ID | 001 |
| `user_id` | INTEGER NOT NULL FK→users | 点赞者 | 001 |
| `target_id` | INTEGER NOT NULL | 目标 ID | 001 |
| `target_type` | TEXT NOT NULL (post/comment) | 目标类型 | 001 |
| `created_at` | TEXT | 时间 | 001 |
| *UNIQUE(user_id, target_id, target_type)* | | | |

### `verifications`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 验证码 ID | 001 |
| `user_id` | INTEGER NOT NULL FK→users | 用户 | 001 |
| `type` | TEXT NOT NULL | 类型: email_verify/password_reset/twofa | 001 |
| `code` | TEXT NOT NULL | 验证码 | 001 |
| `expires_at` | TEXT NOT NULL | 过期时间 | 001 |
| `used` | INTEGER DEFAULT 0 | 是否已使用 | 001 |
| `created_at` | TEXT | 创建时间 | 001 |

### `settings`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `key` | TEXT PK | 设置键 | 001 |
| `value` | TEXT NOT NULL | 设置值 | 001 |
| `updated_at` | TEXT | 更新时间 | 001 |

默认值: `site_name=CloudForum`, `site_description=...`, `registration_open=true`, `require_email_verify=true`

### `page_views`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 浏览 ID | 001 |
| `post_id` | INTEGER NOT NULL FK→posts | 帖子 | 001 |
| `visitor_id` | TEXT | 访客标识（IP 或用户 ID） | 001 |
| `viewed_at` | TEXT DEFAULT datetime('now') | 浏览时间 | 001 |

### `user_balances`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `user_id` | INTEGER PK FK→users | 用户 ID | 007 |
| `coins` | INTEGER DEFAULT 0 | 当前积分 | 007 |
| `total_earned` | INTEGER DEFAULT 0 | 累计赚取 | 007 |
| `total_spent` | INTEGER DEFAULT 0 | 累计花费 | 007 |

### `check_ins`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 签到 ID | 007 |
| `user_id` | INTEGER NOT NULL FK→users | 用户 | 007 |
| `check_in_date` | TEXT NOT NULL | 签到日期 | 007 |
| `streak` | INTEGER DEFAULT 1 | 连续天数 | 007 |
| `coins_earned` | INTEGER DEFAULT 0 | 获得积分 | 007 |
| `created_at` | TEXT DEFAULT CURRENT_TIMESTAMP | 签到时间 | 007 |
| *UNIQUE(user_id, check_in_date)* | | | |

### `user_vips`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `user_id` | INTEGER PK FK→users | 用户 | 007 |
| `tier` | TEXT DEFAULT 'none' | 等级: none/vip/s-vip/svip+ | 007 |
| `started_at` | TEXT | 开始时间 | 007 |
| `expires_at` | TEXT | 到期时间 | 007 |
| `auto_renew` | INTEGER DEFAULT 0 | 自动续费 | 007 |

### `coin_transactions`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 交易 ID | 007(重建010) |
| `user_id` | INTEGER NOT NULL FK→users | 用户 | 007 |
| `type` | TEXT NOT NULL | 类型(无 CHECK 约束) | 007 |
| `amount` | INTEGER NOT NULL | 变动金额 | 007 |
| `balance_after` | INTEGER NOT NULL | 变动后余额 | 007 |
| `description` | TEXT | 描述 | 007 |
| `created_at` | TEXT DEFAULT CURRENT_TIMESTAMP | 时间 | 007 |

### `reports`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 举报 ID | 008 |
| `post_id` | INTEGER NOT NULL FK→posts | 帖子 ID | 008 |
| `reporter_id` | INTEGER NOT NULL FK→users | 举报者 | 008 |
| `reason` | TEXT NOT NULL | 举报原因 | 008 |
| `status` | TEXT DEFAULT 'pending' | 状态: pending/resolved/dismissed | 008 |
| `created_at` | TEXT | 时间 | 008 |
| `target_type` | TEXT DEFAULT 'post' | 目标类型: post/comment | 009 |
| `target_id` | INTEGER | 目标 ID | 009 |

### `lottery_records`

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 记录 ID | 010 |
| `user_id` | INTEGER NOT NULL FK→users | 用户 | 010 |
| `prize_name` | TEXT NOT NULL | 奖品名称 | 010 |
| `prize_coins` | INTEGER DEFAULT 0 | 奖品积分 | 010 |
| `prize_type` | TEXT DEFAULT 'coins' | 奖品类型 | 010 |
| `prize_value` | TEXT | 奖品值 | 010 |
| `cycle` | INTEGER NOT NULL | 第几轮7天 | 010 |
| `claimed` | INTEGER DEFAULT 0 | 是否已领取 | 010 |
| `created_at` | TEXT DEFAULT CURRENT_TIMESTAMP | 时间 | 010 |

---

## 索引汇总

| 索引名 | 表 | 列 | 来源 |
|---|---|---|---|
| `idx_posts_category` | posts | category_id | 001 |
| `idx_posts_user` | posts | user_id | 001 |
| `idx_posts_created` | posts | created_at | 001 |
| `idx_posts_pinned` | posts | is_pinned DESC | 001 |
| `idx_comments_post` | comments | post_id | 001 |
| `idx_comments_parent` | comments | parent_id | 001 |
| `idx_likes_target` | likes | target_id, target_type | 001 |
| `idx_likes_user` | likes | user_id | 001 |
| `idx_page_views_post` | page_views | post_id | 001 |
| `idx_page_views_date` | page_views | viewed_at | 002 |
| `idx_verifications_user` | verifications | user_id, type | 002 |
| `idx_users_banned` | users | banned_until | 003 |
| `idx_users_scheduled_delete` | users | scheduled_deleted_at | 006 |
| `idx_check_ins_user_date` | check_ins | user_id, check_in_date | 007 |
| `idx_check_ins_date` | check_ins | check_in_date | 007 |
| `idx_coin_tx_user` | coin_transactions | user_id, created_at | 007(重建010) |
| `idx_lottery_user_cycle` | lottery_records | user_id, cycle | 010 |
| `idx_lottery_user_unclaimed` | lottery_records | user_id, claimed | 010 |
| `idx_page_views_dedup` | page_views | post_id, visitor_id, viewed_at | 011 |

## 迁移顺序

```
000_rebuild.sql → 001_init.sql → 002_fix_tables.sql → 003_ban_and_delete.sql
→ 005_hard_delete_soft_deleted.sql → 006_scheduled_deletion.sql
→ 007_vip_checkin_coins.sql → 008_reports.sql → 009_reports_comments.sql
→ 010_lottery.sql → 011_page_views_dedup_index.sql
```

注意：`010_lottery.sql` 重建了 `coin_transactions` 表（移除了旧 CHECK 约束），数据从旧表迁移。`005` 是硬删除清洗脚本，非增量变更。
