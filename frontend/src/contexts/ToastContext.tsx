import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = nextId++;
    setItems(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setItems(prev => prev.filter(item => item.id !== id));
    }, 2500);
  }, []);

  const remove = (id: number) => setItems(prev => prev.filter(item => item.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none max-w-[calc(100vw_-_2rem)]">
        {items.map(item => (
          <div
            key={item.id}
            onClick={() => remove(item.id)}
            className={`pointer-events-auto cursor-pointer px-5 py-2.5 rounded-xl text-sm font-medium shadow-lg transition-all duration-300 animate-toast-in ${
              item.type === 'success' ? 'bg-green-600 text-white' :
              item.type === 'error' ? 'bg-red-600 text-white' :
              'bg-gray-800 text-white'
            }`}
            role={item.type === 'error' ? 'alert' : 'status'}
            aria-live={item.type === 'error' ? 'assertive' : 'polite'}
          >
            {item.type === 'success' ? '✓ ' : item.type === 'error' ? '✕ ' : 'ℹ '}
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
