// frontend/src/roles/admin/lib/userLabels.js
// Single source of truth for how an account is presented in the admin portal.
// Role / status wording, avatar initials and "last active" formatting live
// here so no page has to re-implement them.

/** The roles the platform actually supports (public.users.role enum). */
export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrator' },
  { value: 'shop_owner', label: 'Shop Owner' },
  { value: 'customer', label: 'Customer' },
];

const ROLE_LABELS = ROLE_OPTIONS.reduce((acc, r) => {
  acc[r.value] = r.label;
  return acc;
}, {});

/** Accounts an ATANY administrator manages as platform staff / partner accounts. */
export const STAFF_ROLE_VALUES = ROLE_OPTIONS.filter((r) => r.value !== 'customer').map((r) => r.value);

/** The account states the platform actually supports (public.users.status enum). */
export const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'suspended', label: 'Suspended' },
];

const STATUS_LABELS = {
  active: 'Active',
  invited: 'Invited',
  on_leave: 'On Leave',
  suspended: 'Suspended',
};

/** Roles that are anchored to a branch (a shop has a home branch). */
export const BRANCH_SCOPED_ROLES = ['shop_owner'];

export function roleLabel(role) {
  if (!role) return '—';
  return ROLE_LABELS[role] || String(role).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusLabel(status) {
  if (!status) return '—';
  return STATUS_LABELS[status] || String(status).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Circular avatar initials from the account name (fallback: the email). */
export function initialsFor(name, email) {
  const src = (name || '').trim() || (email || '').trim();
  if (!src) return '—';
  if (src.includes('@')) {
    const parts = src.split('@')[0].split(/[._-]/).filter(Boolean);
    return (parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || src.charAt(0).toUpperCase());
  }
  const parts = src.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '—';
}

function formatClock(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

function formatDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Human readable "last active" from a real timestamp.
 * Never invents a value — an account that never signed in is "Never".
 */
export function formatLastActive(iso, now = new Date()) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = now.getTime() - d.getTime();
  if (diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  if (isSameDay(d, now)) return `Today, ${formatClock(d)}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (isSameDay(d, yesterday)) return `Yesterday, ${formatClock(d)}`;
  return formatDate(d);
}

/** "Invite sent · Sep 29" style label for pending invitations. */
export function formatInviteSent(iso) {
  if (!iso) return 'Invite sent';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Invite sent';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Invite sent · ${months[d.getMonth()]} ${d.getDate()}`;
}
