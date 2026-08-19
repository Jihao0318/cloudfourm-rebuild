import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdminRole } from '../middleware/auth';
import { parseId } from '../utils/validation';
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../db/queries';

const categories = new Hono<{ Bindings: Env }>();

// 分类列表 (公开；includeInactive=1 仅超管可见)
categories.get('/',
  (c, next) => c.req.query('includeInactive') === '1' ? requireAuth(c, next) : next(),
  (c, next) => c.req.query('includeInactive') === '1' ? requireAdminRole(c, next) : next(),
  async (c) => {
    const includeInactive = c.req.query('includeInactive') === '1';
    const cats = await listCategories(c.env.DB, includeInactive);
    return c.json({ success: true, data: cats });
  }
);

// 创建分类 (管理)
categories.post('/', requireAuth, requireAdminRole, async (c) => {
  const { name, slug, description, sort_order, allow_anonymous, allow_paid, allow_thanks } = await c.req.json();
  if (!name || !slug) return c.json({ success: false, error: '名称和标识不能为空' }, 400);

  const cat = await createCategory(c.env.DB, name, slug, description || '', sort_order || 0, allow_anonymous || 0, allow_paid || 0, allow_thanks || 0);
  if (!cat) return c.json({ success: false, error: '创建失败，标识可能已存在' }, 409);

  return c.json({ success: true, data: cat, message: '分类已创建' }, 201);
});

// 编辑分类 (管理)
categories.put('/:id', requireAuth, requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的分类ID' }, 400);
  const { name, slug, description, sort_order, allow_anonymous, is_active, allow_paid, allow_thanks } = await c.req.json();

  const existing = await getCategoryById(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: '分类不存在' }, 404);

  await updateCategory(c.env.DB, id, { name, slug, description, sort_order, allow_anonymous, is_active, allow_paid, allow_thanks });
  return c.json({ success: true, message: '分类已更新' });
});

// 删除分类 (管理)
categories.delete('/:id', requireAuth, requireAdminRole, async (c) => {
  const id = parseId(c.req.param('id'));
  if (id === null) return c.json({ success: false, error: '无效的分类ID' }, 400);
  const existing = await getCategoryById(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: '分类不存在' }, 404);

  await deleteCategory(c.env.DB, id);
  return c.json({ success: true, message: '分类已删除' });
});

export default categories;