import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

import { flattenCatalogue, interpolate } from './catalogue';
import {
  Direction,
  FALLBACK_LANGUAGE,
  LANGUAGE_CONFIG,
  LANGUAGE_STORAGE_KEY,
  Language,
  MessageCatalogue,
  MessageParams,
  NUMBERING_SYSTEM,
  PluralCategory,
  SUPPORTED_LANGUAGES,
  TranslationLoader,
} from './i18n.types';

/**
 * Runtime internationalisation.
 *
 * Everything the interface says goes through `t()`. The service owns three
 * pieces of state: the active language, the loaded catalogues, and a revision
 * counter that lets the translate pipe know when its memoised value is stale.
 *
 * Language switching is a signal write plus a lazy catalogue fetch. There is no
 * page reload and no separate build per locale.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly loader = inject(TranslationLoader);
  private readonly document = inject(DOCUMENT);
  private readonly numberingSystem = inject(NUMBERING_SYSTEM);

  private readonly catalogues = signal<ReadonlyMap<Language, MessageCatalogue>>(new Map());
  private readonly activeLanguage = signal<Language>(FALLBACK_LANGUAGE);
  private readonly loadFailures = signal<ReadonlySet<Language>>(new Set());

  /**
   * Deliberately a plain set rather than a signal.
   *
   * `t()` runs inside template expressions, and Angular refuses a signal write
   * during rendering (NG0600). Making this reactive would turn a missing message
   * key, which should degrade to showing the key, into a crash on the screen the
   * key appears on. Nothing renders from it: it exists so a spec and a developer
   * can ask what was requested and never found.
   */
  private readonly missing = new Set<string>();

  /** Bumped whenever a lookup could produce a different answer. */
  private readonly revisionCounter = signal(0);

  private readonly inFlight = new Map<Language, Promise<void>>();

  /** The active language. */
  readonly language = this.activeLanguage.asReadonly();

  /** Writing direction for the active language. */
  readonly direction = computed<Direction>(() => LANGUAGE_CONFIG[this.activeLanguage()].direction);

  readonly isRtl = computed(() => this.direction() === 'rtl');

  /** BCP 47 locale used for all Intl formatting. */
  readonly locale = computed(() => LANGUAGE_CONFIG[this.activeLanguage()].locale);

  /** True once the active language has a catalogue to read from. */
  readonly isReady = computed(() => this.catalogues().has(this.activeLanguage()));

  /**
   * Set when a catalogue could not be downloaded. The interface stays usable in
   * the fallback language and the shell surfaces this rather than hiding it.
   */
  readonly hasLoadFailure = computed(() => this.loadFailures().has(this.activeLanguage()));

  /** Read by the translate pipe to invalidate its memo. */
  readonly revision = this.revisionCounter.asReadonly();

  /** Keys that were requested but not found. Surfaced by a spec, useful in dev. */
  missingKeys(): readonly string[] {
    return [...this.missing].sort();
  }

  readonly availableLanguages = SUPPORTED_LANGUAGES;

  /**
   * Loads the fallback catalogue and the remembered language. Called once from
   * an application initialiser so the first paint is already translated.
   */
  async init(): Promise<void> {
    await this.ensureCatalogue(FALLBACK_LANGUAGE);
    const remembered = this.readStoredLanguage();
    if (remembered && remembered !== FALLBACK_LANGUAGE) {
      await this.setLanguage(remembered);
    } else {
      this.activeLanguage.set(remembered ?? FALLBACK_LANGUAGE);
      this.applyDocumentLanguage();
      this.revisionCounter.update((value) => value + 1);
    }
  }

  /**
   * Switches language. The catalogue is fetched first so the interface never
   * flashes untranslated keys, then the switch is applied in one go.
   */
  async setLanguage(language: Language): Promise<void> {
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return;
    }
    await this.ensureCatalogue(language);
    this.activeLanguage.set(language);
    this.applyDocumentLanguage();
    this.writeStoredLanguage(language);
    this.revisionCounter.update((value) => value + 1);
  }

  /**
   * The single place where the language reaches the document. Every RTL rule in
   * the product keys off these two attributes.
   *
   * Written directly rather than through an `effect`, because the attributes
   * have to change in the same task as the language does. Deferring them to the
   * next change detection pass would leave the page mirrored a frame late, and
   * would make the behaviour depend on something having scheduled a tick.
   */
  private applyDocumentLanguage(): void {
    const language = this.activeLanguage();
    const root = this.document.documentElement;
    root.setAttribute('lang', language);
    root.setAttribute('dir', LANGUAGE_CONFIG[language].direction);
  }

  /**
   * Looks up a message. Resolution order is active language, then fallback
   * language, then the key itself, so a gap in a translation degrades to
   * English rather than to an empty screen.
   */
  t(key: string, params?: MessageParams): string {
    const message = this.lookup(key);
    if (message === undefined) {
      this.recordMissing(key);
      return key;
    }
    if (typeof message === 'string') {
      return interpolate(message, params);
    }
    // A plural message read without a count: fall back to `other`.
    const other = message.other ?? Object.values(message)[0] ?? key;
    return interpolate(other, params);
  }

  /**
   * Plural-aware lookup. Uses `Intl.PluralRules` so Arabic gets its six
   * categories rather than an English-shaped one/other split.
   */
  plural(key: string, count: number, params?: MessageParams): string {
    const message = this.lookup(key);
    if (message === undefined) {
      this.recordMissing(key);
      return key;
    }
    const merged: MessageParams = { count: this.formatNumber(count), ...params };
    if (typeof message === 'string') {
      return interpolate(message, merged);
    }
    // An explicit `zero` form wins at exactly zero, even in languages whose
    // plural rules have no zero category. "No requests" reads far better than
    // "0 requests", and CLDR allows this as an explicit count override.
    if (count === 0 && message.zero !== undefined) {
      return interpolate(message.zero, merged);
    }
    const category = new Intl.PluralRules(this.locale()).select(count) as PluralCategory;
    const form = message[category] ?? message.other ?? Object.values(message)[0];
    return form === undefined ? key : interpolate(form, merged);
  }

  /** True when the key resolves in either the active or the fallback catalogue. */
  has(key: string): boolean {
    return this.lookup(key) !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(this.locale(), {
      numberingSystem: this.numberingSystem,
      ...options,
    }).format(value);
  }

  formatCurrency(value: number, currency = 'KWD'): string {
    // Kuwaiti dinar is quoted to three decimals.
    return this.formatNumber(value, {
      style: 'currency',
      currency,
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  }

  formatPercent(fraction: number, maximumFractionDigits = 0): string {
    return this.formatNumber(fraction, { style: 'percent', maximumFractionDigits });
  }

  /** Gregorian date, medium length by default. */
  formatDate(value: Date | string, options?: Intl.DateTimeFormatOptions): string {
    const date = toDate(value);
    if (!date) {
      return '';
    }
    return new Intl.DateTimeFormat(this.locale(), {
      numberingSystem: this.numberingSystem,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...options,
    }).format(date);
  }

  formatDateTime(value: Date | string): string {
    return this.formatDate(value, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatTime(value: Date | string): string {
    const date = toDate(value);
    if (!date) {
      return '';
    }
    return new Intl.DateTimeFormat(this.locale(), {
      numberingSystem: this.numberingSystem,
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  /**
   * Hijri (Umm al-Qura) rendering. Official Kuwaiti correspondence carries both
   * calendars, so the interface shows both wherever a legal date matters.
   */
  formatHijri(value: Date | string, options?: Intl.DateTimeFormatOptions): string {
    const date = toDate(value);
    if (!date) {
      return '';
    }
    const hijriLocale = LANGUAGE_CONFIG[this.activeLanguage()].hijriLocale;
    try {
      return new Intl.DateTimeFormat(hijriLocale, {
        numberingSystem: this.numberingSystem,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        ...options,
      }).format(date);
    } catch {
      // An engine without the Islamic calendar must not take the page down.
      return '';
    }
  }

  /** "in 3 days" / "منذ ٣ أيام" style output. */
  formatRelative(value: Date | string, now: Date = new Date()): string {
    const date = toDate(value);
    if (!date) {
      return '';
    }
    const diffMs = date.getTime() - now.getTime();
    // `Intl.RelativeTimeFormat` takes the numbering system through the locale
    // rather than through options.
    const formatter = new Intl.RelativeTimeFormat(
      `${this.locale()}-u-nu-${this.numberingSystem}`,
      { numeric: 'auto' },
    );
    const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 365 * 24 * 3600_000],
      ['month', 30 * 24 * 3600_000],
      ['day', 24 * 3600_000],
      ['hour', 3600_000],
      ['minute', 60_000],
    ];
    for (const [unit, ms] of units) {
      if (Math.abs(diffMs) >= ms) {
        return formatter.format(Math.round(diffMs / ms), unit);
      }
    }
    return formatter.format(Math.round(diffMs / 1000), 'second');
  }

  /**
   * Compact duration for SLA counters, for example "2 d 6 h". Uses the
   * catalogue so the unit abbreviations are translated.
   */
  formatDuration(milliseconds: number): string {
    const totalMinutes = Math.max(0, Math.round(Math.abs(milliseconds) / 60_000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${this.t('units.day', { value: this.formatNumber(days) })} ${this.t('units.hour', {
        value: this.formatNumber(hours),
      })}`;
    }
    if (hours > 0) {
      return `${this.t('units.hour', { value: this.formatNumber(hours) })} ${this.t(
        'units.minute',
        { value: this.formatNumber(minutes) },
      )}`;
    }
    return this.t('units.minute', { value: this.formatNumber(minutes) });
  }

  formatFileSize(kilobytes: number): string {
    if (kilobytes < 1024) {
      return this.t('units.kilobyte', { value: this.formatNumber(Math.round(kilobytes)) });
    }
    return this.t('units.megabyte', {
      value: this.formatNumber(kilobytes / 1024, { maximumFractionDigits: 1 }),
    });
  }

  /** Picks the right side of a bilingual value carried on a data record. */
  pick(value: { en: string; ar: string } | null | undefined): string {
    if (!value) {
      return '';
    }
    return this.activeLanguage() === 'ar' ? value.ar : value.en;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private lookup(key: string): ReturnType<MessageCatalogue['get']> {
    // Reading the revision here is what makes every consumer of `t()` reactive:
    // the pipe, computed signals and template expressions all re-run when the
    // language or the loaded catalogues change.
    this.revisionCounter();
    const catalogues = this.catalogues();
    return (
      catalogues.get(this.activeLanguage())?.get(key) ??
      catalogues.get(FALLBACK_LANGUAGE)?.get(key)
    );
  }

  private async ensureCatalogue(language: Language): Promise<void> {
    if (this.catalogues().has(language)) {
      return;
    }
    const existing = this.inFlight.get(language);
    if (existing) {
      return existing;
    }
    const load = this.loadCatalogue(language).finally(() => this.inFlight.delete(language));
    this.inFlight.set(language, load);
    return load;
  }

  private async loadCatalogue(language: Language): Promise<void> {
    try {
      const raw = await this.loader.load(language);
      const flat = flattenCatalogue(raw);
      this.catalogues.update((current) => new Map(current).set(language, flat));
      this.loadFailures.update((current) => {
        if (!current.has(language)) {
          return current;
        }
        const next = new Set(current);
        next.delete(language);
        return next;
      });
      this.revisionCounter.update((value) => value + 1);
    } catch {
      this.loadFailures.update((current) => new Set(current).add(language));
      this.revisionCounter.update((value) => value + 1);
    }
  }

  private recordMissing(key: string): void {
    this.missing.add(key);
  }

  private readStoredLanguage(): Language | null {
    try {
      const stored = this.document.defaultView?.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      return SUPPORTED_LANGUAGES.includes(stored as Language) ? (stored as Language) : null;
    } catch {
      return null;
    }
  }

  private writeStoredLanguage(language: Language): void {
    try {
      this.document.defaultView?.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Private browsing or a blocked storage partition is not an error worth
      // interrupting anyone over; the language simply is not remembered.
    }
  }
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
