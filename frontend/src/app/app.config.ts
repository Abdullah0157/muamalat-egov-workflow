import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';

import { routes } from './app.routes';
import { provideData } from './core/data/data.providers';
import { provideI18n } from './core/i18n/i18n.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // Route parameters arrive as component inputs, which keeps detail pages
      // free of manual ActivatedRoute plumbing.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideI18n(),
    // The demo build runs on the in-memory dataset so the UI can be explored
    // without a backend. A real deployment sets this to false and talks to the
    // API. Kept as an explicit flag rather than an environment file so the
    // choice is visible at the composition root.
    provideData({ useMockData: true }),
  ],
};
