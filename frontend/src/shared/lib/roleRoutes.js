// frontend/src/shared/lib/roleRoutes.js
// Single source of truth for "where does this role belong".
// Used by the landing CTA, the landing footer and the account-status page so
// the role → route chain is not re-implemented in several places.
//
// The customer route is the customer dashboard ("/customer"). Shop owners go
// to the seller portal ("/shop"), admins to the admin portal ("/admin").
export const ROLE_HOME = Object.freeze({
  customer: '/customer',
  shop_owner: '/shop',
  admin: '/admin',
});

// Returns the portal route for a role, or null for an unknown/absent role.
export function roleHome(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_HOME, role) ? ROLE_HOME[role] : null;
}

// Route used by a suspended customer — they must land on the account-status
// notice, never on a normal customer flow that would let them bid.
export const ACCOUNT_SUSPENDED_ROUTE = '/account-suspended';
