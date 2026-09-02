import { Routes } from '@angular/router';

/**
 * Oversight.
 *
 * One screen, lazily loaded like every other area, so an officer or a citizen
 * never downloads the reporting code they cannot reach.
 */
export const supervisorRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./dashboard-page').then((m) => m.DashboardPage),
  },
];
