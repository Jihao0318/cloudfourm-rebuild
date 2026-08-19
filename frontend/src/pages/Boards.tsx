import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { categories as categoriesApi } from '../services/api';
import type { Category } from '../types';
import { Helmet } from 'react-helmet-async';
import { faThumbtack } from '@fortawesome/free-solid-svg-icons';
import EmptyState from '../components/EmptyState';

export default function Boards() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    categoriesApi.list().then(res => {
      if (res.success && res.data) setCategories(res.data);
      else setError(res.error || '加载失败');
    }).catch((err: any) => setError(err.message || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Helmet><title>板块 - CloudForum</title></Helmet>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">板块</h1>
        {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <EmptyState icon={faThumbtack} title="暂无板块" description="还没有开通任何板块" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map(cat => (
              <Link
                key={cat.id}
                to={`/?categoryId=${cat.id}`}
                className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 block"
              >
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                  <div className="flex items-center gap-1.5">
                    {cat.allow_thanks === 1 && (
                      <span className="text-[10px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded font-medium shrink-0">支持感谢</span>
                    )}
                    {cat.allow_anonymous === 1 && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium shrink-0">支持匿名</span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-500">{cat.description || '暂无描述'}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}