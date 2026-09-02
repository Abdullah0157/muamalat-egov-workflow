import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BottleneckRow } from '../../core/data/metrics';
import { all, el } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { BottleneckList } from './bottleneck-list';

const HOUR = 3_600_000;

/** Deliberately out of order, so the ranking is proved rather than inherited. */
const ROWS: readonly BottleneckRow[] = [
  {
    stateKey: 'documentCheck',
    name: { en: 'Document check', ar: 'فحص المستندات' },
    averageMs: 12 * HOUR,
    caseCount: 9,
  },
  {
    stateKey: 'technicalReview',
    name: { en: 'Technical review', ar: 'المراجعة الفنية' },
    averageMs: 48 * HOUR,
    caseCount: 4,
  },
  {
    stateKey: 'supervisorApproval',
    name: { en: 'Supervisor approval', ar: 'اعتماد المشرف' },
    averageMs: 0,
    caseCount: 2,
  },
];

describe('BottleneckList', () => {
  let fixture: ComponentFixture<BottleneckList>;

  async function render(rows: readonly BottleneckRow[], language: 'en' | 'ar' = 'en') {
    await TestBed.configureTestingModule({
      imports: [BottleneckList],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n(language);
    fixture = TestBed.createComponent(BottleneckList);
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('ranks the slowest state first whatever order it arrived in', async () => {
    await render(ROWS);

    expect(all(fixture, '.bottleneck__state').map((cell) => cell.textContent?.trim())).toEqual([
      'Technical review',
      'Document check',
      'Supervisor approval',
    ]);
  });

  it('sizes each bar against the slowest state in the set', async () => {
    await render(ROWS);

    const bars = all<HTMLElement>(fixture, '.bottleneck__bar');
    // Two of three rows have a wait; the third is zero and draws no bar at all.
    expect(bars.length).toBe(2);
    expect(bars[0].style.inlineSize).toBe('100%');
    expect(bars[1].style.inlineSize).toBe('25%');
  });

  it('prints the average wait and the case count exactly as they arrived', async () => {
    await render(ROWS);

    expect(all(fixture, '.bottleneck__value').map((cell) => cell.textContent?.trim())).toEqual([
      '2 d 0 h',
      '12 h 0 min',
      '0 min',
    ]);
    expect(all(fixture, '.bottleneck__numeric.u-numeric').map((cell) => cell.textContent?.trim()))
      .toEqual(['4', '9', '2']);
  });

  it('is a real table, so the averages are navigable as a column', async () => {
    await render(ROWS);

    expect(el(fixture, 'table').tagName).toBe('TABLE');
    expect(el(fixture, 'caption').textContent?.trim()).toBe('Where cases wait longest');
    expect(all(fixture, 'thead th').every((header) => header.getAttribute('scope') === 'col'))
      .toBeTrue();
    expect(all(fixture, 'tbody th').every((header) => header.getAttribute('scope') === 'row'))
      .toBeTrue();
  });

  it('keeps the scrolling wrapper reachable from the keyboard and named', async () => {
    await render(ROWS);

    const scroller = el(fixture, '.bottleneck__scroll');
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(scroller.getAttribute('aria-label')).toBe('Where cases wait longest');
  });

  it('renders the Arabic state names when the language is Arabic', async () => {
    await render(ROWS, 'ar');

    expect(all(fixture, '.bottleneck__state')[0].textContent?.trim()).toBe('المراجعة الفنية');
  });
});
