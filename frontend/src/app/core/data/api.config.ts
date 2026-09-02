import { InjectionToken, inject } from '@angular/core';

import { RUNTIME_CONFIG } from '../config/runtime-config';

/**
 * Prefix applied to every API path.
 *
 * Carries the `/api` segment itself, so gateway paths are written as
 * `/requests/mine` rather than repeating the prefix at each call site. In the
 * deployed stack this is the relative value `/api`, which nginx proxies to the
 * API container: the browser never learns the API's real address and there is
 * no cross origin request to configure.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => inject(RUNTIME_CONFIG, { optional: true })?.apiBaseUrl ?? '/api',
});
