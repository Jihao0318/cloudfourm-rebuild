-- 049_ban_reason.sql
-- 封禁原因：管理员封禁时可填写原因，解封审核时展示；解封时清空
ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT '';