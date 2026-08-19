import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSync, faBolt, faClipboard } from '@fortawesome/free-solid-svg-icons';

interface Props {
  children: ReactNode;
  locationKey?: string; // 路由变化时用于重置错误态
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

function isChunkLoadError(error: Error): boolean {
  const msg = error.message || '';
  return msg.includes('dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    (msg.includes('Loading chunk') && msg.includes('failed'));
}

// 复制到剪贴板
function copyError(error: Error) {
  const text = `错误: ${error.message}\n堆栈: ${error.stack || '无'}\n时间: ${new Date().toISOString()}`;
  navigator.clipboard.writeText(text).then(() => {
    alert('错误信息已复制，请发送给站长');
  }).catch(() => {
    // fallback: 选中文本
    const el = document.querySelector('.error-detail');
    if (el) {
      const range = document.createRange();
      range.selectNode(el);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  });
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  // 路由变化（pathname）时自动重置错误态：点「返回首页」等导航后不再停留在错误页
  componentDidUpdate(prevProps: Props) {
    if (prevProps.locationKey !== this.props.locationKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, isChunkError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      const { error, isChunkError } = this.state;
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="text-center max-w-lg w-full">
            <div className="text-5xl mb-4"><FontAwesomeIcon icon={isChunkError ? faSync : faBolt} /></div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              {isChunkError ? '新版本已发布' : '页面出错了'}
            </h1>
            <p className="text-sm text-gray-500 mb-4">
              {isChunkError
                ? '检测到新版本已部署，旧资源已被替换。请刷新页面以加载最新版本。'
                : '发生了意外错误，请尝试刷新页面。'}
            </p>

            {/* 错误详情 — 可选中复制 */}
            <div className="error-detail mb-4 bg-gray-100 rounded-lg p-3 text-left text-xs font-mono text-gray-700 whitespace-pre-wrap break-all select-all max-h-32 overflow-y-auto border border-gray-200">
              {error?.message || '未知错误'}
              {error?.stack ? '\n\n' + error.stack : ''}
            </div>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition"
              >
                刷新页面
              </button>
              <button
                onClick={() => error && copyError(error)}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                📋 复制错误信息
              </button>
              <Link
                to="/"
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                返回首页
              </Link>
            </div>
            <p className="mt-4 text-xs text-gray-400">
              如问题持续，请复制上方错误信息并反馈给站长
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// 函数式包装：用 useLocation 监听路由变化，pathname 改变时通知 ErrorBoundary 重置错误态
function ErrorBoundaryWithReset({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary locationKey={location.pathname}>{children}</ErrorBoundary>;
}

export default ErrorBoundaryWithReset;
