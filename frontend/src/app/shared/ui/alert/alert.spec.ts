import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { setupI18n, testProviders } from '../../testing/i18n';
import { el, maybeEl, text } from '../../testing/dom';
import { Alert } from './alert';

@Component({
  imports: [Alert],
  template: `
    <app-alert
      [tone]="tone()"
      [heading]="heading()"
      [icon]="icon()"
      [dismissible]="dismissible()"
      (dismissed)="dismissals = dismissals + 1"
    >
      The reviewing officer has asked for more information.
      <button alertActions type="button" class="probe-action">Respond</button>
    </app-alert>
  `,
})
class Host {
  readonly tone = signal<'info' | 'success' | 'warning' | 'danger'>('info');
  readonly heading = signal<string | null>('More information needed');
  readonly icon = signal<'flag' | null>(null);
  readonly dismissible = signal(false);
  dismissals = 0;
}

describe('Alert', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
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

  it('renders the heading and the projected body', () => {
    expect(text(fixture, '.alert__heading')).toBe('More information needed');
    expect(text(fixture, '.alert__body')).toContain('asked for more information');
  });

  it('projects actions into their own slot', () => {
    expect(maybeEl(fixture, '.alert__actions .probe-action')).not.toBeNull();
  });

  it('always shows a glyph so the tone is not carried by colour alone', () => {
    expect(maybeEl(fixture, 'app-icon.alert__icon')).not.toBeNull();
  });

  it('honours an explicit icon override', async () => {
    fixture.componentInstance.icon.set('flag');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(maybeEl(fixture, 'app-icon.alert__icon')).not.toBeNull();
  });

  it('is a polite status by default and an assertive alert when dangerous', async () => {
    expect(el(fixture, 'app-alert').getAttribute('role')).toBe('status');

    fixture.componentInstance.tone.set('danger');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'app-alert').getAttribute('role')).toBe('alert');
    expect(el(fixture, 'app-alert').classList).toContain('alert--danger');
  });

  it('offers no dismiss control unless it is dismissible', () => {
    expect(maybeEl(fixture, '.alert__dismiss')).toBeNull();
  });

  it('gives the dismiss control a translated accessible name', async () => {
    fixture.componentInstance.dismissible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const button = el<HTMLButtonElement>(fixture, '.alert__dismiss button');
    expect(button.getAttribute('aria-label')).toBe('Close');
  });

  it('emits dismissed rather than hiding itself', async () => {
    fixture.componentInstance.dismissible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    el<HTMLButtonElement>(fixture, '.alert__dismiss button').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.dismissals).toBe(1);
    expect(maybeEl(fixture, 'app-alert')).not.toBeNull();
  });

  it('translates the dismiss control into Arabic', async () => {
    await setupI18n('ar');
    fixture.componentInstance.dismissible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const label = el<HTMLButtonElement>(fixture, '.alert__dismiss button').getAttribute('aria-label');
    expect(label).not.toBe('Close');
    expect(label?.length).toBeGreaterThan(0);
  });
});
