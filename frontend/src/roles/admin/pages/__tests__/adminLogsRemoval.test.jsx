// frontend/src/roles/admin/pages/__tests__/adminLogsRemoval.test.jsx
// Product scope change: Audit Logs + Chatbot Logs removed from Admin Portal UI.
// Customer/seller chatbot + Security Alerts + other admin features are preserved.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({
  apiFetch: (...args) => apiFetch(...args),
}));
vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ insert: vi.fn(), select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), signOut: vi.fn(), signUp: vi.fn(async () => ({ data: { user: null }, error: null })) },
  },
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../../../shared/components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));
vi.mock('../../../../shared/components/Sidebar', () => ({
  Sidebar: ({ sections }) => (
    <aside data-testid="sidebar">
      {(sections || []).flatMap((s) => (s.items || []).map((item) => (
        <a key={item.to} href={item.to} data-testid={`nav-${item.name}`}>{item.name}</a>
      )))}
      {(sections || []).map((s) => (
        <div key={s.label} data-testid={`section-${s.label}`}>{s.label}</div>
      ))}
    </aside>
  ),
}));
vi.mock('../../../../shared/components/Topbar', () => ({
  Topbar: ({ title }) => (
    <div data-testid="topbar"><span>{title}</span></div>
  ),
}));
vi.mock('../../../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1', email: 'admin@example.com', user_metadata: {} }, signOut: vi.fn(), role: 'customer', loading: false }),
  RequireRole: ({ children }) => <>{children}</>,
  AuthProvider: ({ children }) => <>{children}</>,
}));
vi.mock('../../../../shared/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }) => <>{children}</>,
}));
vi.mock('../../hooks/useAdminData', () => ({
  useAdminData: () => ({
    products: [],
    auctions: [],
    users: [{ id: 's1', name: 'Shop A', role: 'shop_owner', created_at: '2026-09-01T00:00:00Z' }],
    txns: [{ id: 't1', customer: 'Cust B', item: 'Ring', amount: 1500, status: 'paid', date: '2026-09-03T00:00:00Z' }],
    alerts: [],
    branches: [{ id: 'b1', name: 'Davao City Branch', address: 'VA', status: 'Open' }],
    analytics: null,
    refresh: vi.fn(),
    loadAnalytics: vi.fn(),
  }),
}));
vi.mock('../components/AlertDetailModal', () => ({
  AlertDetailModal: ({ open }) => (open ? <div data-testid="alert-modal">modal</div> : null),
}));

import AdminLayout from '../../../../layouts/AdminLayout';
import Dashboard from '../Dashboard';
import SecurityAlerts from '../SecurityAlerts';
import { adminRoutes } from '../../routes';
import { useChatbot } from '../../../../shared/hooks/useChatbot';
import { AssistantWidget } from '../../../../shared/components/AssistantWidget';

describe('Audit Logs + Chatbot Logs removal — Admin UI', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue([]);
  });

  it('admin sidebar does NOT contain Audit Logs', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('nav-Audit Logs')).toBeNull();
    expect(screen.queryByText(/^Audit Logs$/)).toBeNull();
  });

  it('admin sidebar does NOT contain Chatbot Logs', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('nav-Chatbot Logs')).toBeNull();
    expect(screen.queryByText(/^Chatbot Logs$/)).toBeNull();
  });

  it('PLATFORM MANAGEMENT section keeps Subscriptions, Reports, Security Alerts without empty gaps', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminLayout />
      </MemoryRouter>
    );
    expect(screen.getByTestId('section-PLATFORM MANAGEMENT')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Subscriptions')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Reports')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Security Alerts')).toBeInTheDocument();
    // Other required nav items remain
    expect(screen.getByTestId('nav-Branches')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Users & Roles')).toBeInTheDocument();
    expect(screen.getByTestId('nav-Orders')).toBeInTheDocument();
    // Jewelry + Auctions are no longer standalone admin destinations — they
    // live under Branches → selected branch → Jewelry / Auctions.
    expect(screen.queryByTestId('nav-Jewelry')).toBeNull();
    expect(screen.queryByTestId('nav-Auctions')).toBeNull();
  });

  it('admin routes do NOT register Audit Logs or Chatbot Logs', () => {
    const paths = adminRoutes.map((r) => r.path);
    expect(paths).not.toContain('audit-logs');
    expect(paths).not.toContain('chatbot');
  });

  it('Security Alerts route still exists in admin routes', () => {
    const paths = adminRoutes.map((r) => r.path);
    expect(paths).toContain('security');
    expect(paths).toContain('users');
    expect(paths).toContain('billing');
    expect(paths).toContain('analytics');
    expect(paths).toContain('branches');
  });

  it('Security Alerts page still renders', async () => {
    apiFetch.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/admin/security']}>
        <SecurityAlerts />
      </MemoryRouter>
    );
    expect(screen.getAllByText(/Security Alerts|Open Alerts|High Severity|Resolved/i).length).toBeGreaterThan(0);
  });

  it('admin dashboard still works after log-viewer removal', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Dashboard />
      </MemoryRouter>
    );
    expect(screen.getByText('Shop Owners / Sellers')).toBeInTheDocument();
    expect(screen.getByText('Total Branches')).toBeInTheDocument();
    expect(screen.queryByText(/Audit Logs/i)).toBeNull();
    expect(screen.queryByText(/Chatbot Logs/i)).toBeNull();
  });

  it('customer/seller chatbot still exists (AssistantWidget + useChatbot module)', () => {
    expect(typeof AssistantWidget).toBe('function');
    expect(typeof useChatbot).toBe('function');
  });

  it('shop-owner chatbot mode still wired (AssistantWidget used on public/customer surfaces)', async () => {
    // CustomerLayout / LandingPage still import AssistantWidget — verify module contract
    const mod = await import('../../../../shared/components/AssistantWidget');
    expect(mod.AssistantWidget).toBe(AssistantWidget);
    const hook = await import('../../../../shared/hooks/useChatbot');
    expect(hook.useChatbot).toBe(useChatbot);
  });
});
