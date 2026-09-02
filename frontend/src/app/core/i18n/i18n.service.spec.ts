import { TestBed } from '@angular/core/testing';

import { flattenCatalogue } from './catalogue';
import { I18nService } from './i18n.service';
import { AR_CATALOGUE, EN_CATALOGUE, provideI18nTesting } from './i18n.testing';
import { LANGUAGE_STORAGE_KEY, RawCatalogue, TranslationLoader } from './i18n.types';

describe('I18nService', () => {
  function configure(providers: unknown[] = []): I18nService {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), ...(providers as never[])],
    });
    return TestBed.inject(I18nService);
  }

  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  // ---------------------------------------------------------------------------
  // Language switching
  // ---------------------------------------------------------------------------

  it('starts in the fallback language with a left to right document', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.language()).toBe('en');
    expect(i18n.direction()).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('flips the document to right to left when Arabic is selected', async () => {
    const i18n = configure();
    await i18n.init();

    await i18n.setLanguage('ar');

    expect(i18n.language()).toBe('ar');
    expect(i18n.direction()).toBe('rtl');
    expect(i18n.isRtl()).toBeTrue();
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('flips back to left to right when English is reselected', async () => {
    const i18n = configure();
    await i18n.init();
    await i18n.setLanguage('ar');

    await i18n.setLanguage('en');

    expect(i18n.direction()).toBe('ltr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('translates into the active language', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.t('common.submit')).toBe('Submit');

    await i18n.setLanguage('ar');
    expect(i18n.t('common.submit')).toBe('إرسال');
  });

  it('remembers the chosen language for the next visit', async () => {
    const first = configure();
    await first.init();
    await first.setLanguage('ar');

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');

    TestBed.resetTestingModule();
    const second = configure();
    await second.init();

    expect(second.language()).toBe('ar');
  });

  it('ignores an unsupported language rather than blanking the interface', async () => {
    const i18n = configure();
    await i18n.init();

    await i18n.setLanguage('fr' as never);

    expect(i18n.language()).toBe('en');
  });

  // ---------------------------------------------------------------------------
  // Missing keys and fallback
  // ---------------------------------------------------------------------------

  it('returns the key itself when nothing is registered for it', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.t('nothing.here.at.all')).toBe('nothing.here.at.all');
    expect(i18n.has('nothing.here.at.all')).toBeFalse();
    expect(i18n.missingKeys()).toContain('nothing.here.at.all');
  });

  it('falls back to English when the active language is missing a key', async () => {
    const partialArabic: RawCatalogue = { common: { submit: 'إرسال' } };
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting({ en: EN_CATALOGUE, ar: partialArabic })],
    });
    const i18n = TestBed.inject(I18nService);
    await i18n.init();
    await i18n.setLanguage('ar');

    expect(i18n.t('common.submit')).toBe('إرسال');
    // Not present in the partial Arabic catalogue, so English is used rather
    // than showing the raw key to a citizen.
    expect(i18n.t('common.cancel')).toBe('Cancel');
  });

  it('keeps the interface usable when a catalogue cannot be downloaded', async () => {
    class FailingLoader extends TranslationLoader {
      async load(language: string): Promise<RawCatalogue> {
        if (language === 'en') {
          return EN_CATALOGUE;
        }
        throw new Error('network down');
      }
    }
    TestBed.configureTestingModule({
      providers: [{ provide: TranslationLoader, useClass: FailingLoader }],
    });
    const i18n = TestBed.inject(I18nService);
    await i18n.init();

    await i18n.setLanguage('ar');

    expect(i18n.hasLoadFailure()).toBeTrue();
    // Direction still switches, and the English text remains readable.
    expect(i18n.direction()).toBe('rtl');
    expect(i18n.t('common.submit')).toBe('Submit');
  });

  // ---------------------------------------------------------------------------
  // Interpolation and plurals
  // ---------------------------------------------------------------------------

  it('interpolates named parameters', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.t('common.step', { current: 2, total: 4 })).toBe('Step 2 of 4');
  });

  it('leaves an unmatched placeholder visible so the mistake is caught', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.t('common.step', { current: 2 })).toBe('Step 2 of {total}');
  });

  it('uses English plural categories for English', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.plural('units.requests', 0)).toBe('No requests');
    expect(i18n.plural('units.requests', 1)).toBe('1 request');
    expect(i18n.plural('units.requests', 7)).toBe('7 requests');
  });

  it('uses the full set of Arabic plural categories', async () => {
    const i18n = configure();
    await i18n.init();
    await i18n.setLanguage('ar');

    expect(i18n.plural('units.requests', 0)).toBe('لا توجد طلبات');
    expect(i18n.plural('units.requests', 1)).toBe('طلب واحد');
    expect(i18n.plural('units.requests', 2)).toBe('طلبان');
    expect(i18n.plural('units.requests', 5)).toBe('5 طلبات');
    expect(i18n.plural('units.requests', 15)).toBe('15 طلباً');
  });

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  it('formats numbers and currency for the active locale', async () => {
    const i18n = configure();
    await i18n.init();

    expect(i18n.formatNumber(1234.5)).toBe('1,234.5');
    // Kuwaiti dinar is quoted to three decimal places.
    expect(i18n.formatCurrency(150)).toContain('150.000');
  });

  it('renders a Hijri date alongside the Gregorian one', async () => {
    const i18n = configure();
    await i18n.init();

    const gregorian = i18n.formatDate('2026-09-01T00:00:00.000Z');
    const hijri = i18n.formatHijri('2026-09-01T00:00:00.000Z');

    expect(gregorian).toContain('2026');
    expect(hijri.length).toBeGreaterThan(0);
    expect(hijri).not.toBe(gregorian);
    // 1 September 2026 falls in the year 1448 of the Hijri calendar.
    expect(hijri).toContain('1448');
  });

  it('renders the Hijri date in Arabic script when Arabic is active', async () => {
    const i18n = configure();
    await i18n.init();
    await i18n.setLanguage('ar');

    expect(i18n.formatHijri('2026-09-01T00:00:00.000Z')).toMatch(/[؀-ۿ]/);
  });

  it('picks the right side of a bilingual data value', async () => {
    const i18n = configure();
    await i18n.init();
    const value = { en: 'Civil Affairs', ar: 'الأحوال المدنية' };

    expect(i18n.pick(value)).toBe('Civil Affairs');
    await i18n.setLanguage('ar');
    expect(i18n.pick(value)).toBe('الأحوال المدنية');
    expect(i18n.pick(null)).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Catalogue integrity
  // ---------------------------------------------------------------------------

  it('has identical keys in every catalogue', () => {
    const english = [...flattenCatalogue(EN_CATALOGUE).keys()].sort();
    const arabic = [...flattenCatalogue(AR_CATALOGUE).keys()].sort();

    const missingFromArabic = english.filter((key) => !arabic.includes(key));
    const extraInArabic = arabic.filter((key) => !english.includes(key));

    expect(missingFromArabic).withContext('keys missing from ar.json').toEqual([]);
    expect(extraInArabic).withContext('keys present only in ar.json').toEqual([]);
    expect(english.length).toBeGreaterThan(300);
  });

  it('has no empty message in either catalogue', () => {
    for (const [name, catalogue] of [
      ['en', EN_CATALOGUE],
      ['ar', AR_CATALOGUE],
    ] as const) {
      for (const [key, message] of flattenCatalogue(catalogue)) {
        const values = typeof message === 'string' ? [message] : Object.values(message);
        for (const value of values) {
          expect(value.trim().length)
            .withContext(`${name}.json has an empty value at ${key}`)
            .toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses no dash characters that the house style forbids', () => {
    for (const [name, catalogue] of [
      ['en', EN_CATALOGUE],
      ['ar', AR_CATALOGUE],
    ] as const) {
      for (const [key, message] of flattenCatalogue(catalogue)) {
        const values = typeof message === 'string' ? [message] : Object.values(message);
        for (const value of values) {
          // Written as escapes so this guard does not itself contain the
          // characters it forbids.
          expect(/[\u2013\u2014]/.test(value))
            .withContext(`${name}.json uses an en or em dash at ${key}`)
            .toBeFalse();
        }
      }
    }
  });
});
