import { InjectionToken } from '@angular/core';

export type Language = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['en', 'ar'];

/**
 * English is the guaranteed fallback: it is bundled with the application rather
 * than fetched, so a missing or failed catalogue download can never leave the
 * interface showing raw message keys.
 */
export const FALLBACK_LANGUAGE: Language = 'en';

/** CLDR plural categories. Arabic uses all six; English uses two. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

/** A message is either a plain string or a set of plural forms. */
export type Message = string | Partial<Record<PluralCategory, string>>;

/** Catalogue after flattening, keyed by dotted path. */
export type MessageCatalogue = ReadonlyMap<string, Message>;

/** Catalogue as authored: arbitrarily nested JSON. */
export interface RawCatalogue {
  readonly [key: string]: unknown;
}

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Loads a message catalogue for a language. Swapping this provider is the only
 * change needed to move from bundled catalogues to a translation service.
 */
export abstract class TranslationLoader {
  abstract load(language: Language): Promise<RawCatalogue>;
}

export interface LanguageConfig {
  /** BCP 47 locale used for all Intl formatting. */
  readonly locale: string;
  /** Locale used for Hijri (Umm al-Qura) rendering. */
  readonly hijriLocale: string;
  readonly direction: Direction;
  /** Native name, always shown in its own script in the language switcher. */
  readonly nativeName: string;
}

export const LANGUAGE_CONFIG: Readonly<Record<Language, LanguageConfig>> = {
  en: {
    locale: 'en-GB',
    hijriLocale: 'en-GB-u-ca-islamic',
    direction: 'ltr',
    nativeName: 'English',
  },
  ar: {
    locale: 'ar-KW',
    hijriLocale: 'ar-SA-u-ca-islamic',
    direction: 'rtl',
    nativeName: 'العربية',
  },
};

/**
 * Numbering system used for every formatted number and date.
 *
 * Kuwaiti government forms, receipts and reference numbers are printed with
 * Western Arabic digits, and a citizen has to be able to read a number off the
 * screen and match it against a paper document. Rendering Arabic-Indic digits
 * (٠١٢٣) is a one line change here if a ministry prefers them.
 */
export const NUMBERING_SYSTEM = new InjectionToken<string>('MUAMALAT_NUMBERING_SYSTEM', {
  providedIn: 'root',
  factory: () => 'latn',
});

/** Key under which the chosen language is remembered between visits. */
export const LANGUAGE_STORAGE_KEY = 'muamalat.language';
