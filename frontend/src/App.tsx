import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Skeleton from 'react-loading-skeleton';

const Home = lazy(() => import('./pages/Home'));
const Boards = lazy(() => import('./pages/Boards'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ChangeEmail = lazy(() => import('./pages/ChangeEmail'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const InviteRedirect = lazy(() => import('./pages/InviteRedirect'));
const CreatePost = lazy(() => import('./pages/CreatePost'));
const PostDetail = lazy(() => import('./pages/PostDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));
const Moderator = lazy(() => import('./pages/Moderator'));
const Terms = lazy(() => import('./pages/Terms'));
const CheckIn = lazy(() => import('./pages/CheckIn'));
const Tasks = lazy(() => import('./pages/Tasks'));
const VIP = lazy(() => import('./pages/VIP'));
const Coins = lazy(() => import('./pages/Coins'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Shop = lazy(() => import('./pages/Shop'));
const Warehouse = lazy(() => import('./pages/Warehouse'));
const LotteryCoins = lazy(() => import('./pages/LotteryCoins'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Achievements = lazy(() => import('./pages/Achievements'));
const ActiveEffects = lazy(() => import('./pages/ActiveEffects'));
const RedPackets = lazy(() => import('./pages/RedPackets'));
const Appeal = lazy(() => import('./pages/Appeal'));

function PageSkeleton() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Skeleton height={40} className="mb-6" />
      <Skeleton height={20} count={6} className="mb-3" />
      <Skeleton height={20} count={4} className="mb-3" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="max-w-4xl mx-auto p-6 text-center">
      <h1 className="text-4xl font-bold text-gray-400 mb-4">404</h1>
      <p className="text-gray-500">页面不存在</p>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <ScrollToTop />
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Suspense fallback={<PageSkeleton />}><Home /></Suspense>} />
        <Route path="/boards" element={<Suspense fallback={<PageSkeleton />}><Boards /></Suspense>} />
        <Route path="/login" element={<Suspense fallback={<PageSkeleton />}><Login /></Suspense>} />
        <Route path="/register" element={<Suspense fallback={<PageSkeleton />}><Register /></Suspense>} />
        <Route path="/invite/:code" element={<Suspense fallback={<PageSkeleton />}><InviteRedirect /></Suspense>} />
        <Route path="/verify-email" element={<Suspense fallback={<PageSkeleton />}><VerifyEmail /></Suspense>} />
        <Route path="/change-email" element={<Suspense fallback={<PageSkeleton />}><ChangeEmail /></Suspense>} />
        <Route path="/forgot-password" element={<Suspense fallback={<PageSkeleton />}><ForgotPassword /></Suspense>} />
        <Route path="/create" element={<Suspense fallback={<PageSkeleton />}><CreatePost /></Suspense>} />
        <Route path="/post/:id" element={<Suspense fallback={<PageSkeleton />}><PostDetail /></Suspense>} />
        <Route path="/post/:id/edit" element={<Suspense fallback={<PageSkeleton />}><CreatePost /></Suspense>} />
        <Route path="/user/:id" element={<Suspense fallback={<PageSkeleton />}><Profile /></Suspense>} />
        <Route path="/profile" element={<Suspense fallback={<PageSkeleton />}><Profile /></Suspense>} />
        <Route path="/admin/*" element={<Suspense fallback={<PageSkeleton />}><Admin /></Suspense>} />
        <Route path="/moderator" element={<Suspense fallback={<PageSkeleton />}><Moderator /></Suspense>} />
        <Route path="/terms" element={<Suspense fallback={<PageSkeleton />}><Terms /></Suspense>} />
        <Route path="/check-in" element={<Suspense fallback={<PageSkeleton />}><CheckIn /></Suspense>} />
        <Route path="/tasks" element={<Suspense fallback={<PageSkeleton />}><Tasks /></Suspense>} />
        <Route path="/vip" element={<Suspense fallback={<PageSkeleton />}><VIP /></Suspense>} />
        <Route path="/coins" element={<Suspense fallback={<PageSkeleton />}><Coins /></Suspense>} />
        <Route path="/transactions" element={<Suspense fallback={<PageSkeleton />}><Transactions /></Suspense>} />
        <Route path="/shop" element={<Suspense fallback={<PageSkeleton />}><Shop /></Suspense>} />
        <Route path="/warehouse" element={<Suspense fallback={<PageSkeleton />}><Warehouse /></Suspense>} />
        <Route path="/lottery" element={<Suspense fallback={<PageSkeleton />}><LotteryCoins /></Suspense>} />
        <Route path="/leaderboard" element={<Suspense fallback={<PageSkeleton />}><Leaderboard /></Suspense>} />
        <Route path="/achievements" element={<Suspense fallback={<PageSkeleton />}><Achievements /></Suspense>} />
        <Route path="/active-effects" element={<Suspense fallback={<PageSkeleton />}><ActiveEffects /></Suspense>} />
        <Route path="/red-packets" element={<Suspense fallback={<PageSkeleton />}><RedPackets /></Suspense>} />
        <Route path="/appeal/:postId" element={<Suspense fallback={<PageSkeleton />}><Appeal /></Suspense>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
