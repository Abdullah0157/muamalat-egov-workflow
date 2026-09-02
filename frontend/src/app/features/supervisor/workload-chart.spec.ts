import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DepartmentWorkload } from '../../core/data/metrics';
import { all, el, maybeEl } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { WorkloadChart } from './workload-chart';

/**
 * Counts chosen so every proportion lands on a value that survives a round trip
 * through the DOM: eight and four against a maximum of eight give 50, 37.5 and
 * 12.5 percent, which is what the assertions below read back.
 */
const ROWS: readonly DepartmentWorkload[] = [
  {
    departmentId: 'dep-civil-affairs',
    name: { en: 'Civil Affairs', ar: 'الأحوال المدنية' },
    open: 8,
    onTrack: 4,
    atRisk: 3,
    breached: 1,
  },
  {
    departmentId: 'dep-commerce',
    name: { en: 'Commerce and Industry', ar: 'التجارة والصناعة' },
    open: 4,
    onTrack: 4,
    atRisk: 0,
    breached: 0,
  },
];

describe('WorkloadChart', () => {
  let fixture: ComponentFixture<WorkloadChart>;

  async function render(rows: readonly DepartmentWorkload[], language: 'en' | 'ar' = 'en') {
    await TestBed.configureTestingModule({
      imports: [WorkloadChart],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n(language);
    fixture = TestBed.createComponent(WorkloadChart);
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('draws one bar per department, labelled with its open count', async () => {
    await render(ROWS);

    const bars = all(fixture, '.workload__bar');
    expect(bars.length).toBe(2);
    expect(bars[0].querySelector('.workload__department')?.textContent?.trim()).toBe(
      'Civil Affairs',
    );
    expect(bars[0].querySelector('.workload__count')?.textContent?.trim()).toBe('8');
    expect(bars[1].querySelector('.workload__count')?.textContent?.trim()).toBe('4');
  });

  it('sizes every segment against the busiest department, not against its own row', async () => {
    await render(ROWS);

    const first = all<HTMLElement>(fixture, '.workload__bar')[0].querySelectorAll<HTMLElement>(
      '.workload__segment',
    );
    expect(first.length).toBe(3);
    expect(first[0].style.inlineSize).toBe('50%');
    expect(first[1].style.inlineSize).toBe('37.5%');
    expect(first[2].style.inlineSize).toBe('12.5%');

    // Four open out of a maximum of eight is half the track, which is the whole
    // point of a shared scale: the second department really is doing half as much.
    const second = all<HTMLElement>(fixture, '.workload__bar')[1].querySelectorAll<HTMLElement>(
      '.workload__segment',
    );
    expect(second[0].style.inlineSize).toBe('50%');
  });

  it('draws nothing at all for a bucket with no cases in it', async () => {
    await render(ROWS);

    const second = all(fixture, '.workload__bar')[1];
    expect(second.querySelectorAll('.workload__segment').length).toBe(1);
    expect(second.querySelector('.workload__segment--at-risk')).toBeNull();
    expect(second.querySelector('.workload__segment--breached')).toBeNull();
  });

  it('repeats every figure in the accessible table', async () => {
    await render(ROWS);

    const rows = all(fixture, '.workload__table tbody tr');
    expect(rows.length).toBe(2);

    const cells = Array.from(rows[0].querySelectorAll('th, td')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(cells).toEqual(['Civil Affairs', '8', '4', '3', '1']);

    const zeroes = Array.from(rows[1].querySelectorAll('th, td')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(zeroes).toEqual(['Commerce and Industry', '4', '4', '0', '0']);
  });

  it('points the chart at that table and names it as a chart', async () => {
    await render(ROWS);

    const plot = el(fixture, '.workload__plot');
    expect(plot.getAttribute('role')).toBe('img');
    expect(plot.getAttribute('aria-label')).toBe(
      'Chart. The same figures are listed in the table below.',
    );
    expect(plot.getAttribute('aria-describedby')).toBe(el(fixture, '.workload__table').id);
  });

  it('pairs each legend colour with a word and a shape', async () => {
    await render(ROWS);

    const items = all(fixture, '.workload__legend-item');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'On track',
      'At risk',
      'Breached',
    ]);
    expect(items[0].querySelector('.workload__swatch--on-track')).not.toBeNull();
    expect(items[1].querySelector('.workload__swatch--at-risk')).not.toBeNull();
    expect(items[2].querySelector('.workload__swatch--breached')).not.toBeNull();
  });

  it('renders the Arabic department name and keeps the source order in Arabic', async () => {
    await render(ROWS, 'ar');

    const names = all(fixture, '.workload__department').map((node) => node.textContent?.trim());
    expect(names).toEqual(['الأحوال المدنية', 'التجارة والصناعة']);
  });

  it('renders nothing to mislead anyone when there is no workload', async () => {
    await render([]);

    expect(maybeEl(fixture, '.workload__bar')).toBeNull();
    expect(all(fixture, '.workload__table tbody tr').length).toBe(0);
  });
});
