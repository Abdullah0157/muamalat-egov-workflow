import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, maybeEl, text } from '../../testing/dom';
import { EmptyState } from './empty-state';

@Component({
  imports: [EmptyState],
  template: `
    <app-empty-state [icon]="icon()" [title]="title()" [description]="description()">
      @if (withAction()) {
        <button emptyStateAction type="button" class="probe-action">Start a new request</button>
      }
    </app-empty-state>
  `,
})
class Host {
  readonly icon = signal<'inbox' | null>('inbox');
  readonly title = signal('Your queue is clear');
  readonly description = signal<string | null>('New cases appear here as soon as they are routed.');
  readonly withAction = signal(false);
}

describe('EmptyState', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('renders the fact and the explanation', () => {
    expect(text(fixture, '.empty-state__title')).toBe('Your queue is clear');
    expect(text(fixture, '.empty-state__description')).toContain('New cases appear here');
  });

  it('renders a glyph only when one is offered', async () => {
    expect(maybeEl(fixture, '.empty-state__icon')).not.toBeNull();

    fixture.componentInstance.icon.set(null);
    await settle();

    expect(maybeEl(fixture, '.empty-state__icon')).toBeNull();
  });

  it('keeps the decorative glyph out of the accessibility tree', () => {
    expect(el(fixture, '.empty-state__icon svg').getAttribute('aria-hidden')).toBe('true');
  });

  it('drops the description when there is nothing to add', async () => {
    fixture.componentInstance.description.set(null);
    await settle();

    expect(maybeEl(fixture, '.empty-state__description')).toBeNull();
  });

  it('projects an action into its own slot', async () => {
    expect(maybeEl(fixture, '.empty-state__action .probe-action')).toBeNull();

    fixture.componentInstance.withAction.set(true);
    await settle();

    expect(maybeEl(fixture, '.empty-state__action .probe-action')).not.toBeNull();
  });

  it('does not announce itself as a problem', () => {
    // An empty list is a fact. Nothing here claims a live region or an alert.
    const host = el(fixture, 'app-empty-state');
    expect(host.hasAttribute('role')).toBeFalse();
    expect(host.hasAttribute('aria-live')).toBeFalse();
  });
});
