import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, withDirection } from '../../testing/dom';
import { Icon, IconName } from './icon';

@Component({
  imports: [Icon],
  template: `<app-icon [name]="name()" [size]="size()" [label]="label()" />`,
})
class Host {
  readonly name = signal<IconName>('check');
  readonly size = signal<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly label = signal<string | null>(null);
}

describe('Icon', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders an svg with the shared geometry settings', () => {
    const svg = el<SVGElement>(fixture, 'svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('draws different geometry for different names', async () => {
    const first = el(fixture, 'svg').innerHTML;

    fixture.componentInstance.name.set('user');
    await render();

    expect(el(fixture, 'svg').innerHTML).not.toBe(first);
    expect(el(fixture, 'svg').innerHTML.length).toBeGreaterThan(0);
  });

  it('is hidden from assistive technology when it carries no label', () => {
    const svg = el(fixture, 'svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('role')).toBeFalse();
  });

  it('becomes an image with a name when a label is given', async () => {
    fixture.componentInstance.label.set('Verified');
    await render();

    const svg = el(fixture, 'svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Verified');
    expect(svg.hasAttribute('aria-hidden')).toBeFalse();
  });

  it('applies the size class to the host', async () => {
    expect(el(fixture, 'app-icon').classList).toContain('icon--md');

    fixture.componentInstance.size.set('xl');
    await render();

    expect(el(fixture, 'app-icon').classList).toContain('icon--xl');
  });

  // ---------------------------------------------------------------------------
  // Direction
  // ---------------------------------------------------------------------------

  it('marks direction bearing icons for mirroring', async () => {
    fixture.componentInstance.name.set('chevron-next');
    await render();

    expect(el(fixture, 'svg').classList).toContain('icon__glyph--mirrored');
  });

  it('does not mirror icons whose meaning has no direction', async () => {
    for (const name of ['clock', 'user', 'file', 'calendar', 'chevron-down'] as IconName[]) {
      fixture.componentInstance.name.set(name);
      await render();

      expect(el(fixture, 'svg').classList)
        .withContext(`${name} must keep its orientation`)
        .not.toContain('icon__glyph--mirrored');
    }
  });

  it('keeps the mirroring decision independent of the current direction', async () => {
    await withDirection('rtl', async () => {
      fixture.componentInstance.name.set('arrow-next');
      await render();
      // The class is always present on a directional icon; the stylesheet is
      // what applies the transform, and only under RTL.
      expect(el(fixture, 'svg').classList).toContain('icon__glyph--mirrored');

      fixture.componentInstance.name.set('clock');
      await render();
      expect(el(fixture, 'svg').classList).not.toContain('icon__glyph--mirrored');
    });
  });
});
