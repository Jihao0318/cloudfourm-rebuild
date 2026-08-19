import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

// 邀请链接中转页：/invite/:code
// 未登录 → 跳注册页并自动填充邀请码；已登录 → 提示后回首页
export default function InviteRedirect() {
  const { code } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (loading) return; // 等登录态加载完成再判断
    if (user) {
      toast('你已登录，无需使用邀请链接', 'info');
      navigate('/', { replace: true });
    } else if (code) {
      navigate('/register', { state: { invite_code: code }, replace: true });
    } else {
      navigate('/register', { replace: true });
    }
  }, [loading, user, code, navigate, toast]);

  return null;
}
