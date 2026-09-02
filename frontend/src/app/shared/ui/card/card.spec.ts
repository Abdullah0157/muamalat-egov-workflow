import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { el, maybeEl, text } from '../../testing/dom';
import { Card } from './card';

@Component({
  imports: [Card],
  template: `
    <app-card [hasHeader]="hasHeader()" [flush]="flush()">
      <span cardTitle>Departmental workload</span>
      <span cardSubtitle>Open cases per department</span>
      <button cardActions type="button">Export</button>
      <p class="body">Body content</p>
      <span cardFooter>Footer content</span>
    </app-card>
  `,
})
class Host {
  readonly hasHeader = signal(true);
  readonly flush = signal(false);
}

@Component({
  imports: [Card],
  template: `<app-card [hasHeader]="false"><p class="body">Just a body</p></app-card>`,
})
class BareHost {}

describe('Card', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host, BareHost] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('projects the title into a heading element', () => {
    expect(el(fixture, '.card__title').tagName).toBe('H2');
    expect(text(fixture, '.card__title')).toBe('Departmental workload');
  });

  it('projects the subtitle, actions, body and footer into their slots', () => {
    expect(text(fixture, '.card__subtitle')).toBe('Open cases per department');
    expect(text(fixture, '.card__actions')).toBe('Export');
    expect(text(fixture, '.card__body .body')).toBe('Body content');
    expect(text(fixture, '.card__footer')).toBe('Footer content');
  });

  it('exposes the title id so a region can be labelled by it', async () => {
    const card = TestBed.createComponent(Card);
    card.componentRef.setInput('titleId', 'workload-title');
    card.detectChanges();
    await card.whenStable();

    expect(card.nativeElement.querySelector('.card__title')?.getAttribute('id')).toBe(
      'workload-title',
    );
  });

  it('omits the header entirely when the card has no title', async () => {
    const bare = TestBed.createComponent(BareHost);
    bare.detectChanges();
    await bare.whenStable();

    expect(bare.nativeElement.querySelector('.card__header')).toBeNull();
    expect(bare.nativeElement.querySelector('.body')?.textContent).toBe('Just a body');
  });

  it('drops body padding when flush, for tables and canvases', async () => {
    fixture.componentInstance.flush.set(true);
    await render();

    expect(el(fixture, 'app-card').classList).toContain('card--flush');
  });

  it('does not add a flush class by default', () => {
    expect(el(fixture, 'app-card').classList).not.toContain('card--flush');
    expect(maybeEl(fixture, '.card__header')).not.toBeNull();
  });
});
