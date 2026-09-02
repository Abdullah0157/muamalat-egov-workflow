import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { all, el, maybeEl, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { Select, SelectOption, SelectOptionGroup } from './select';

@Component({
  imports: [Select],
  template: `
    <app-select
      [label]="label()"
      [options]="options()"
      [groups]="groups()"
      [placeholder]="placeholder()"
      [hint]="hint()"
      [error]="error()"
      [required]="required()"
      (valueChange)="chosen = $event"
    />
  `,
})
class Host {
  readonly label = signal('Department');
  readonly options = signal<readonly SelectOption[]>([
    { value: 'civil', label: 'Civil affairs' },
    { value: 'housing', label: 'Housing' },
    { value: 'closed', label: 'Closed office', disabled: true },
  ]);
  readonly groups = signal<readonly SelectOptionGroup[]>([]);
  readonly placeholder = signal<string | null>(null);
  readonly hint = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly required = signal(false);
  chosen = '';
}

describe('Select', () => {
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

  it('renders a native select with one option per entry', () => {
    expect(el(fixture, 'select').tagName).toBe('SELECT');
    expect(all(fixture, 'option').length).toBe(3);
    expect(text(fixture, 'option')).toBe('Civil affairs');
  });

  it('wires the label to the control through the shared field scaffolding', () => {
    const label = el<HTMLLabelElement>(fixture, 'label');
    const control = el<HTMLSelectElement>(fixture, 'select');
    expect(label.getAttribute('for')).toBe(control.id);
    expect(control.id).toContain('select-');
  });

  it('carries a disabled option through to the DOM', () => {
    expect(all<HTMLOptionElement>(fixture, 'option')[2].disabled).toBeTrue();
  });

  it('renders the placeholder as a disabled empty first option', async () => {
    fixture.componentInstance.placeholder.set('Choose a department');
    fixture.detectChanges();
    await fixture.whenStable();

    const first = all<HTMLOptionElement>(fixture, 'option')[0];
    expect(first.value).toBe('');
    expect(first.disabled).toBeTrue();
    expect(first.selected).toBeTrue();
  });

  it('emits the chosen value on change', async () => {
    const control = el<HTMLSelectElement>(fixture, 'select');
    control.value = 'housing';
    control.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(fixture.componentInstance.chosen).toBe('housing');
  });

  it('describes itself with the hint and switches to the error when invalid', async () => {
    fixture.componentInstance.hint.set('Pick the department that issued the file.');
    fixture.detectChanges();
    await fixture.whenStable();

    const control = el<HTMLSelectElement>(fixture, 'select');
    expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-hint`);
    expect(control.hasAttribute('aria-invalid')).toBeFalse();

    fixture.componentInstance.error.set('Choose a department.');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-error`);
    expect(control.getAttribute('aria-invalid')).toBe('true');
  });

  it('marks a required control for assistive technology as well as visually', async () => {
    fixture.componentInstance.required.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'select').getAttribute('aria-required')).toBe('true');
    expect(text(fixture, '.u-visually-hidden')).toBe('required');
  });

  it('renders grouped options inside an optgroup', async () => {
    fixture.componentInstance.options.set([]);
    fixture.componentInstance.groups.set([
      { label: 'Ministries', options: [{ value: 'interior', label: 'Interior' }] },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el<HTMLOptGroupElement>(fixture, 'optgroup').label).toBe('Ministries');
    expect(all(fixture, 'optgroup option').length).toBe(1);
  });

  it('reflects a value written by a form onto the matching option', async () => {
    const component = fixture.debugElement.children[0].componentInstance as Select;
    component.writeValue('housing');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el<HTMLSelectElement>(fixture, 'select').value).toBe('housing');
  });

  it('disables the control when the form disables it', async () => {
    const component = fixture.debugElement.children[0].componentInstance as Select;
    component.setDisabledState(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el<HTMLSelectElement>(fixture, 'select').disabled).toBeTrue();
    expect(maybeEl(fixture, '.field--disabled')).not.toBeNull();
  });
});
