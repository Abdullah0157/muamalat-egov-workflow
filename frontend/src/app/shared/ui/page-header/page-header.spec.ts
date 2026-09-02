import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, maybeEl, text } from '../../testing/dom';
import { PageHeader } from './page-header';

@Component({
  imports: [PageHeader],
  template: `
    <app-page-header [heading]="heading()" [description]="description()">
      <nav pageHeaderBreadcrumbs aria-label="Breadcrumb" class="trail">Home / Requests</nav>
      <span pageHeaderMeta class="meta-chip">REQ-2026-0041</span>
      <button pageHeaderActions type="button" class="action">New request</button>
    </app-page-header>
  `,
})
class Host {
  readonly heading = signal('My requests');
  readonly description = signal<string | null>('Everything you have filed with the ministry.');
}

describe('PageHeader', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders the heading as the page level one heading', () => {
    const heading = el(fixture, 'h1');
    expect(heading.tagName).toBe('H1');
    expect(heading.textContent?.trim()).toBe('My requests');
  });

  it('renders the description only when there is one', async () => {
    expect(text(fixture, '.page-header__description')).toBe(
      'Everything you have filed with the ministry.',
    );

    fixture.componentInstance.description.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(maybeEl(fixture, '.page-header__description')).toBeNull();
  });

  it('projects the breadcrumb trail above the heading', () => {
    expect(el(fixture, '.page-header__breadcrumbs .trail').getAttribute('aria-label')).toBe(
      'Breadcrumb',
    );
  });

  it('projects metadata under the heading and actions at the trailing edge', () => {
    expect(text(fixture, '.page-header__meta .meta-chip')).toBe('REQ-2026-0041');
    expect(text(fixture, '.page-header__actions .action')).toBe('New request');
  });

  it('keeps the heading before the actions in the document order', () => {
    const children = Array.from(el(fixture, '.page-header__bar').children).map(
      (child) => child.className,
    );
    expect(children).toEqual(['page-header__heading', 'page-header__actions']);
  });
});
