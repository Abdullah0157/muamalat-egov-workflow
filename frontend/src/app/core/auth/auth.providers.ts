import { EnvironmentProviders, makeEnvironmentProviders, inject } from '@angular/core';

import { ACCESS_TOKEN_PROVIDER } from './auth.interceptor';
import { OIDC_CONFIG, OidcConfig, OidcService } from './oidc.service';
import { RUNTIME_CONFIG } from '../config/runtime-config';

/**
 * Builds the OpenID Connect configuration from the runtime config published by
 * the web container, and points the HTTP interceptor at the live session.
 *
 * The redirect URIs are derived from the browser's own origin rather than
 * configured separately. They must match what is registered in Keycloak exactly,
 * and deriving them removes the most common cause of a `redirect_uri_mismatch`:
 * a config file that disagrees with where the app is actually served from.
 */
export function provideAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: OIDC_CONFIG,
      useFactory: (): OidcConfig => {
        const config = inject(RUNTIME_CONFIG);
        const origin = typeof window === 'undefined' ? '' : window.location.origin;

        return {
          issuer: `${config.keycloak.url}/realms/${config.keycloak.realm}`,
          clientId: config.keycloak.clientId,
          redirectUri: `${origin}/auth/callback`,
          postLogoutRedirectUri: `${origin}/sign-in`,

          // openid is required by the protocol. profile and email carry the
          // display name shown in the header. No other scope is requested:
          // asking for permissions the application does not use is exactly the
          // over-collection that consent screens exist to expose.
          scope: 'openid profile email',
        };
      },
    },
    {
      provide: ACCESS_TOKEN_PROVIDER,
      useFactory: () => {
        const oidc = inject(OidcService);
        return () => oidc.getAccessToken();
      },
    },
  ]);
}
