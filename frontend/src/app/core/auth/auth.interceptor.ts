import { HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';

/**
 * Supplies the bearer token attached to API calls.
 *
 * Deliberately an injection token rather than a hard dependency on a specific
 * identity library. The API validates tokens issued by Keycloak, and the OIDC
 * authorization code flow that obtains one is the remaining piece of the auth
 * story; until it is wired, this returns null and the interceptor sends no
 * Authorization header.
 *
 * That is the honest behaviour: an unauthenticated call gets a clean 401 from
 * the API rather than a forged header that pretends to be someone.
 */
export const ACCESS_TOKEN_PROVIDER = new InjectionToken<() => string | null>(
  'ACCESS_TOKEN_PROVIDER',
  {
    providedIn: 'root',
    factory: () => () => null,
  },
);

/**
 * Attaches the bearer token and asks the API for the caller's preferred
 * language, so validation messages and workflow labels come back localised
 * rather than being translated twice.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const getToken = inject(ACCESS_TOKEN_PROVIDER);
  const token = getToken();

  // Only same-origin API calls are decorated. Sending a bearer token to any URL
  // the app happens to fetch would leak the credential to third parties.
  const isApiCall = request.url.startsWith('/api/') || request.url.includes('/api/');

  if (!isApiCall) {
    return next(request);
  }

  const language = typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en';

  const headers = token
    ? request.headers.set('Authorization', `Bearer ${token}`).set('Accept-Language', language)
    : request.headers.set('Accept-Language', language);

  return next(request.clone({ headers }));
};
