import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { el, maybeEl, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { Textarea } from './textarea';

@Component({
  imports: [Textarea],
  template: `
    <app-textarea
      [label]="label()"
      [hint]="hint()"
      [error]="error()"
      [rows]="rows()"
      [maxLength]="maxLength()"
      [required]="required()"
      (valueChange)="typed = $event"
    />
  `,
})
class Host {
  readonly label = signal('Reason for the decision');
  readonly hint = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly rows = signal(4);
  readonly maxLength = signal<number | null>(null);
  readonly required = signal(false);
  typed = '';
}

function type(fixture: ComponentFixture<Host>, value: string): void {
  const control = el<HTMLTextAreaElement>(fixture, 'textarea');
  control.value = value;
  control.dispatchEvent(new Event('input'));
}

describe('Textarea', () => {
  // The i18n service remembers the chosen language in local storage, and that
  // store is shared by every spec in the run. Clearing it on both sides keeps a
  // language switch here from deciding what language another file starts in.
  beforeEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));

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

  it('renders a native textarea with the requested number of rows', () => {
    const control = el<HTMLTextAreaElement>(fixture, 'textarea');
    expect(control.tagName).toBe('TEXTAREA');
    expect(control.getAttribute('rows')).toBe('4');
  });

  it('labels the control through the shared field scaffolding', () => {
    const label = el<HTMLLabelElement>(fixture, 'label');
    const control = el<HTMLTextAreaElement>(fixture, 'textarea');
    expect(label.getAttribute('for')).toBe(control.id);
    expect(text(fixture, '.field__label-text')).toBe('Reason for the decision');
  });

  it('emits what was typed', async () => {
    type(fixture, 'The applicant supplied the missing tenancy contract.');
    await fixture.whenStable();

    expect(fixture.componentInstance.typed).toBe(
      'The applicant supplied the missing tenancy contract.',
    );
  });

  it('shows no counter until a limit is set', () => {
    expect(maybeEl(fixture, '.textarea__counter')).toBeNull();
  });

  it('counts characters against the limit and describes the control with it', async () => {
    fixture.componentInstance.maxLength.set(100);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, '.textarea__counter')).toBe('0 of 100 characters');
    expect(el(fixture, 'textarea').getAttribute('maxlength')).toBe('100');

    const control = el<HTMLTextAreaElement>(fixture, 'textarea');
    expect(control.getAttribute('aria-describedby')).toContain(`${control.id}-counter`);

    type(fixture, 'Twelve chars');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, '.textarea__counter')).toBe('12 of 100 characters');
  });

  it('stays out of the announcement queue until the count is close to the limit', async () => {
    fixture.componentInstance.maxLength.set(100);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, '.textarea__counter').hasAttribute('aria-live')).toBeFalse();

    type(fixture, 'x'.repeat(95));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, '.textarea__counter').getAttribute('aria-live')).toBe('polite');
    expect(el(fixture, '.textarea__counter').classList).toContain('textarea__counter--near-limit');
  });

  it('formats the counter with the active locale', async () => {
    fixture.componentInstance.maxLength.set(2000);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, '.textarea__counter')).toBe('0 of 2,000 characters');
  });

  it('switches its description from the hint to the error when invalid', async () => {
    fixture.componentInstance.hint.set('Seen by the applicant.');
    fixture.detectChanges();
    await fixture.whenStable();

    const control = el<HTMLTextAreaElement>(fixture, 'textarea');
    expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-hint`);

    fixture.componentInstance.error.set('A comment is required for this action.');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-error`);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(text(fixture, '.field__error')).toContain('A comment is required');
  });

  it('accepts a value written by a form and reports its own disabled state', async () => {
    const component = fixture.debugElement.children[0].componentInstance as Textarea;

    component.writeValue('Restored draft');
    component.setDisabledState(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const control = el<HTMLTextAreaElement>(fixture, 'textarea');
    expect(control.value).toBe('Restored draft');
    expect(control.disabled).toBeTrue();
  });
});
