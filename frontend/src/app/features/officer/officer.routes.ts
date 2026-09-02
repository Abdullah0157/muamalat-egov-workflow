import { Routes } from '@angular/router';

/**
 * Case handling.
 *
 * Two screens: the queue an officer opens in the morning, and the file they
 * work inside for the rest of the day. The case is addressed by its public
 * reference rather than by an internal id, so an address pasted into a chat or
 * quoted down the phone opens the right file.
 */
export const officerRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./work-queue-page').then((m) => m.WorkQueuePage),
  },
  {
    path: ':reference',
    loadComponent: () => import('./case-detail-page').then((m) => m.CaseDetailPage),
  },
];
