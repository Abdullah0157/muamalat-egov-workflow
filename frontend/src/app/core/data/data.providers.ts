import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { DataGateway } from './data-gateway';
import { HttpDataGateway } from './http-data.gateway';
import { MockDataGateway } from './mock-data.gateway';
import { authInterceptor } from '../auth/auth.interceptor';
import { RUNTIME_CONFIG } from '../config/runtime-config';

/**
 * How the application gets its data.
 *
 * Two implementations sit behind the same abstract {@link DataGateway}: the
 * live API and an in-memory dataset. Nothing else in the application knows
 * which is in use, because every screen, guard and resource depends on the
 * abstract class.
 *
 * The mock is not dead weight. It is what makes the app runnable without a
 * backend, and it is what the component tests use, so a UI regression does not
 * need a database and Keycloak to reproduce.
 */
export interface DataOptions {
  /**
   * Use the in-memory dataset instead of the API. Intended for the standalone
   * demo build and for tests; a deployment always talks to the API.
   */
  readonly useMockData?: boolean;
}

export function provideData(options: DataOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    // withFetch uses the browser's fetch rather than XHR, which is what makes
    // request cancellation actually propagate when a user navigates away from a
    // slow screen.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    {
      // Decided at runtime from the published configuration rather than at
      // build time, so one image serves both the live system and the fixture
      // driven demo. An explicit option still wins, which is what tests use.
      provide: DataGateway,
      useFactory: () => {
        const config = inject(RUNTIME_CONFIG, { optional: true });
        const useMock = options.useMockData ?? config?.useMockData ?? false;
        return useMock ? inject(MockDataGateway) : inject(HttpDataGateway);
      },
    },
    MockDataGateway,
    HttpDataGateway,
  ]);
}
