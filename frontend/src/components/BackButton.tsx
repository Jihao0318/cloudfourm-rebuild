import { useNavigate } from 'react-router-dom';

// 全站统一返回按钮
export default function BackButton() {
  const navigate = useNavigate();
  const goBack = () => {
    // 直链进入（react-router history.state.idx 为 0，无站内历史）时 navigate(-1) 无效 → 回首页
    if ((window.history.state?.idx ?? 0) === 0) navigate('/');
    else navigate(-1);
  };
  return (
    <button onClick={goBack} className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:text-primary-600 hover:bg-primary-50 hover:border-primary-200 mb-5 transition text-sm font-medium">
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      返回
    </button>
  );
}
