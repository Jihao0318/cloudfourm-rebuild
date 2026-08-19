-- 045_missing_columns.sql
-- 补上从未被任何迁移添加、但代码引用到的列（生产库此前系手工 ALTER，新库会缺）

ALTER TABLE users ADD COLUMN custom_title TEXT DEFAULT '';