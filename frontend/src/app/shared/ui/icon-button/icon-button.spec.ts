import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, maybeEl } from '../../testing/dom';
import { IconButton } from './icon-button';

@Component({
  imports: [IconButton],
  template: `
    <app-icon-button
      icon="trash"
      [label]="label()"
      [variant]="variant()"
      [size]="size()"
      [disabled]="disabled()"
      [ariaPressed]="ariaPressed()"
      (pressed)="clicks = clicks + 1"
    />
  `,
})
class Host {
  readonly label = signal('Delete attachment');
  readonly variant = signal<'ghost' | 'secondary' | 'danger'>('ghost');
  readonly size = signal<'sm' | 'md' | 'lg'>('md');
  readonly disabled = signal(false);
  readonly ariaPressed = signal<'true' | 'false' | null>(null);
  clicks = 0;
}

describe('IconButton', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders a native button carrying the requested glyph', () => {
    const button = el<HTMLButtonElement>(fixture, 'button');
    expect(button.tagName).toBe('BUTTON');
    expect(maybeEl(fixture, 'app-icon')).not.toBeNull();
  });

  it('gives the icon an accessible name and a tooltip from the same label', () => {
    const button = el<HTMLButtonElement>(fixture, 'button');
    expect(button.getAttribute('aria-label')).toBe('Delete attachment');
    expect(button.getAttribute('title')).toBe('Delete attachment');
  });

  it('leaves the glyph itself out of the accessibility tree', () => {
    // The name is on the button; a second name on the svg would be read twice.
    expect(el(fixture, 'app-icon svg').getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to type="button" so it cannot submit a surrounding form', () => {
    expect(el<HTMLButtonElement>(fixture, 'button').getAttribute('type')).toBe('button');
  });

  it('emits pressed when activated', () => {
    el<HTMLButtonElement>(fixture, 'button').click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });

  it('does not emit when disabled', async () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    el<HTMLButtonElement>(fixture, 'button').click();
    expect(fixture.componentInstance.clicks).toBe(0);
  });

  it('applies the variant and size classes', async () => {
    expect(el(fixture, 'button').classList).toContain('icon-btn--ghost');
    expect(el(fixture, 'button').classList).toContain('icon-btn--md');

    fixture.componentInstance.variant.set('danger');
    fixture.componentInstance.size.set('lg');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'button').classList).toContain('icon-btn--danger');
    expect(el(fixture, 'button').classList).toContain('icon-btn--lg');
  });

  it('writes aria-pressed only when the control is a toggle', async () => {
    expect(el(fixture, 'button').hasAttribute('aria-pressed')).toBeFalse();

    fixture.componentInstance.ariaPressed.set('true');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'button').getAttribute('aria-pressed')).toBe('true');
  });
});
