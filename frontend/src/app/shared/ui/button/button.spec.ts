import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, maybeEl, text } from '../../testing/dom';
import { Button, ButtonVariant } from './button';
import { IconName } from '../icon/icon';

/**
 * Every mutable field on this host is a signal.
 *
 * Under zoneless change detection `fixture.detectChanges()` refreshes dirty
 * views only, and writing to a plain class field marks nothing dirty. A host
 * built from plain fields silently never pushes new inputs into the component,
 * so its assertions quietly re-test the first render. This is the pattern every
 * spec in the product follows.
 */
@Component({
  imports: [Button],
  template: `
    <app-button
      [variant]="variant()"
      [busy]="busy()"
      [disabled]="disabled()"
      [icon]="icon()"
      (pressed)="clicks.set(clicks() + 1)"
    >
      {{ caption() }}
    </app-button>
  `,
})
class Host {
  readonly variant = signal<ButtonVariant>('primary');
  readonly busy = signal(false);
  readonly disabled = signal(false);
  readonly icon = signal<IconName | null>(null);
  readonly caption = signal('Submit');
  readonly clicks = signal(0);
}

describe('Button', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function button(): HTMLButtonElement {
    return el<HTMLButtonElement>(fixture, 'button');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await render();
  });

  it('renders a native button element carrying the projected label', () => {
    expect(button().tagName).toBe('BUTTON');
    expect(text(fixture, '.btn__label')).toBe('Submit');
  });

  it('defaults to type="button" so it cannot accidentally submit a form', () => {
    expect(button().getAttribute('type')).toBe('button');
  });

  it('emits pressed when activated', () => {
    button().click();
    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('applies the variant class', async () => {
    expect(button().classList).toContain('btn--primary');

    fixture.componentInstance.variant.set('danger');
    await render();

    expect(button().classList).toContain('btn--danger');
    expect(button().classList).not.toContain('btn--primary');
  });

  it('blocks activation and announces itself while busy', async () => {
    fixture.componentInstance.busy.set(true);
    await render();

    expect(button().disabled).toBeTrue();
    expect(button().getAttribute('aria-busy')).toBe('true');

    button().click();
    expect(fixture.componentInstance.clicks()).toBe(0);
  });

  it('keeps its visible label while busy so context is not lost', async () => {
    fixture.componentInstance.busy.set(true);
    await render();

    expect(text(fixture, '.btn__label')).toBe('Submit');
    expect(maybeEl(fixture, 'app-icon.icon--spin')).not.toBeNull();
  });

  it('does not emit when disabled', async () => {
    fixture.componentInstance.disabled.set(true);
    await render();

    button().click();
    expect(fixture.componentInstance.clicks()).toBe(0);
  });

  it('renders a leading icon only when one is requested', async () => {
    expect(maybeEl(fixture, 'app-icon')).toBeNull();

    fixture.componentInstance.icon.set('check');
    await render();

    expect(maybeEl(fixture, 'app-icon')).not.toBeNull();
  });

  it('leaves aria-busy off when idle rather than writing false', () => {
    expect(button().hasAttribute('aria-busy')).toBeFalse();
  });
});
