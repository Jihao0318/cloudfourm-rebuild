# 巡查体系 v2 设计（举报审核 + 帖子巡查）

日期：2026-08-14
状态：已批准（用户确认后开始实现）
基线版本：771ea5f

## 背景

现有巡查体系（062/063/066 迁移）已有：帖子状态机（pending/cleared/questionable/violation）、多人复核投票（post_review_actions / report_review_actions）、管理员一票否决、巡查战绩与成就。本次在现有系统上**增量扩展**（方案一），实现：

1. 帖子巡查「有违规」= **打回重新编辑**（不再直接下架）
2. 票数阈值**举报/巡查各自独立配置**
3. 扣分金额后台可配
4. 待复核**双计数竞争**（先到阈值者生效，同时达标违规优先）
5. 打回重提后**票数清零重来**（轮次字段隔离），已审者不再显示
6. 打回后 1 天不修改 → 软删 + 扣分 + 通知
7. 投过任何票的内容不再显示给该巡查员（管理员除外）
8. 软删 N 天后自动硬删（默认 30 天）

## 1. 状态机与核心流程

### 帖子状态（posts.review_status）

现有：`pending` / `cleared` / `questionable` / `violation`
新增：`rejected`（打回待编辑）

### 帖子巡查线（moderation）

```
新帖自动进入 → pending（待巡查队列）
  ├─ 投「没问题」→ pass 票+1，达【巡查放行阈值】→ cleared（巡查过，移出队列）
  ├─ 投「存在疑虑」→ questionable → 进入待复核队列
  └─ 投「有违规」→ violation（第 1 票）→ 进入待复核队列

待复核队列（questionable / violation）：
  ├─ 投「没问题」→ pass 票+1，先达【巡查放行阈值】→ cleared
  ├─ 投「确认违规」→ confirm 票+1，先达【巡查违规阈值】→ rejected（打回）
  └─ 同时达标 → 违规优先（打回）
```

### 打回（rejected）

- 前台**仅作者本人可见可编辑**，其他人视为不存在
- 立即扣【打回扣分】（默认 50）+ 通知作者（附打回理由）
- 作者修改提交 → `review_round + 1`，状态回 `pending` 重新进待巡查；**票数清零重来**，但本轮投过票的巡查员不再看到它（轮次字段隔离）
- 打回后 1 天未修改 → cron 软删 + 再扣【打回扣分】+ 通知
- 打回重提不设次数上限（每次都是全新一轮）

### 举报审核线（admin/reports）

```
被举报内容（帖子/评论，同一目标多条举报合并）→ 待审核队列
  ├─ 投「无违规」→ pass 票+1，先达【举报放行阈值】→ 放行：取消该目标所有举报标记
  └─ 投「有违规」→ confirm 票+1，先达【举报违规阈值】→ 下架：软删 + 扣【举报下架扣分】+ 通知
  └─ 同时达标 → 违规优先
```

### 隐藏规则

巡查员投过任何票的内容（帖子巡查 + 举报审核）**不再显示给自己**；**管理员除外，始终可见全部**。管理员一票否决/一票通过保留。

### 软删生命周期

违规下架的帖子软删（deleted_at），保留【软删保留天数】默认 30 天后由 cron 自动硬删（复用现有 hardDeletePost，含红包退款）；期间管理员后台可见可恢复。

## 2. 数据模型（迁移 068）

```sql
ALTER TABLE posts ADD COLUMN rejected_at TEXT;
ALTER TABLE posts ADD COLUMN review_round INTEGER DEFAULT 0;
ALTER TABLE post_review_actions ADD COLUMN round INTEGER DEFAULT 0;
```

- `rejected_at`：打回时间，用于 1 天超时判断
- `review_round` / `round`：轮次隔离。计票与隐藏均按轮次过滤；UNIQUE(post_id, reviewer_id) 保留（隐藏规则保证同轮不重复投）

### 后台配置项（settings，7 个新键；旧 review_violation_limit / review_pass_limit 废弃不再读取）

| 键 | 默认值 | 用途 |
|---|---|---|
| patrol_pass_limit | 2 | 帖子巡查-放行票数 |
| patrol_violation_limit | 3 | 帖子巡查-违规票数 |
| report_pass_limit | 3 | 举报审核-放行票数 |
| report_violation_limit | 3 | 举报审核-违规票数 |
| review_reject_coins | 50 | 打回扣分（超时删除复用） |
| review_takedown_coins | 50 | 举报下架扣分 |
| soft_delete_retention_days | 30 | 软删保留天数 |

## 3. 后端 API 变更

- `GET /api/moderation/review-posts`：队列过滤改"本轮未投过任何票"（admin 豁免）；返回 4 个新阈值
- `POST /api/moderation/review-post`：投票逻辑改双计数竞争 + 轮次隔离 + 打回流程 + 配置化扣分
- `GET/POST /api/admin/reports*`：队列加隐藏规则；投票改双计数竞争 + 新阈值
- `GET /api/posts/:id` / 编辑：rejected 状态——作者本人可见可编辑（编辑提交即重新进队），其他人 404
- `index.ts` cron（每日 00:00）：① 超时打回帖（1 天）软删+扣分+通知；② 超保留期软删帖（30 天）硬删

## 4. 前端变更

- Moderator.tsx 巡查台：待巡查 3 按钮（放行/存疑/违规打回）、待复核 2 按钮（没问题/确认违规）；显示票数进度"违规 1/3、放行 1/2"；投过票后列表自动刷新消失
- Admin.tsx 系统设置：新增 7 个配置项输入；帖子管理增加软删帖"恢复"操作
- PostDetail/CreatePost：作者看到打回横幅（理由 + 重新编辑入口）；非作者对 rejected 帖显示不存在

## 5. 边界与保留项

- 管理员一票否决/通过：保留（现有）
- 防自审：保留（队列排除自己的帖子/自己标记的内容，admin 豁免）
- 巡查战绩/成就（user_patrol_stats、patrol exp）：原样保留，新动作继续计入
- 评论举报沿用同一套举报审核流程（阈值共用）
