import { Routes } from '@angular/router';

import { redirectIfSignedIn, requireRole, routeToRoleHome } from './core/auth/role.guard';

/**
 * Sign in sits outside the shell because there is nothing to navigate yet.
 * Everything else is a child of the shell, including the error pages: someone
 * who lands on a wrong address keeps their navigation and can get out.
 *
 * Every area is lazily loaded, so an officer never downloads the workflow
 * designer and a citizen never downloads the reporting screens.
 */
export const routes: Routes = [
  {
    path: 'sign-in',
    canActivate: [redirectIfSignedIn],
    loadComponent: () => import('./features/auth/sign-in-page').then((m) => m.SignInPage),
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [routeToRoleHome],
        children: [],
      },
      {
        path: 'citizen',
        canActivate: [requireRole('citizen')],
        loadChildren: () =>
          import('./features/citizen/citizen.routes').then((m) => m.citizenRoutes),
      },
      {
        path: 'officer',
        canActivate: [requireRole('officer', 'supervisor')],
        loadChildren: () =>
          import('./features/officer/officer.routes').then((m) => m.officerRoutes),
      },
      {
        path: 'supervisor',
        canActivate: [requireRole('supervisor')],
        loadChildren: () =>
          import('./features/supervisor/supervisor.routes').then((m) => m.supervisorRoutes),
      },
      {
        path: 'admin',
        canActivate: [requireRole('admin')],
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.adminRoutes),
      },
      {
        path: 'denied',
        loadComponent: () =>
          import('./features/errors/permission-denied-page').then((m) => m.PermissionDeniedPage),
      },
      {
        path: '**',
        loadComponent: () => import('./features/errors/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
