// ===== 处理部署后 chunk 加载失败 =====
// 新部署导致旧 JS hash 失效时，在 React 挂载前捕获并提示用户刷新
window.addEventListener('unhandledrejection', (event) => {
  const err = event.reason;
  const msg = err?.message || String(err) || '';
  if (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      (msg.includes('Loading chunk') && msg.includes('failed'))) {
    event.preventDefault();
    if (document.getElementById('deploy-refresh-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'deploy-refresh-banner';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '99999',
      background: '#fef2f2', borderBottom: '2px solid #ef4444',
      padding: '16px 20px', textAlign: 'center', fontSize: '14px', color: '#991b1b',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    banner.innerHTML = `
      <div style="margin-bottom:8px;font-weight:600">🔄 新版本已发布，请刷新页面</div>
      <div style="font-size:12px;color:#b91c1c;margin-bottom:10px;word-break:break-all;font-family:monospace;background:#fff5f5;padding:6px 10px;border-radius:4px;display:inline-block;max-width:90%">
        ${escapeHtml(msg)}
      </div>
      <div>
        <a href="#" onclick="location.reload()" style="
          background:#2563eb; color:white; padding:7px 22px; border-radius:6px;
          text-decoration:none; font-weight:600; font-size:13px;
        ">刷新页面</a>
        <span style="margin-left:8px;font-size:12px;color:#b91c1c">如问题持续，请截图此提示反馈给站长</span>
      </div>
    `;
    document.body.prepend(banner);
  }
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider context={{ helmet: {} as any }}>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);
