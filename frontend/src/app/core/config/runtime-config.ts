import { InjectionToken } from '@angular/core';

/**
 * Shape published by the web container at `/config.json`.
 *
 * The same built bundle is deployed to every environment, so the API address and
 * the identity provider cannot be compile time constants. They are fetched
 * before the application bootstraps.
 */
export interface RuntimeConfig {
  readonly apiBaseUrl: string;
  readonly keycloak: {
    readonly url: string;
    readonly realm: string;
    readonly clientId: string;
  };
}

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG');

/**
 * Used when `/config.json` is absent, which is the case under `ng serve` and in
 * unit tests. The values match the developer stack in `infra/docker-compose.yml`
 * so a developer running the API locally needs no extra setup.
 */
export const DEV_RUNTIME_CONFIG: RuntimeConfig = {
  apiBaseUrl: '',
  keycloak: {
    url: 'http://localhost:8081',
    realm: 'muamalat',
    clientId: 'muamalat-web',
  },
};

/**
 * Fetches the runtime configuration.
 *
 * A missing or unparseable file falls back to the development defaults rather
 * than refusing to start. A blank page with a console error is a far worse
 * failure than a running app pointed at a local stack, and the deployed
 * container always writes this file.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) {
      return DEV_RUNTIME_CONFIG;
    }

    const parsed = (await response.json()) as Partial<RuntimeConfig>;

    // Merged rather than trusted wholesale: a partially written file should not
    // leave the identity provider undefined and produce an unreadable failure
    // deep inside the sign in redirect.
    return {
      apiBaseUrl: parsed.apiBaseUrl ?? DEV_RUNTIME_CONFIG.apiBaseUrl,
      keycloak: {
        url: parsed.keycloak?.url ?? DEV_RUNTIME_CONFIG.keycloak.url,
        realm: parsed.keycloak?.realm ?? DEV_RUNTIME_CONFIG.keycloak.realm,
        clientId: parsed.keycloak?.clientId ?? DEV_RUNTIME_CONFIG.keycloak.clientId,
      },
    };
  } catch {
    return DEV_RUNTIME_CONFIG;
  }
}
