import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { setupI18n, testProviders } from '../../testing/i18n';
import { all, el, maybeEl } from '../../testing/dom';
import { BreadcrumbItem, Breadcrumbs } from './breadcrumbs';

@Component({
  imports: [Breadcrumbs],
  template: `<app-breadcrumbs [items]="items()" />`,
})
class Host {
  readonly items = signal<readonly BreadcrumbItem[]>([
    { label: 'Home', link: '/' },
    { label: 'My requests', link: '/citizen/requests' },
    { label: 'KW-2026-0041' },
  ]);
}

describe('Breadcrumbs', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('is a labelled navigation landmark holding an ordered list', () => {
    expect(el(fixture, 'nav').getAttribute('aria-label')).toBe('Breadcrumb');
    expect(el(fixture, 'nav > ol').tagName).toBe('OL');
    expect(all(fixture, '.breadcrumbs__item').length).toBe(3);
  });

  it('links every crumb except the one you are on', () => {
    const links = all<HTMLAnchorElement>(fixture, '.breadcrumbs__link');
    expect(links.map((link) => link.textContent?.trim())).toEqual(['Home', 'My requests']);
    expect(links[0].getAttribute('href')).toBe('/');
  });

  it('marks the last crumb as the current page and leaves it unlinked', () => {
    const current = el(fixture, '[aria-current="page"]');
    expect(current.tagName).toBe('SPAN');
    expect(current.textContent?.trim()).toBe('KW-2026-0041');
    expect(all(fixture, '[aria-current]').length).toBe(1);
  });

  it('renders a crumb without a link as plain text', async () => {
    fixture.componentInstance.items.set([
      { label: 'Home', link: '/' },
      { label: 'Archive' },
      { label: 'KW-2026-0041' },
    ]);
    await settle();

    expect(all(fixture, '.breadcrumbs__link').length).toBe(1);
    expect(all(fixture, '[aria-current="page"]').length).toBe(1);
  });

  it('separates crumbs with a direction bearing chevron hidden from screen readers', () => {
    const separators = all(fixture, '.breadcrumbs__separator');
    // One fewer than the crumbs: nothing follows the page you are on.
    expect(separators.length).toBe(2);
    expect(el(fixture, '.breadcrumbs__separator svg').getAttribute('aria-hidden')).toBe('true');
    expect(el(fixture, '.breadcrumbs__separator svg').classList).toContain('icon__glyph--mirrored');
  });

  it('leaves a short trail whole', () => {
    expect(maybeEl(fixture, '.breadcrumbs__ellipsis')).toBeNull();
    expect(all(fixture, '.breadcrumbs__item--collapsible').length).toBe(0);
  });

  it('marks the middle of a long trail as collapsible, keeping the first and last two', async () => {
    fixture.componentInstance.items.set([
      { label: 'Home', link: '/' },
      { label: 'Workflows', link: '/admin' },
      { label: 'Building permit', link: '/admin/permit' },
      { label: 'Version 3', link: '/admin/permit/3' },
      { label: 'Review state' },
    ]);
    await settle();

    const collapsible = all(fixture, '.breadcrumbs__item--collapsible');
    expect(collapsible.map((item) => item.textContent?.trim())).toEqual([
      'Workflows',
      'Building permit',
    ]);
    expect(maybeEl(fixture, '.breadcrumbs__ellipsis')).not.toBeNull();
  });

  it('places the ellipsis directly after the root', async () => {
    fixture.componentInstance.items.set([
      { label: 'Home', link: '/' },
      { label: 'Workflows', link: '/admin' },
      { label: 'Building permit', link: '/admin/permit' },
      { label: 'Review state' },
    ]);
    await settle();

    const children = Array.from(el(fixture, '.breadcrumbs__list').children);
    expect(children[0].textContent?.trim()).toBe('Home');
    expect(children[1].classList).toContain('breadcrumbs__ellipsis');
    expect(children[1].getAttribute('aria-hidden')).toBe('true');
  });
});
