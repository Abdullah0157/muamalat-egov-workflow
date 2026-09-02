import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { setupI18n, testProviders } from '../../testing/i18n';
import { el, maybeEl, text } from '../../testing/dom';
import { ErrorState } from './error-state';

@Component({
  imports: [ErrorState],
  template: `
    <app-error-state
      [title]="title()"
      [description]="description()"
      [tone]="tone()"
      [retryable]="retryable()"
      [supportReference]="supportReference()"
      (retry)="retries = retries + 1"
    >
      @if (withAction()) {
        <button errorStateAction type="button" class="probe-action">Go back</button>
      }
    </app-error-state>
  `,
})
class Host {
  readonly title = signal('Requests could not be loaded');
  readonly description = signal('The case list did not come back. Your requests are unaffected.');
  readonly tone = signal<'error' | 'permission' | 'notFound'>('error');
  readonly retryable = signal(true);
  readonly supportReference = signal<string | null>(null);
  readonly withAction = signal(false);
  retries = 0;
}

describe('ErrorState', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  // Switching language is remembered in storage and written onto the shared
  // document element, both of which outlive a `TestBed`. The Arabic case below
  // cleans up after itself so it cannot decide what language the next file runs
  // in, which would otherwise show up as an unrelated suite failing.
  afterEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('dir', 'ltr');
  });

  it('renders the failure as a heading with prose underneath', () => {
    expect(el(fixture, '.error-state__title').tagName).toBe('H2');
    expect(text(fixture, '.error-state__title')).toBe('Requests could not be loaded');
    expect(text(fixture, '.error-state__description')).toContain('unaffected');
  });

  it('announces itself', () => {
    expect(el(fixture, 'app-error-state').getAttribute('role')).toBe('alert');
  });

  it('offers a translated retry action and reports it', () => {
    const retry = el<HTMLButtonElement>(fixture, '.error-state__actions button');
    expect(retry.textContent?.trim()).toBe('Try again');

    retry.click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('drops the retry action when retrying cannot help', async () => {
    fixture.componentInstance.retryable.set(false);
    await settle();

    expect(maybeEl(fixture, '.error-state__actions button')).toBeNull();
  });

  it('projects an extra action beside the retry', async () => {
    fixture.componentInstance.withAction.set(true);
    await settle();

    expect(maybeEl(fixture, '.error-state__actions .probe-action')).not.toBeNull();
  });

  it('shows a different glyph per tone rather than colour alone', async () => {
    const glyphs: string[] = [];
    for (const tone of ['error', 'permission', 'notFound'] as const) {
      fixture.componentInstance.tone.set(tone);
      await settle();
      glyphs.push(el(fixture, '.error-state__icon svg').innerHTML);
    }

    expect(new Set(glyphs).size).toBe(3);
  });

  it('marks the permission and not found tones on the host', async () => {
    fixture.componentInstance.tone.set('permission');
    await settle();
    expect(el(fixture, 'app-error-state').classList).toContain('error-state--permission');

    fixture.componentInstance.tone.set('notFound');
    await settle();
    expect(el(fixture, 'app-error-state').classList).toContain('error-state--not-found');
  });

  it('hides the support reference until there is one', () => {
    expect(maybeEl(fixture, '.error-state__reference')).toBeNull();
  });

  it('labels the support reference and keeps it left to right', async () => {
    fixture.componentInstance.supportReference.set('MUA-8F31-2026');
    await settle();

    expect(text(fixture, '.error-state__reference-label')).toBe('Support reference');
    const reference = el(fixture, '.error-state__reference .u-reference');
    expect(reference.textContent?.trim()).toBe('MUA-8F31-2026');
  });

  it('keeps the reference isolated when the page is Arabic', async () => {
    await setupI18n('ar');
    fixture.componentInstance.supportReference.set('MUA-8F31-2026');
    await settle();

    // The class is what pins the direction, so the reference reads the same way
    // in both languages.
    expect(el(fixture, '.error-state__reference .u-reference').classList).toContain('u-reference');
    expect(text(fixture, '.error-state__reference-label')).not.toBe('Support reference');
  });
});
