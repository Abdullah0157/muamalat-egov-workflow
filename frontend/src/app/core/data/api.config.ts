import { InjectionToken } from '@angular/core';

/**
 * Base URL of the Muamalat API.
 *
 * Empty by default, which makes every call same origin (`/api/...`). In the
 * deployed stack nginx proxies `/api` to the API container, so the browser
 * never learns the API's real address and there is no cross origin request to
 * configure. A value is only supplied when the two are genuinely on different
 * origins, such as a developer running `ng serve` against a container.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '',
});
