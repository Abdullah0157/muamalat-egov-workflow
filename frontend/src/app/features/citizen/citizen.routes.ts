import { Routes } from '@angular/router';

/**
 * The citizen area.
 *
 * Three screens: everything you have filed, the wizard that files a new one,
 * and the record of a single request. Each is loaded on demand, so opening the
 * list does not download the wizard.
 *
 * The record route is keyed by the public reference number rather than the
 * internal id, because that is the string printed on the receipt and the one a
 * citizen will type or quote to the service desk. It is declared last so it
 * cannot swallow `new`.
 */
export const citizenRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./request-list-page').then((m) => m.RequestListPage),
  },
  {
    path: 'new',
    loadComponent: () => import('./new-request-page').then((m) => m.NewRequestPage),
  },
  {
    path: ':reference',
    loadComponent: () => import('./request-detail-page').then((m) => m.RequestDetailPage),
  },
];
