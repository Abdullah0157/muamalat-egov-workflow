import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'muamalat.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Appearance preference.
 *
 * "system" leaves the `data-theme` attribute off the root element entirely, so
 * the `prefers-color-scheme` block in the token sheet applies. Choosing light or
 * dark stamps `data-theme`, which the token sheet is written to let win in both
 * directions: an explicit light choice survives a dark operating system and an
 * explicit dark choice survives a light one.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly preferenceSignal = signal<ThemePreference>(this.readStored());
  private readonly systemPrefersDark = signal(this.readSystemPreference());

  readonly preference = this.preferenceSignal.asReadonly();

  /** What the user is actually looking at right now. */
  readonly resolved = computed<ResolvedTheme>(() => {
    const preference = this.preferenceSignal();
    if (preference === 'system') {
      return this.systemPrefersDark() ? 'dark' : 'light';
    }
    return preference;
  });

  constructor() {
    const view = this.document.defaultView;
    if (view?.matchMedia) {
      const query = view.matchMedia(DARK_QUERY);
      query.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));
    }
    this.applyToDocument();
  }

  set(preference: ThemePreference): void {
    this.preferenceSignal.set(preference);
    this.applyToDocument();
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage may be unavailable; the choice simply is not remembered.
    }
  }

  /**
   * Written directly rather than through an `effect` so the page repaints in the
   * same task the choice is made in. A theme that arrives a frame later reads as
   * a flicker, and deferring it would make the behaviour depend on something
   * else having scheduled a change detection pass.
   *
   * A system preference removes the attribute entirely, which is what lets the
   * `prefers-color-scheme` block in the token sheet take over again.
   */
  private applyToDocument(): void {
    const preference = this.preferenceSignal();
    const root = this.document.documentElement;
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }

  private readStored(): ThemePreference {
    try {
      const stored = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // Ignore and fall through to the system default.
    }
    return 'system';
  }

  private readSystemPreference(): boolean {
    return this.document.defaultView?.matchMedia?.(DARK_QUERY).matches ?? false;
  }
}
