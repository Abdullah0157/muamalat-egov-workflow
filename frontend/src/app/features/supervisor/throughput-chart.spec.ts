import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ThroughputPoint } from '../../core/data/metrics';
import { I18nService } from '../../core/i18n/i18n.service';
import { all, el } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { ThroughputChart } from './throughput-chart';

/** A peak of eight makes every height land on a value the DOM returns intact. */
const POINTS: readonly ThroughputPoint[] = [
  { weekStart: '2026-08-02T00:00:00.000Z', submitted: 8, closed: 6 },
  { weekStart: '2026-08-09T00:00:00.000Z', submitted: 4, closed: 0 },
  { weekStart: '2026-08-16T00:00:00.000Z', submitted: 2, closed: 1 },
];

describe('ThroughputChart', () => {
  let fixture: ComponentFixture<ThroughputChart>;
  let i18n: I18nService;

  async function render(points: readonly ThroughputPoint[], language: 'en' | 'ar' = 'en') {
    await TestBed.configureTestingModule({
      imports: [ThroughputChart],
      providers: [...testProviders()],
    }).compileComponents();
    i18n = await setupI18n(language);
    fixture = TestBed.createComponent(ThroughputChart);
    fixture.componentRef.setInput('points', points);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** The label the catalogue and the formatter produce, whatever the test machine's zone. */
  function weekLabel(weekStart: string): string {
    return i18n.t('supervisor.week', {
      date: i18n.formatDate(weekStart, { day: 'numeric', month: 'short' }),
    });
  }

  afterEach(() => TestBed.resetTestingModule());

  it('draws one group per week with two bars in it', async () => {
    await render(POINTS);

    const groups = all(fixture, '.throughput__group');
    expect(groups.length).toBe(3);
    expect(groups[0].querySelectorAll('.throughput__slot').length).toBe(2);
    expect(groups[0].querySelector('.throughput__bar--submitted')).not.toBeNull();
    expect(groups[0].querySelector('.throughput__bar--closed')).not.toBeNull();
  });

  it('scales every bar against the tallest value in the series', async () => {
    await render(POINTS);

    const submitted = all<HTMLElement>(fixture, '.throughput__bar--submitted');
    expect(submitted.map((bar) => bar.style.blockSize)).toEqual(['100%', '50%', '25%']);

    const closed = all<HTMLElement>(fixture, '.throughput__bar--closed');
    // Only two, because the middle week closed nothing and a zero is not drawn.
    expect(closed.map((bar) => bar.style.blockSize)).toEqual(['75%', '12.5%']);
  });

  it('leaves a week with no cases empty rather than drawing a stub', async () => {
    await render(POINTS);

    const middle = all(fixture, '.throughput__group')[1];
    expect(middle.querySelector('.throughput__bar--closed')).toBeNull();
    expect(middle.querySelectorAll('.throughput__slot').length).toBe(2);
  });

  it('labels the axis with the real peak and zero, not a rounded scale', async () => {
    await render(POINTS);

    expect(all(fixture, '.throughput__tick').map((tick) => tick.textContent?.trim())).toEqual([
      '8',
      '0',
    ]);
  });

  it('names every week from the catalogue and the date formatter', async () => {
    await render(POINTS);

    expect(all(fixture, '.throughput__label').map((node) => node.textContent?.trim())).toEqual(
      POINTS.map((point) => weekLabel(point.weekStart)),
    );
  });

  it('repeats every figure in the accessible table the chart points at', async () => {
    await render(POINTS);

    const rows = all(fixture, '.throughput__table tbody tr');
    expect(rows.length).toBe(3);
    expect(
      Array.from(rows[0].querySelectorAll('th, td')).map((cell) => cell.textContent?.trim()),
    ).toEqual([weekLabel(POINTS[0].weekStart), '8', '6']);
    expect(
      Array.from(rows[1].querySelectorAll('th, td')).map((cell) => cell.textContent?.trim()),
    ).toEqual([weekLabel(POINTS[1].weekStart), '4', '0']);

    const plot = el(fixture, '.throughput__scroll');
    expect(plot.getAttribute('role')).toBe('img');
    expect(plot.getAttribute('aria-label')).toBe(
      'Chart. The same figures are listed in the table below.',
    );
    expect(plot.getAttribute('aria-describedby')).toBe(el(fixture, '.throughput__table').id);
  });

  it('keeps the scrolling plot reachable from the keyboard', async () => {
    await render(POINTS);

    expect(el(fixture, '.throughput__scroll').getAttribute('tabindex')).toBe('0');
  });

  it('keeps the weeks in source order in Arabic, because the mirroring is done by CSS', async () => {
    await render(POINTS, 'ar');

    const labels = all(fixture, '.throughput__label').map((node) => node.textContent?.trim());
    expect(labels).toEqual(POINTS.map((point) => weekLabel(point.weekStart)));
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('survives a series in which nothing happened at all', async () => {
    await render([{ weekStart: '2026-08-02T00:00:00.000Z', submitted: 0, closed: 0 }]);

    expect(all(fixture, '.throughput__bar').length).toBe(0);
    expect(all(fixture, '.throughput__table tbody tr').length).toBe(1);
  });
});
