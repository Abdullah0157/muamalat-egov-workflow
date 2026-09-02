import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { el, maybeEl, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { Checkbox } from './checkbox';

@Component({
  imports: [Checkbox],
  template: `
    <app-checkbox
      [label]="label()"
      [hint]="hint()"
      [error]="error()"
      [required]="required()"
      [indeterminate]="indeterminate()"
      [disabled]="disabled()"
      (checkedChange)="value = $event"
    />
  `,
})
class Host {
  readonly label = signal('I confirm that the information given is correct.');
  readonly hint = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly required = signal(false);
  readonly indeterminate = signal(false);
  readonly disabled = signal(false);
  value = false;
}

function tick(fixture: ComponentFixture<Host>): void {
  const input = el<HTMLInputElement>(fixture, 'input');
  input.checked = true;
  input.dispatchEvent(new Event('change'));
}

describe('Checkbox', () => {
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

  it('renders a native checkbox beside a real label that points at it', () => {
    const input = el<HTMLInputElement>(fixture, 'input');
    const label = el<HTMLLabelElement>(fixture, 'label');

    expect(input.type).toBe('checkbox');
    expect(label.getAttribute('for')).toBe(input.id);
    expect(input.id).toContain('checkbox-');
    expect(text(fixture, '.checkbox__label')).toContain('information given is correct');
  });

  it('emits when it is ticked', async () => {
    tick(fixture);
    await fixture.whenStable();

    expect(fixture.componentInstance.value).toBeTrue();
  });

  it('draws a check glyph rather than relying on the fill colour', async () => {
    expect(maybeEl(fixture, '.checkbox__glyph')).toBeNull();

    tick(fixture);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(maybeEl(fixture, '.checkbox__glyph')).not.toBeNull();
  });

  it('sets indeterminate as a DOM property and shows the dash glyph', async () => {
    fixture.componentInstance.indeterminate.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.indeterminate).toBeTrue();
    expect(input.hasAttribute('indeterminate')).toBeFalse();
    expect(maybeEl(fixture, '.checkbox__glyph')).not.toBeNull();
  });

  it('describes itself with the hint and swaps to the error when invalid', async () => {
    fixture.componentInstance.hint.set('You cannot submit without confirming.');
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-hint`);
    expect(el(fixture, '.checkbox__hint').id).toBe(`${input.id}-hint`);

    fixture.componentInstance.error.set('Confirm the declaration before submitting.');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-error`);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(maybeEl(fixture, '.checkbox__hint')).toBeNull();
    expect(text(fixture, '.checkbox__error')).toContain('Confirm the declaration');
  });

  it('announces that it is required as well as marking it', async () => {
    fixture.componentInstance.required.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'input').getAttribute('aria-required')).toBe('true');
    expect(text(fixture, '.u-visually-hidden')).toBe('required');
  });

  it('does not emit while disabled', async () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.disabled).toBeTrue();
    input.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value).toBeFalse();
  });

  it('takes a value from a form and reports the form driven disabled state', async () => {
    const component = fixture.debugElement.children[0].componentInstance as Checkbox;

    component.writeValue(true);
    component.setDisabledState(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el<HTMLInputElement>(fixture, 'input');
    expect(input.checked).toBeTrue();
    expect(input.disabled).toBeTrue();
  });
});
