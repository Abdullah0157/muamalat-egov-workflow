import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { I18nService } from '../../core/i18n/i18n.service';
import { provideI18nTesting } from '../../core/i18n/i18n.testing';
import { LANGUAGE_STORAGE_KEY, Language } from '../../core/i18n/i18n.types';

/**
 * Providers every spec needs when the component under test renders text.
 *
 * The loader is backed by the real `en.json` and `ar.json`, so a spec fails if a
 * component asks for a message nobody has written.
 */
export function testProviders(): Provider[] {
  return [...provideI18nTesting()];
}

/**
 * Boots i18n inside a `TestBed` and optionally switches language.
 *
 * The `lang` and `dir` attributes and the remembered language are shared by the
 * whole run, so this normalises them on the way in rather than trying to clean
 * up on the way out. Cleaning up afterwards only works if every spec remembers
 * to do it, and a single Arabic assertion that skips it leaves later suites
 * failing in a way that only reproduces in one file order.
 */
export async function setupI18n(language: Language = 'en'): Promise<I18nService> {
  resetLanguageState();
  const i18n = TestBed.inject(I18nService);
  await i18n.init();
  if (language !== 'en') {
    await i18n.setLanguage(language);
  }
  return i18n;
}

/** Returns the document and the remembered language to their default state. */
export function resetLanguageState(): void {
  try {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a restricted context; nothing to undo.
  }
  const root = document.documentElement;
  root.setAttribute('lang', 'en');
  root.setAttribute('dir', 'ltr');
  root.removeAttribute('data-theme');
}
