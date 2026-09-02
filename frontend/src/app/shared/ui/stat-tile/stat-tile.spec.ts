import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { IconName } from '../icon/icon';
import { all, el, maybeEl, text } from '../../testing/dom';
import { StatTile, StatTileTone, StatTileTrend } from './stat-tile';

@Component({
  imports: [StatTile],
  template: `
    <app-stat-tile
      [label]="label()"
      [value]="value()"
      [unit]="unit()"
      [hint]="hint()"
      [tone]="tone()"
      [icon]="icon()"
      [trend]="trend()"
      [link]="link()"
    />
  `,
})
class Host {
  readonly label = signal('Average processing time');
  readonly value = signal('4.2');
  readonly unit = signal<string | null>('days');
  readonly hint = signal<string | null>(
    'Mean time from submission to closure, closed cases only.',
  );
  readonly tone = signal<StatTileTone>('neutral');
  readonly icon = signal<IconName | null>('clock');
  readonly trend = signal<StatTileTrend | null>(null);
  readonly link = signal<unknown[] | string | null>(null);
}

describe('StatTile', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders the label, the formatted value and its unit', () => {
    expect(text(fixture, '.stat-tile__label')).toBe('Average processing time');
    expect(text(fixture, '.stat-tile__number')).toBe('4.2');
    expect(text(fixture, '.stat-tile__unit')).toBe('days');
  });

  it('explains the figure in small print', () => {
    expect(text(fixture, '.stat-tile__hint')).toContain('closed cases only');
  });

  it('is a plain panel until a link is given', () => {
    expect(maybeEl(fixture, 'a')).toBeNull();
    expect(maybeEl(fixture, '.stat-tile__chevron')).toBeNull();
  });

  it('becomes a single anchor wrapping the whole tile when linked', async () => {
    fixture.componentInstance.link.set(['/supervisor', 'cases']);
    fixture.detectChanges();
    await fixture.whenStable();

    const anchor = el<HTMLAnchorElement>(fixture, 'a');
    expect(anchor.getAttribute('href')).toBe('/supervisor/cases');
    expect(anchor.querySelector('.stat-tile__number')).not.toBeNull();
    expect(all(fixture, 'a, button').length).toBe(1);
    expect(maybeEl(fixture, '.stat-tile__chevron')).not.toBeNull();
  });

  it('shows a downward trend that is good in the success tone, with words beside it', async () => {
    fixture.componentInstance.trend.set({
      direction: 'down',
      label: '12% faster than last month',
      good: true,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const trend = el(fixture, '.stat-tile__trend');
    expect(trend.classList).toContain('stat-tile__trend--good');
    expect(trend.textContent?.trim()).toContain('12% faster than last month');
    expect(trend.querySelector('app-icon')).not.toBeNull();
  });

  it('shows an upward trend that is bad in the danger tone', async () => {
    fixture.componentInstance.trend.set({
      direction: 'up',
      label: '3 more breaches',
      good: false,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, '.stat-tile__trend').classList).toContain('stat-tile__trend--bad');
  });

  it('applies the tone to the host so a row of tiles stays consistent', async () => {
    fixture.componentInstance.tone.set('danger');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'app-stat-tile').classList).toContain('stat-tile--danger');
  });

  it('drops the icon chip when no icon is supplied', async () => {
    fixture.componentInstance.icon.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(maybeEl(fixture, '.stat-tile__icon')).toBeNull();
  });
});
