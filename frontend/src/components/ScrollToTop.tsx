import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * 路由切换滚动控制：
 * - PUSH/REPLACE（点链接前进到新页面）→ 滚回页面顶部
 * - POP（浏览器/返回按钮后退）→ 不干预滚动；首页等列表页由各自的
 *   缓存恢复机制处理（Home.tsx：缓存数据渲染 + 精确滚回离开时的位置）
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0);
    }
  }, [pathname, navigationType]);

  return null;
}
