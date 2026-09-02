import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { el, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { TextField } from './text-field';

@Component({
  imports: [TextField, ReactiveFormsModule],
  template: `
    <app-text-field
      [formControl]="control"
      [label]="label()"
      [hint]="hint()"
      [error]="error()"
      [required]="required()"
      [textDirection]="textDirection()"
      (valueChange)="lastValue = $event"
    />
  `,
})
class Host {
  readonly control = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  readonly label = signal('Reference number');
  readonly hint = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly required = signal(false);
  readonly textDirection = signal<'ltr' | 'rtl' | 'auto' | null>(null);
  lastValue = '';
}

describe('TextField', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function input(): HTMLInputElement {
    return el<HTMLInputElement>(fixture, 'input');
  }

  function type(value: string): void {
    const element = input();
    element.value = value;
    element.dispatchEvent(new Event('input'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders a labelled input wired by id', () => {
    const label = el<HTMLLabelElement>(fixture, 'label');
    expect(label.getAttribute('for')).toBe(input().id);
    expect(input().id.length).toBeGreaterThan(0);
    expect(text(fixture, '.field__label-text')).toBe('Reference number');
  });

  it('writes the form control value into the input', async () => {
    fixture.componentInstance.control.setValue('CA-2026-00042');
    await render();

    expect(input().value).toBe('CA-2026-00042');
  });

  it('pushes typed values back into the form control', () => {
    type('CA-2026-00099');

    expect(fixture.componentInstance.control.value).toBe('CA-2026-00099');
    expect(fixture.componentInstance.lastValue).toBe('CA-2026-00099');
  });

  it('marks the control as touched on blur so errors can appear', () => {
    expect(fixture.componentInstance.control.touched).toBeFalse();

    input().dispatchEvent(new Event('blur'));

    expect(fixture.componentInstance.control.touched).toBeTrue();
  });

  it('reflects the disabled state from the form control', async () => {
    fixture.componentInstance.control.disable();
    await render();

    expect(input().disabled).toBeTrue();
  });

  it('links the hint through aria-describedby', async () => {
    fixture.componentInstance.hint.set('As printed on the receipt.');
    await render();

    expect(input().getAttribute('aria-describedby')).toBe(`${input().id}-hint`);
  });

  it('announces an error and switches aria-describedby to it', async () => {
    fixture.componentInstance.error.set('Enter a reference number.');
    await render();

    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe(`${input().id}-error`);
    expect(text(fixture, '.field__error')).toContain('Enter a reference number.');
  });

  it('leaves aria-invalid off while the field is valid', () => {
    expect(input().hasAttribute('aria-invalid')).toBeFalse();
  });

  it('marks required fields for assistive technology', async () => {
    fixture.componentInstance.required.set(true);
    await render();

    expect(input().getAttribute('aria-required')).toBe('true');
  });

  it('can pin the contents left to right for identifiers inside an Arabic page', async () => {
    await setupI18n('ar');
    fixture.componentInstance.textDirection.set('ltr');
    await render();

    // The page is right to left, but a reference number is not bidirectional
    // text and must not reorder.
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(input().getAttribute('dir')).toBe('ltr');
  });

  it('shows Arabic labels once the language switches', async () => {
    fixture.componentInstance.label.set('إرسال');
    await setupI18n('ar');
    await render();

    expect(text(fixture, '.field__label-text')).toBe('إرسال');
  });
});
