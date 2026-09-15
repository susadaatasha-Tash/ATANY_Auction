// frontend/src/shared/components/Toast.jsx
// Extracted from repeated showToast() in every HTML file:
// atany-landing-page.html:1493, admin.html:1718, customer-dashboard.html:659
import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);

  const showToast = useCallback((message) => {
    setMsg(message);
    setVisible(true);
    setTimeout(() => setVisible(false), 2600);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={`toast ${visible ? 'show' : ''}`}>{msg}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
};
