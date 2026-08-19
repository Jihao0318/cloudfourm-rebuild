import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

export function PostCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-start gap-3 mb-3">
        <Skeleton circle width={40} height={40} />
        <div className="flex-1">
          <Skeleton width={120} height={16} />
          <Skeleton width={80} height={12} className="mt-1" />
        </div>
      </div>
      <Skeleton width="80%" height={18} className="mb-2" />
      <Skeleton width="100%" height={14} count={2} className="mb-1" />
      <div className="flex gap-4 mt-3">
        <Skeleton width={60} height={14} />
        <Skeleton width={60} height={14} />
        <Skeleton width={60} height={14} />
      </div>
    </div>
  );
}

export function PostListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function PostDetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto">
      <Skeleton width={80} height={36} className="mb-5 rounded-xl" />
      <div className="bg-white rounded-2xl border overflow-hidden mb-6 p-5">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton circle width={48} height={48} />
          <div>
            <Skeleton width={150} height={18} />
            <Skeleton width={200} height={14} className="mt-1" />
          </div>
        </div>
        <Skeleton width="60%" height={24} className="mb-4" />
        <Skeleton width="100%" height={14} count={6} className="mb-2" />
        <Skeleton width="90%" height={14} count={4} className="mb-2" />
      </div>
      <div className="bg-white rounded-2xl border p-6">
        <Skeleton width={100} height={20} className="mb-4" />
        <Skeleton width="100%" height={14} count={3} />
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="bg-white rounded-2xl border overflow-hidden">
        <Skeleton height={160} className="!rounded-none" />
        <div className="px-5 pb-5">
          <div className="flex items-center gap-4 -mt-10 mb-3">
            <Skeleton circle width={80} height={80} />
            <div className="flex-1 pt-10">
              <Skeleton width={150} height={22} />
              <Skeleton width={100} height={14} className="mt-1" />
            </div>
          </div>
          <Skeleton width="80%" height={14} count={2} />
        </div>
      </div>
      <div className="bg-white rounded-2xl border p-6">
        <Skeleton width={100} height={18} className="mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} width="100%" height={60} className="rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CommentSkeleton() {
  return (
    <div className="py-5 border-b border-gray-100">
      <div className="flex items-start gap-3">
        <Skeleton circle width={32} height={32} />
        <div className="flex-1">
          <Skeleton width={100} height={14} />
          <Skeleton width="100%" height={14} count={2} className="mt-2" />
        </div>
      </div>
    </div>
  );
}
