import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

import { Role } from '../models/domain';
import { AuthService } from './auth.service';

/**
 * Route guard for a role restricted area.
 *
 * A signed out visitor is sent to sign in with the address they wanted, so they
 * land where they meant to rather than on a generic home page. A signed in user
 * with the wrong role is sent to an explanatory page that names the role the
 * area needs and the role they hold, because "access denied" with no further
 * information is not something anyone can act on.
 */
export function requireRole(...roles: readonly Role[]): CanActivateFn {
  return (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isSignedIn()) {
      return router.createUrlTree(['/sign-in'], { queryParams: { returnTo: state.url } });
    }

    if (auth.hasRole(...roles)) {
      return true;
    }

    return router.createUrlTree(['/denied'], {
      queryParams: { required: roles.join(','), from: state.url },
    });
  };
}

/** Sends an already signed in user away from the sign in screen. */
export const redirectIfSignedIn: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isSignedIn() ? router.parseUrl(auth.homeRoute()) : true;
};

/** Sends the root address to whichever area the current role starts in. */
export const routeToRoleHome: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return router.parseUrl(auth.homeRoute());
};
