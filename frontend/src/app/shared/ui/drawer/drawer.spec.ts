import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../testing/i18n';
import { el, maybeEl, text, withDirection } from '../../testing/dom';
import { Drawer } from './drawer';

@Component({
  imports: [Drawer],
  template: `
    <button type="button" class="probe-opener" (click)="open.set(true)">Filters</button>

    <app-drawer
      [(open)]="open"
      [title]="title()"
      [side]="side()"
      [size]="size()"
      (closed)="closes = closes + 1"
    >
      <input class="probe-first" />
      <input class="probe-last" />
      <button drawerFooter type="button" class="probe-apply">Apply</button>
    </app-drawer>
  `,
})
class Host {
  readonly open = signal(false);
  readonly title = signal('Filter the queue');
  readonly side = signal<'inline-end' | 'inline-start'>('inline-end');
  readonly size = signal<'sm' | 'md' | 'lg'>('md');
  closes = 0;
}

describe('Drawer', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function panel(): HTMLElement {
    return el<HTMLElement>(fixture, '.drawer__panel');
  }

  function press(key: string, options: KeyboardEventInit = {}): void {
    panel().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
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

  it('is inert and unnamed to assistive technology while closed', () => {
    expect(panel().hasAttribute('inert')).toBeTrue();
    expect(panel().classList).not.toContain('drawer__panel--open');
  });

  it('announces itself as a modal dialog labelled by its title', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(text(fixture, `#${panel().getAttribute('aria-labelledby')}`)).toBe('Filter the queue');
    expect(panel().hasAttribute('inert')).toBeFalse();
  });

  it('moves focus into the panel on open and back to the opener on close', async () => {
    const opener = el<HTMLButtonElement>(fixture, '.probe-opener');
    opener.focus();
    opener.click();
    await settle();

    // The first stop in the panel is its own close button.
    expect(panel().contains(document.activeElement)).toBeTrue();
    expect(document.activeElement).toBe(el(fixture, '.drawer__close button'));

    fixture.componentInstance.open.set(false);
    await settle();

    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    press('Escape');
    await settle();

    expect(fixture.componentInstance.open()).toBeFalse();
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('closes when the scrim is clicked', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    el<HTMLElement>(fixture, '.drawer__scrim').click();
    await settle();

    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('wraps Tab from the last stop back to the first', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    const apply = el<HTMLButtonElement>(fixture, '.probe-apply');
    apply.focus();
    press('Tab');
    await settle();

    expect(document.activeElement).toBe(el(fixture, '.drawer__close button'));
  });

  it('wraps Shift+Tab from the first stop to the last', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    el<HTMLButtonElement>(fixture, '.drawer__close button').focus();
    press('Tab', { shiftKey: true });
    await settle();

    expect(document.activeElement).toBe(el(fixture, '.probe-apply'));
  });

  it('leaves Tab alone in the middle of the panel', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    const middle = el<HTMLInputElement>(fixture, '.probe-last');
    middle.focus();
    press('Tab');
    await settle();

    // Focus has not been moved for us: the browser takes it from here.
    expect(document.activeElement).toBe(middle);
  });

  it('closes from its own close button, which carries a translated name', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    const close = el<HTMLButtonElement>(fixture, '.drawer__close button');
    expect(close.getAttribute('aria-label')).toBe('Close panel');

    close.click();
    await settle();

    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('anchors to the requested edge with a logical modifier rather than a side', async () => {
    fixture.componentInstance.side.set('inline-start');
    fixture.componentInstance.open.set(true);
    await settle();

    expect(panel().classList).toContain('drawer__panel--start');
  });

  it('resolves the inline end edge to the correct physical side in each direction', async () => {
    fixture.componentInstance.open.set(true);
    await settle();
    expect(getComputedStyle(panel()).right).toBe('0px');

    await withDirection('rtl', async () => {
      await settle();
      // Same DOM, same class, opposite edge. Nothing here names a physical side.
      expect(getComputedStyle(panel()).direction).toBe('rtl');
      expect(getComputedStyle(panel()).left).toBe('0px');
      expect(panel().classList).not.toContain('drawer__panel--start');
    });
  });

  it('projects footer actions into the footer', async () => {
    fixture.componentInstance.open.set(true);
    await settle();

    expect(maybeEl(fixture, '.drawer__footer .probe-apply')).not.toBeNull();
  });
});
