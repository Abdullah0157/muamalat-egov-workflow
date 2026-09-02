import { Role } from '../core/models/domain';
import { IconName } from '../shared/ui/icon/icon';

export interface NavItem {
  readonly labelKey: string;
  readonly icon: IconName;
  readonly link: string;
  /** Only highlight when the address matches exactly, for section landing pages. */
  readonly exact: boolean;
}

export interface NavSection {
  readonly labelKey: string;
  readonly roles: readonly Role[];
  readonly items: readonly NavItem[];
}

/**
 * Navigation is derived from the signed in role rather than rendered and then
 * hidden. A citizen's browser is never sent the addresses of the oversight
 * screens, and the sections a role can see are the sections it can reach.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    labelKey: 'nav.sectionCitizen',
    roles: ['citizen'],
    items: [
      { labelKey: 'nav.myRequests', icon: 'folder', link: '/citizen', exact: true },
      { labelKey: 'nav.newRequest', icon: 'plus', link: '/citizen/new', exact: false },
    ],
  },
  {
    labelKey: 'nav.sectionOfficer',
    roles: ['officer', 'supervisor'],
    items: [{ labelKey: 'nav.workQueue', icon: 'inbox', link: '/officer', exact: true }],
  },
  {
    labelKey: 'nav.sectionSupervisor',
    roles: ['supervisor'],
    items: [{ labelKey: 'nav.dashboard', icon: 'chart', link: '/supervisor', exact: true }],
  },
  {
    labelKey: 'nav.sectionAdmin',
    roles: ['admin'],
    items: [{ labelKey: 'nav.workflows', icon: 'workflow', link: '/admin', exact: true }],
  },
];

export function sectionsForRole(role: Role | null): readonly NavSection[] {
  if (role === null) {
    return [];
  }
  return NAV_SECTIONS.filter((section) => section.roles.includes(role));
}
