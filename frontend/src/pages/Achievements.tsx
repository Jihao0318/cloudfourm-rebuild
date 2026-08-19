import { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { achievementsApi } from '../services/api';
import type { AchievementHall } from '../types';
import { rarityMeta, rewardLabel } from '../utils/achievements';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import BackButton from '../components/BackButton';

type CategoryFilter = 'all' | 'campus' | 'patrol';

const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'campus', label: '🏫 校园成就' },
  { key: 'patrol', label: '🛡️ 巡查成就' },
];

// 成就殿堂：全站成就一览（公开页，未登录可看全量 + 达成人数；登录后显示个人解锁状态）
export default function Achievements() {
  const [data, setData] = useState<AchievementHall | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    achievementsApi.hall().then(res => {
      if (res.success && res.data) setData(res.data);
      else setError(res.error || '加载失败');
    }).catch((err: any) => setError(err.message || '加载失败')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="max-w-4xl mx-auto py-4 sm:py-6">
      <Helmet><title>成就殿堂 - CloudForum</title></Helmet>
      <Skeleton width="40%" height={28} className="mb-1" />
      <Skeleton width="30%" height={16} className="mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="p-4 rounded-xl border border-gray-100">
            <Skeleton width="50%" height={12} className="mb-2" />
            <Skeleton width="60%" height={20} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="p-3 rounded-xl border border-gray-100">
            <Skeleton width={28} height={28} className="mb-2" />
            <Skeleton width="70%" height={14} className="mb-1" />
            <Skeleton width="90%" height={12} className="mb-2" />
            <Skeleton width="55%" height={12} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto py-4 sm:py-6 space-y-5">
      <Helmet><title>成就殿堂 - CloudForum</title></Helmet>

      <div>
        <div className="flex items-center gap-3 mb-1">
          <BackButton />
          <h1 className="text-2xl font-bold">🏛️ 成就殿堂</h1>
        </div>
        <p className="text-gray-500 text-sm mb-6 pl-10">全站成就一览 · 每项达成人数公开</p>
      </div>

      {error ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>成就殿堂加载失败：{error}</span>
          <button onClick={load}
            className="shrink-0 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">重试</button>
        </div>
      ) : !data ? (
        <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
      ) : (
        <>
          {/* 全站统计 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400 mb-1">总成就</div>
              <div className="text-xl font-bold text-gray-900">{data.total_count}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400 mb-1">全站解锁</div>
              <div className="text-xl font-bold text-gray-900">
                {data.total_unlocks.toLocaleString()}<span className="text-xs font-normal text-gray-400 ml-1">人次</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400 mb-1">平均每项</div>
              <div className="text-xl font-bold text-gray-900">
                {(data.total_unlocks / data.total_count).toFixed(1)}<span className="text-xs font-normal text-gray-400 ml-1">人次</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="text-xs text-gray-400 mb-1">我的已解锁</div>
              {data.my_unlocked != null ? (
                <div className="text-xl font-bold text-primary-600">{data.my_unlocked} 项</div>
              ) : (
                <div className="text-xs text-gray-400 leading-relaxed mt-1">登录查看我的进度</div>
              )}
            </div>
          </div>

          {/* 分类筛选 */}
          <div className="flex items-center gap-2 flex-wrap">
            {CATEGORY_FILTERS.map(f => (
              <button key={f.key} onClick={() => setCategory(f.key)}
                className={`px-3 py-2 min-h-[40px] whitespace-nowrap rounded-lg text-sm font-medium transition ${category === f.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {f.label}
              </button>
            ))}
          </div>

          {/* 成就卡片：突出全站达成人数 */}
          {(() => {
            // 已达成优先显示，其余按原顺序
            const list = (data.achievements || [])
              .filter(a => category === 'all' || a.category === category)
              .sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
            if (list.length === 0) {
              return <p className="text-xs text-gray-400 text-center py-6">该分类下暂无成就</p>;
            }
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map(a => {
                  const meta = rarityMeta(a.rarity);
                  return (
                    <div key={a.key} title={a.desc}
                      className={`p-4 rounded-xl border transition ${a.unlocked ? 'bg-primary-50 border-primary-300' : `${meta.card} opacity-80`}`}>
                      {/* 头部：勋章 + 状态标签 */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xl leading-none">{meta.medal}</span>
                        {a.unlocked ? (
                          <span className="shrink-0 text-[10px] font-medium bg-primary-600 text-white px-1.5 py-0.5 rounded-full">已达成 ✓</span>
                        ) : (
                          <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
                        )}
                      </div>
                      {/* 达成人数：主视觉元素（大数字醒目） */}
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className={`text-2xl font-bold leading-none ${a.unlocked ? 'text-primary-600' : 'text-gray-700'}`}>{a.count}</span>
                        <span className="text-xs text-gray-500">人达成</span>
                      </div>
                      {/* 成就名称 */}
                      <div className={`text-sm font-semibold truncate ${a.unlocked ? 'text-primary-700' : 'text-gray-800'}`}>{a.name}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{a.desc}</div>
                      {/* 奖励 */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(a.rewards || []).map((r, i) => (
                          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${meta.pill}`}>{rewardLabel(r)}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
