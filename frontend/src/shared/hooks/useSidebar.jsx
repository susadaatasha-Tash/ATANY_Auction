// Shared sidebar open/close state for the customer portal.
// Provides the same sidebar/drawer state already used by CustomerLayout's
// Topbar so page-owned headers (e.g. My Purchases) can show the same
// hamburger menu without duplicating the sidebar implementation.
import { createContext, useContext } from 'react';

const SidebarContext = createContext({
  open: false,
  toggle: () => {},
  setOpen: () => {},
  sidebarCollapsed: false,
  toggleCollapsed: () => {},
});

export function SidebarProvider({ children, value }) {
  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
