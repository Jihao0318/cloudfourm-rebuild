-- 033_cleanup_old_announcements.sql
-- 清理旧的"XXX 使用了大喇叭！"格式的公告

DELETE FROM user_announcements WHERE content LIKE '%使用了大喇叭%';
