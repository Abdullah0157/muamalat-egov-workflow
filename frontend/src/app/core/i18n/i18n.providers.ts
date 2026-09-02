import { EnvironmentProviders, Injectable, makeEnvironmentProviders, provideAppInitializer, inject } from '@angular/core';

import enCatalogue from '../../../assets/i18n/en.json';
import { I18nService } from './i18n.service';
import { FALLBACK_LANGUAGE, Language, RawCatalogue, TranslationLoader } from './i18n.types';

/**
 * Default catalogue loader.
 *
 * English is bundled so the application always has something to render, even
 * offline or behind a broken CDN. Every other language is fetched on demand,
 * which keeps the initial bundle to one locale and means adding a language does
 * not grow the download for people who never switch.
 */
@Injectable()
export class HttpTranslationLoader extends TranslationLoader {
  async load(language: Language): Promise<RawCatalogue> {
    if (language === FALLBACK_LANGUAGE) {
      return enCatalogue as RawCatalogue;
    }
    const response = await fetch(`assets/i18n/${language}.json`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Message catalogue for "${language}" returned ${response.status}`);
    }
    return (await response.json()) as RawCatalogue;
  }
}

/**
 * Registers internationalisation and blocks the first render until the
 * catalogue for the remembered language is in memory, so nobody ever sees a
 * flash of raw message keys.
 */
export function provideI18n(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: TranslationLoader, useClass: HttpTranslationLoader },
    provideAppInitializer(() => inject(I18nService).init()),
  ]);
}
