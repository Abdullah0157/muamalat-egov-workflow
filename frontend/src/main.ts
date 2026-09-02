import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { RUNTIME_CONFIG, loadRuntimeConfig } from './app/core/config/runtime-config';

/**
 * The API address and identity provider are fetched before the application
 * starts, so one built image serves every environment. Resolving this up front
 * rather than inside an initializer means no service can ever observe a
 * half-configured state.
 */
loadRuntimeConfig()
  .then((config) =>
    bootstrapApplication(App, {
      ...appConfig,
      providers: [...appConfig.providers, { provide: RUNTIME_CONFIG, useValue: config }],
    }),
  )
  .catch((error) => console.error('Muamalat failed to start', error));
