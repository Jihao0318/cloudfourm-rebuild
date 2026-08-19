import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';

const upload = new Hono<{ Bindings: Env }>();

// 子应用内部 use 对自身路由生效：父级 app.use('/api/upload*', ...) 的尾段通配符
// 在 Hono 中不匹配子路径（upload* 被转义为字面量），鉴权必须挂在本子应用内部（与 moderation.ts 同款写法）
upload.use('*', requireAuth);

upload.post('/image', async (c) => {
  const telegraphUrl = c.env.TELEGRAPH_IMAGE_URL;
  if (!telegraphUrl) {
    return c.json({ success: false, error: '图床未配置' }, 500);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get('image') || formData.get('file');

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: '请选择要上传的图片' }, 400);
    }

    // SVG 是 XSS 载体且 magic bytes 检查过于宽松，不再允许
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ success: false, error: '不支持的文件类型' }, 400);
    }

    // 统一上传上限 20MB（所有用户一致，不再按 VIP 分档）
    // 必须在 arrayBuffer() 之前检查：File.size 在 formData 解析后即可用，
    // 否则超大文件会先被完整读入内存（内存 DoS）
    const MAX_MB = 20;
    if (file.size > MAX_MB * 1024 * 1024) {
      return c.json({ success: false, error: `文件大小不能超过 ${MAX_MB}MB` }, 400);
    }

    // Magic bytes 验证（防止伪造 MIME）：图片 + 常见视频容器
    const buffer = await file.arrayBuffer();
    const b = new Uint8Array(buffer.slice(0, 16));
    const isImage = (
      (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) ||                    // JPEG
      (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) ||   // PNG
      (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) ||   // GIF
      (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) // WebP (RIFF....WEBP)
    );
    const isVideo = (
      String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp' ||               // MP4/MOV (....ftyp)
      (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) ||   // WebM/MKV (EBML)
      (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && String.fromCharCode(b[8], b[9], b[10]) === 'AVI') // AVI (RIFF....AVI)
    );
    if (!isImage && !isVideo) {
      return c.json({ success: false, error: '文件内容不是有效的图片/视频格式' }, 400);
    }

    // 创建新 File 上传到图床
    const newFile = new File([buffer], file.name, { type: file.type });

    const fd = new FormData();
    fd.append('file', newFile, newFile.name);

    const resp = await fetch(`${telegraphUrl}/upload`, {
      method: 'POST',
      body: fd,
    });

    const raw = await resp.text();
    let result: any;
    try { result = JSON.parse(raw); } catch { 
      return c.json({ success: false, error: `图床返回非 JSON: ${raw.slice(0,100)}` }, 502);
    }

    const data = Array.isArray(result) ? result[0] : result;
    const src = data?.src || data?.url || '';
    if (!src) {
      return c.json({ success: false, error: `图床返回: ${JSON.stringify(result).slice(0,200)}` }, 502);
    }

    const imageUrl = src.startsWith('http') ? src : `${telegraphUrl.replace(/\/+$/, '')}/${src.replace(/^\/+/, '')}`;

    return c.json({
      success: true,
      data: { url: imageUrl, filename: file.name, size: file.size },
      message: '上传成功',
    });
  } catch (err: any) {
    return c.json({ success: false, error: `上传失败: ${err.message}` }, 500);
  }
});

export default upload;
