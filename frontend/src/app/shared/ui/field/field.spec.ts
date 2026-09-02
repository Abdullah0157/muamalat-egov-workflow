import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../testing/i18n';
import { el, maybeEl, text } from '../../testing/dom';
import { Field, describedByFor, errorIdFor, hintIdFor, nextControlId } from './field';

@Component({
  imports: [Field],
  template: `
    <app-field
      [label]="label()"
      controlId="test-control"
      [hint]="hint()"
      [error]="error()"
      [required]="required()"
      [showOptional]="showOptional()"
    >
      <input id="test-control" />
    </app-field>
  `,
})
class Host {
  readonly label = signal('Civil ID');
  readonly hint = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly required = signal(false);
  readonly showOptional = signal(false);
}

describe('Field', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
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
    await fixture.whenStable();
  });

  it('renders a label that points at the control', () => {
    const label = el<HTMLLabelElement>(fixture, 'label');
    expect(label.getAttribute('for')).toBe('test-control');
    expect(text(fixture, '.field__label-text')).toBe('Civil ID');
  });

  it('marks a required field with more than a symbol', async () => {
    fixture.componentInstance.required.set(true);
    await render();

    // The asterisk is decorative; the word is what a screen reader announces.
    expect(el(fixture, '.field__required').getAttribute('aria-hidden')).toBe('true');
    expect(text(fixture, '.u-visually-hidden')).toBe('required');
  });

  it('labels optional fields explicitly when asked', async () => {
    fixture.componentInstance.showOptional.set(true);
    await render();

    expect(text(fixture, '.field__optional')).toBe('optional');
  });

  it('renders a hint with a predictable id', async () => {
    fixture.componentInstance.hint.set('Twelve digits from the card.');
    await render();

    const hint = el(fixture, '.field__hint');
    expect(hint.id).toBe('test-control-hint');
    expect(hint.textContent?.trim()).toBe('Twelve digits from the card.');
  });

  it('replaces the hint with the error so the two never compete', async () => {
    fixture.componentInstance.hint.set('Twelve digits from the card.');
    fixture.componentInstance.error.set('Enter the twelve digit civil ID.');
    await render();

    expect(maybeEl(fixture, '.field__hint')).toBeNull();
    expect(el(fixture, '.field__error').id).toBe('test-control-error');
  });

  it('pairs the error with an icon rather than relying on colour', async () => {
    fixture.componentInstance.error.set('Something specific is wrong.');
    await render();

    expect(maybeEl(fixture, '.field__error app-icon')).not.toBeNull();
    expect(el(fixture, '.field__error').textContent).toContain('Something specific is wrong.');
  });

  it('flags the invalid state on the host', async () => {
    expect(el(fixture, 'app-field').classList).not.toContain('field--invalid');

    fixture.componentInstance.error.set('Bad');
    await render();

    expect(el(fixture, 'app-field').classList).toContain('field--invalid');
  });
});

describe('field id helpers', () => {
  it('derives hint and error ids from the control id', () => {
    expect(hintIdFor('abc')).toBe('abc-hint');
    expect(errorIdFor('abc')).toBe('abc-error');
  });

  it('omits aria-describedby entirely when there is nothing to describe', () => {
    expect(describedByFor('abc', null, null)).toBeNull();
  });

  it('points at the hint when there is no error', () => {
    expect(describedByFor('abc', 'a hint', null)).toBe('abc-hint');
  });

  it('points only at the error once one exists', () => {
    expect(describedByFor('abc', 'a hint', 'an error')).toBe('abc-error');
  });

  it('hands out unique control ids', () => {
    const first = nextControlId('x');
    const second = nextControlId('x');
    expect(first).not.toBe(second);
  });
});
