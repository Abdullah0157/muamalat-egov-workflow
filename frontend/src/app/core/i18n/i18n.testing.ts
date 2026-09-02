import { Provider } from '@angular/core';

import arCatalogue from '../../../assets/i18n/ar.json';
import enCatalogue from '../../../assets/i18n/en.json';
import { Language, RawCatalogue, TranslationLoader } from './i18n.types';

/**
 * Test loader backed by the real catalogues.
 *
 * Specs assert against the strings that ship, so a component that references a
 * key nobody translated fails a test instead of reaching production.
 */
export class InMemoryTranslationLoader extends TranslationLoader {
  constructor(
    private readonly catalogues: Partial<Record<Language, RawCatalogue>> = {
      en: enCatalogue as RawCatalogue,
      ar: arCatalogue as RawCatalogue,
    },
  ) {
    super();
  }

  async load(language: Language): Promise<RawCatalogue> {
    const catalogue = this.catalogues[language];
    if (!catalogue) {
      throw new Error(`No test catalogue registered for "${language}"`);
    }
    return catalogue;
  }
}

/** Drop into `TestBed.configureTestingModule({ providers: [...] })`. */
export function provideI18nTesting(catalogues?: Partial<Record<Language, RawCatalogue>>): Provider[] {
  return [
    {
      provide: TranslationLoader,
      useFactory: () => new InMemoryTranslationLoader(catalogues),
    },
  ];
}

export const EN_CATALOGUE = enCatalogue as RawCatalogue;
export const AR_CATALOGUE = arCatalogue as RawCatalogue;
