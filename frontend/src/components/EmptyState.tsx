import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

type EmptyTheme = 'default' | 'warning' | 'success' | 'info';

interface EmptyStateProps {
  icon?: string | IconDefinition;
  title: string;
  description?: string;
  action?: { label: string; to: string };
  theme?: EmptyTheme;
}

const themeStyles: Record<EmptyTheme, { bg: string; border: string; title: string; desc: string; icon: string }> = {
  default: { bg: '', border: '', title: 'text-gray-700', desc: 'text-gray-400', icon: 'text-primary-400' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', title: 'text-amber-800 dark:text-amber-200', desc: 'text-amber-600 dark:text-amber-300/80', icon: 'text-amber-400' },
  success: { bg: 'bg-green-50', border: 'border-green-200', title: 'text-green-800 dark:text-green-200', desc: 'text-green-600 dark:text-green-300/80', icon: 'text-green-400' },
  info:    { bg: 'bg-blue-50', border: 'border-blue-200', title: 'text-blue-800 dark:text-blue-200', desc: 'text-blue-600 dark:text-blue-300/80', icon: 'text-blue-400' },
};

export default function EmptyState({ icon = faInbox, title, description, action, theme = 'default' }: EmptyStateProps) {
  const s = themeStyles[theme];
  return (
    <div className={`text-center py-16 px-4 rounded-2xl ${s.bg} ${s.border} ${theme !== 'default' ? 'border' : ''}`}>
      <div className={`mb-4 opacity-60 flex justify-center ${s.icon}`}>
        {typeof icon === 'string' ? (
          <span className="text-5xl">{icon}</span>
        ) : (
          <FontAwesomeIcon icon={icon} className="text-5xl" />
        )}
      </div>
      <h3 className={`text-lg font-semibold mb-2 ${s.title}`}>{title}</h3>
      {description && <p className={`text-sm mb-4 max-w-xs mx-auto ${s.desc}`}>{description}</p>}
      {action && (
        <Link to={action.to} className="inline-block bg-primary-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-primary-700 transition active:scale-95">
          {action.label}
        </Link>
      )}
    </div>
  );
}
