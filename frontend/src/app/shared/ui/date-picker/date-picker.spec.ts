import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { I18nService } from '../../../core/i18n/i18n.service';
import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { all, el, maybeEl, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { DatePicker } from './date-picker';

@Component({
  imports: [DatePicker],
  template: `
    <app-date-picker
      [label]="label()"
      [hint]="hint()"
      [error]="error()"
      [min]="min()"
      [max]="max()"
      [required]="required()"
      [showHijri]="showHijri()"
      (valueChange)="chosen = $event"
    />
  `,
})
class Host {
  readonly label = signal('Date of birth');
  readonly hint = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly min = signal<string | null>(null);
  readonly max = signal<string | null>(null);
  readonly required = signal(false);
  readonly showHijri = signal(true);
  chosen = '';
}

function setDate(fixture: ComponentFixture<Host>, iso: string): void {
  const input = el<HTMLInputElement>(fixture, 'input');
  input.value = iso;
  input.dispatchEvent(new Event('input'));
}

function calendarNames(fixture: ComponentFixture<Host>): string[] {
  return all(fixture, '.date-picker__calendar-name').map((node) => node.textContent?.trim() ?? '');
}

describe('DatePicker', () => {
  // The i18n service remembers the chosen language in local storage, and that
  // store is shared by every spec in the run. Clearing it on both sides keeps a
  // language switch here from deciding what language another file starts in.
  beforeEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));

  let fixture: ComponentFixture<Host>;
  let i18n: I18nService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    i18n = await setupI18n();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders a native date input pinned to left to right', () => {
    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.type).toBe('date');
    expect(input.getAttribute('dir')).toBe('ltr');
  });

  it('labels the control and passes the bounds through', async () => {
    fixture.componentInstance.min.set('2020-01-01');
    fixture.componentInstance.max.set('2030-12-31');
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(el<HTMLLabelElement>(fixture, 'label').getAttribute('for')).toBe(input.id);
    expect(input.getAttribute('min')).toBe('2020-01-01');
    expect(input.getAttribute('max')).toBe('2030-12-31');
  });

  it('emits the ISO value the input produced', async () => {
    setDate(fixture, '2026-03-01');
    await fixture.whenStable();

    expect(fixture.componentInstance.chosen).toBe('2026-03-01');
  });

  it('shows nothing under the field until a date is chosen', () => {
    expect(maybeEl(fixture, '.date-picker__calendars')).toBeNull();
  });

  it('echoes the chosen date in both calendars', async () => {
    setDate(fixture, '2026-03-01');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calendarNames(fixture)).toContain('Gregorian');
    expect(calendarNames(fixture)).toContain('Hijri');

    // The calendar day is taken literally, so it must not slip a day in a
    // timezone west of Greenwich.
    expect(text(fixture, '.date-picker__calendars')).toContain(
      i18n.formatDate(new Date(2026, 2, 1)),
    );
  });

  it('drops the second calendar when it is turned off', async () => {
    fixture.componentInstance.showHijri.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    setDate(fixture, '2026-03-01');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(maybeEl(fixture, '.date-picker__calendars')).toBeNull();
  });

  it('describes itself with the hint and swaps to the error when invalid', async () => {
    fixture.componentInstance.hint.set('As printed on the civil ID.');
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-hint`);

    fixture.componentInstance.error.set('Enter a date in the past.');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-error`);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the input left to right in an Arabic page and names both calendars', async () => {
    setDate(fixture, '2026-03-01');
    fixture.detectChanges();
    await fixture.whenStable();

    await i18n.setLanguage('ar');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'input').getAttribute('dir')).toBe('ltr');
    expect(calendarNames(fixture)[0]).toBe('ميلادي');
  });

  it('takes a value from a form and reports the disabled state', async () => {
    const component = fixture.debugElement.children[0].componentInstance as DatePicker;

    component.writeValue('2025-07-14');
    component.setDisabledState(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.value).toBe('2025-07-14');
    expect(input.disabled).toBeTrue();
  });
});
