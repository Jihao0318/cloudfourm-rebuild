# 头像框扩展规范

## 头像框是什么

`Avatar` 组件（`src/components/Avatar.tsx`）根据用户的 `users.avatar_frame` 字段值，在 `FRAME_STYLES` 中查找对应的头像框定义并渲染。当前支持两种类型：

- **CSS 类型**：`className` 拼接到头像元素上（如 ring / shadow），无需图片资源；
- **图片类型**：`img` 透明底边框图片，以 `absolute` 叠加层渲染在头像之上，可表现任意复杂造型。

`FRAME_STYLES` 结构示例：

```ts
interface FrameDef {
  className?: string; // CSS 边框样式（拼到头像 className 上）
  img?: string;       // 图片边框（透明底，叠加渲染）
}

const FRAME_STYLES: Record<string, FrameDef> = {
  default: { className: 'ring-2 ring-purple-400 shadow-lg shadow-purple-200' },
};
```

## 给 AI 生成图片的规范

为新增头像框生成图片时，请严格遵循：

1. **透明背景 PNG**（或 WebP），不要带底色——边框图要叠在头像之上；
2. **建议 512×512，最小 256×256**，正方形；
3. **边框线绘制在图片四周**，中央区域保持透明（头像从透明区域露出）；
4. **命名**：`frame-{英文名}.png`，例如 `frame-royal.png`；
5. **存放位置**：`src/assets/frames/` 目录（即本目录）。

## 接入步骤（拿到图片后）

1. 将图片文件放入 `src/assets/frames/` 目录（如 `frame-royal.png`）；
2. 在 `src/components/Avatar.tsx` 的 `FRAME_STYLES` 中新增条目，`img` 填相对路径：

   ```ts
   const FRAME_STYLES: Record<string, FrameDef> = {
     default: { className: 'ring-2 ring-purple-400 shadow-lg shadow-purple-200' },
     royal: { img: '../assets/frames/frame-royal.png' },
   };
   ```

3. 后端如需限制取值，可在 `/items/use/avatar-frame` 的 frame 校验处或道具 meta 中注明允许的取值；当前后端不校验，前端可直接使用任意 frame 值；
4. 需要显示中文名时，在装饰与效果管理页（`src/pages/ActiveEffects.tsx`）新增 frame 值 → 中文名映射，例如：

   ```ts
   const FRAME_NAMES: Record<string, string> = {
     default: '紫罗兰',
     royal: '皇家金',
   };
   ```

## 现有枚举

| frame 值  | 类型        | 说明                     |
| --------- | ----------- | ------------------------ |
| `default` | CSS 类型    | 紫色 ring + 阴影（默认） |

> 未知 frame 值兜底显示 amber（琥珀色）ring，不会报错；过期（`avatar_frame_expires_at` 早于当前时间）时头像框自动隐藏。
