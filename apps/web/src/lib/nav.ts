/**
 * Sidebar entries. A new private page is a folder in `src/app/(app)/` plus one line here.
 * `icon` is the `d` attribute of a 24x24 stroke icon.
 */
export const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: 'M4 13h6V4H4v9Zm0 7h6v-3H4v3Zm10 0h6v-9h-6v9Zm0-16v3h6V4h-6Z',
  },
  {
    href: '/vehicles',
    label: 'Vehicles',
    icon: 'M3 17h2m10 0H9m10 0h2M3 17v-5l2-5h11l3 4 2 1v5M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  },
] as const;
