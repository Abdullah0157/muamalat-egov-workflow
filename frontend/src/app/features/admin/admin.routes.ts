import { Routes } from '@angular/router';

/**
 * The administration area.
 *
 * The designer is by far the heavier of the two screens, so it stays in its own
 * lazy chunk: opening the register of definitions should not download a diagram
 * engine and two reactive forms.
 */
export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./workflow-list-page').then((m) => m.WorkflowListPage),
  },
  {
    path: 'workflows/:id',
    loadComponent: () => import('./workflow-designer-page').then((m) => m.WorkflowDesignerPage),
  },
];
