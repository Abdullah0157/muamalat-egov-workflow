import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DataGateway, ServiceUnavailableError } from '../../core/data/data-gateway';
import { DashboardMetrics, DashboardPeriod, EscalationRow } from '../../core/data/metrics';
import { ServiceRequest } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { DashboardPage } from './dashboard-page';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The instant the fixture's figures were calculated at. */
const AS_OF = '2026-09-01T09:00:00.000Z';

/**
 * One open case, two days past its deadline against `AS_OF`. The identifiers are
 * real catalogue entries, so the service, department and workflow state the
 * screen prints are the ones a supervisor would actually see.
 */
const BREACHED_CASE: ServiceRequest = {
  id: 'req-breached',
  reference: 'REQ-2026-000123',
  serviceId: 'svc-civil-id-replacement',
  departmentId: 'dep-civil-affairs',
  applicantId: 'usr-citizen-1',
  applicantName: { en: 'Fatima Al Ali', ar: 'فاطمة العلي' },
  workflowKey: 'standard-approval',
  workflowVersion: 1,
  currentStateKey: 'technicalReview',
  status: 'inReview',
  priority: 'high',
  createdAt: '2026-08-20T08:00:00.000Z',
  submittedAt: '2026-08-20T09:00:00.000Z',
  dueAt: '2026-08-30T09:00:00.000Z',
  closedAt: null,
  assigneeId: null,
  fieldValues: {},
  documents: [],
  history: [],
  comments: [],
};

const ESCALATION: EscalationRow = {
  requestId: 'req-escalated',
  reference: 'REQ-2026-000456',
  serviceName: { en: 'Issue a commercial licence', ar: 'إصدار رخصة تجارية' },
  departmentName: { en: 'Commerce and Industry', ar: 'التجارة والصناعة' },
  raisedAt: '2026-08-28T09:00:00.000Z',
  ageMs: 4 * DAY,
};

/**
 * A hand built metrics object. Every assertion in this file compares what is
 * rendered against a figure in here, which is the only way to prove the screen
 * is reporting rather than decorating.
 */
const METRICS: DashboardMetrics = {
  period: 'last30',
  from: '2026-08-02T09:00:00.000Z',
  to: AS_OF,
  totalInPeriod: 20,
  open: 12,
  closed: 8,
  atRisk: 3,
  breached: 2,
  averageProcessingMs: 36 * HOUR,
  onTimeRate: 0.92,
  escalations: 1,
  workload: [
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
  ],
  bottlenecks: [
    {
      stateKey: 'technicalReview',
      name: { en: 'Technical review', ar: 'المراجعة الفنية' },
      averageMs: 48 * HOUR,
      caseCount: 4,
    },
    {
      stateKey: 'documentCheck',
      name: { en: 'Document check', ar: 'فحص المستندات' },
      averageMs: 12 * HOUR,
      caseCount: 9,
    },
  ],
  throughput: [
    { weekStart: '2026-08-02T00:00:00.000Z', submitted: 8, closed: 6 },
    { weekStart: '2026-08-09T00:00:00.000Z', submitted: 4, closed: 0 },
  ],
  escalatedCases: [ESCALATION],
  attentionCases: [BREACHED_CASE],
};

const EMPTY_METRICS: DashboardMetrics = {
  ...METRICS,
  totalInPeriod: 0,
  open: 0,
  closed: 0,
  atRisk: 0,
  breached: 0,
  averageProcessingMs: null,
  onTimeRate: null,
  escalations: 0,
  workload: [],
  bottlenecks: [],
  throughput: [],
  escalatedCases: [],
  attentionCases: [],
};

function unused(): never {
  throw new Error('The dashboard does not call this gateway method.');
}

/**
 * Only `getDashboard` is implemented. Everything else is declared to return
 * `Promise<never>`, which satisfies the abstract signatures without dragging a
 * dozen domain types into a spec that never uses them.
 */
class FakeGateway extends DataGateway {
  metrics: DashboardMetrics = METRICS;
  failNext = false;
  readonly calls: DashboardPeriod[] = [];

  async getDashboard(period: DashboardPeriod): Promise<DashboardMetrics> {
    this.calls.push(period);
    if (this.failNext) {
      // One shot, so the retry button in the error state genuinely recovers.
      this.failNext = false;
      throw new ServiceUnavailableError();
    }
    return this.metrics;
  }

  listDepartments(): Promise<never> {
    return unused();
  }
  listServices(): Promise<never> {
    return unused();
  }
  getService(): Promise<never> {
    return unused();
  }
  listRequestsForApplicant(): Promise<never> {
    return unused();
  }
  listQueue(): Promise<never> {
    return unused();
  }
  getRequest(): Promise<never> {
    return unused();
  }
  submitRequest(): Promise<never> {
    return unused();
  }
  applyTransition(): Promise<never> {
    return unused();
  }
  addComment(): Promise<never> {
    return unused();
  }
  setDocumentVerification(): Promise<never> {
    return unused();
  }
  assignRequest(): Promise<never> {
    return unused();
  }
  listWorkflows(): Promise<never> {
    return unused();
  }
  getWorkflow(): Promise<never> {
    return unused();
  }
  saveWorkflowVersion(): Promise<never> {
    return unused();
  }
  countRunningCases(): Promise<never> {
    return unused();
  }
}

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let gateway: FakeGateway;

  async function configure(language: 'en' | 'ar' = 'en'): Promise<void> {
    // A few specs render twice to compare two sets of figures, so the module is
    // torn down first rather than being configured on top of a live one.
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [...testProviders(), provideRouter([]), { provide: DataGateway, useClass: FakeGateway }],
    }).compileComponents();
    await setupI18n(language);
    gateway = TestBed.inject(DataGateway) as FakeGateway;
    fixture = TestBed.createComponent(DashboardPage);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Configure, load and settle in one step, for the tests about the happy path. */
  async function render(
    metrics: DashboardMetrics = METRICS,
    language: 'en' | 'ar' = 'en',
  ): Promise<void> {
    await configure(language);
    gateway.metrics = metrics;
    await settle();
  }

  afterEach(() => TestBed.resetTestingModule());

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  it('shows a skeleton in the shape of the dashboard while the figures load', async () => {
    await configure();

    // Two synchronous passes: enough to start the load and render, not enough
    // for the loader's promise to have settled.
    fixture.detectChanges();
    fixture.detectChanges();

    expect(all(fixture, '.dashboard__skeleton-tile').length).toBe(6);
    expect(all(fixture, '.dashboard__skeleton-chart').length).toBe(2);
    expect(maybeEl(fixture, 'app-skeleton-table')).not.toBeNull();
    expect(maybeEl(fixture, 'app-stat-tile')).toBeNull();

    await fixture.whenStable();
  });

  it('names what failed and recovers when the retry is pressed', async () => {
    await configure();
    gateway.failNext = true;
    await settle();

    expect(text(fixture, '.error-state__title')).toBe('Dashboard figures could not be calculated');
    expect(maybeEl(fixture, 'app-stat-tile')).toBeNull();
    expect(gateway.calls.length).toBe(1);

    el<HTMLButtonElement>(fixture, 'app-error-state button').click();
    await settle();

    expect(gateway.calls.length).toBe(2);
    expect(maybeEl(fixture, 'app-error-state')).toBeNull();
    expect(all(fixture, 'app-stat-tile').length).toBe(6);
  });

  it('says there is nothing to report rather than drawing empty charts', async () => {
    await render(EMPTY_METRICS);

    expect(text(fixture, '.empty-state__title')).toBe('No data for this period');
    expect(maybeEl(fixture, 'app-workload-chart')).toBeNull();
    expect(maybeEl(fixture, 'app-throughput-chart')).toBeNull();
    // The tiles stay: a real zero is still a figure worth reporting.
    expect(all(fixture, 'app-stat-tile').length).toBe(6);
  });

  // ---------------------------------------------------------------------------
  // Headline figures
  // ---------------------------------------------------------------------------

  it('prints every headline figure exactly as the metrics reported it', async () => {
    await render();

    expect(all(fixture, '.stat-tile__number').map((node) => node.textContent?.trim())).toEqual([
      '12',
      '3',
      '2',
      '1 d 12 h',
      '92%',
      '1',
    ]);
  });

  it('explains every figure, so no number on the screen is undefined', async () => {
    await render();

    const hints = all(fixture, '.stat-tile__hint').map((node) => node.textContent?.trim());
    expect(hints.length).toBe(6);
    expect(hints[0]).toBe('Cases that are not yet closed.');
    expect(hints[4]).toBe('Share of closed cases that finished inside the processing window.');
  });

  it('says "not available" rather than zero when nothing closed in the period', async () => {
    await render({ ...METRICS, averageProcessingMs: null, onTimeRate: null });

    const values = all(fixture, '.stat-tile__number').map((node) => node.textContent?.trim());
    expect(values[3]).toBe('Not available');
    expect(values[4]).toBe('Not available');
    expect(values[3]).not.toBe('0');

    const tiles = all(fixture, 'app-stat-tile');
    expect(tiles[4].classList).toContain('stat-tile--neutral');
  });

  it('tones the breach tile by whether there are any breaches', async () => {
    await render();
    expect(all(fixture, 'app-stat-tile')[2].classList).toContain('stat-tile--danger');

    await render({ ...METRICS, breached: 0 });
    const tiles = all(fixture, 'app-stat-tile');
    expect(tiles[2].classList).toContain('stat-tile--success');
    expect(all(fixture, '.stat-tile__number')[2].textContent?.trim()).toBe('0');
  });

  it('tones the on time rate against the published thresholds', async () => {
    await render({ ...METRICS, onTimeRate: 0.8 });
    expect(all(fixture, 'app-stat-tile')[4].classList).toContain('stat-tile--warning');

    await render({ ...METRICS, onTimeRate: 0.5 });
    expect(all(fixture, 'app-stat-tile')[4].classList).toContain('stat-tile--danger');
  });

  it('carries the note that says where the figures came from', async () => {
    await render();

    expect(text(fixture, '.dashboard__note')).toBe(
      'All figures are calculated from the records in the selected period.',
    );
  });

  // ---------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------

  it('draws the workload bars at the widths the workload figures imply', async () => {
    await render();

    const widths = all<HTMLElement>(fixture, '.workload__segment').map(
      (segment) => segment.style.inlineSize,
    );
    // Civil Affairs 4/3/1 against a maximum of 8, then Commerce 4 with nothing
    // at risk and nothing breached, so only three plus one segments exist.
    expect(widths).toEqual(['50%', '37.5%', '12.5%', '50%']);
  });

  it('gives the workload chart an accessible table carrying the same numbers', async () => {
    await render();

    const rows = all(fixture, '.workload__table tbody tr');
    expect(
      Array.from(rows[0].querySelectorAll('th, td')).map((cell) => cell.textContent?.trim()),
    ).toEqual(['Civil Affairs', '8', '4', '3', '1']);
    expect(
      Array.from(rows[1].querySelectorAll('th, td')).map((cell) => cell.textContent?.trim()),
    ).toEqual(['Commerce and Industry', '4', '4', '0', '0']);

    expect(el(fixture, '.workload__plot').getAttribute('aria-describedby')).toBe(
      el(fixture, '.workload__table').id,
    );
  });

  it('ranks the bottlenecks and prints their averages and counts', async () => {
    await render();

    expect(all(fixture, '.bottleneck__state').map((cell) => cell.textContent?.trim())).toEqual([
      'Technical review',
      'Document check',
    ]);
    expect(all(fixture, '.bottleneck__value').map((cell) => cell.textContent?.trim())).toEqual([
      '2 d 0 h',
      '12 h 0 min',
    ]);
    expect(
      all<HTMLElement>(fixture, '.bottleneck__bar').map((bar) => bar.style.inlineSize),
    ).toEqual(['100%', '25%']);
  });

  it('draws the throughput bars as a share of the busiest week', async () => {
    await render();

    expect(
      all<HTMLElement>(fixture, '.throughput__bar--submitted').map((bar) => bar.style.blockSize),
    ).toEqual(['100%', '50%']);
    // The second week closed nothing, so it draws no bar at all.
    expect(
      all<HTMLElement>(fixture, '.throughput__bar--closed').map((bar) => bar.style.blockSize),
    ).toEqual(['75%']);

    const rows = all(fixture, '.throughput__table tbody tr');
    const second = Array.from(rows[1].querySelectorAll('th, td')).map(
      (cell) => cell.textContent?.trim() ?? '',
    );
    expect(second[0]).toContain('Week of');
    expect(second.slice(1)).toEqual(['4', '0']);
  });

  // ---------------------------------------------------------------------------
  // Tables
  // ---------------------------------------------------------------------------

  it('lists the cases needing attention with a service level counter', async () => {
    await render();

    const table = all(fixture, 'app-data-table')[0];
    const cells = Array.from(table.querySelectorAll('tbody tr th, tbody tr td')).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(cells).toEqual([
      'REQ-2026-000123',
      'Replace a civil ID card',
      'Civil Affairs',
      'Technical review',
      '2 d 0 h overdue',
    ]);
    expect(table.querySelector('.u-reference')?.textContent?.trim()).toBe('REQ-2026-000123');
  });

  it('sends a supervisor to the case file, which is where they can act', async () => {
    await render();

    const link = all(fixture, 'app-data-table')[0].querySelector('a.data-table__link');
    expect(link?.getAttribute('href')).toBe('/officer/REQ-2026-000123');
  });

  it('lists escalations oldest first with the date raised and the age', async () => {
    await render();

    const table = all(fixture, 'app-data-table')[1];
    expect(table.querySelector('.dashboard__age')?.textContent?.trim()).toBe('4 d 0 h');
    expect(table.querySelector('.dashboard__raised')?.textContent?.trim()).toBeTruthy();
    expect(table.textContent).toContain('Issue a commercial licence');
  });

  it('says nothing is breached, and nothing is escalated, when nothing is', async () => {
    await render({ ...METRICS, attentionCases: [], escalatedCases: [] });

    const titles = all(fixture, '.empty-state__title').map((node) => node.textContent?.trim());
    expect(titles).toContain('No breached cases in this period.');
    expect(titles).toContain('No escalations');
  });

  // ---------------------------------------------------------------------------
  // Period control
  // ---------------------------------------------------------------------------

  it('reloads the figures against the period the supervisor chose', async () => {
    await render();
    expect(gateway.calls).toEqual(['last30']);

    all<HTMLInputElement>(fixture, '.dashboard__radio')[1].click();
    await settle();

    expect(gateway.calls).toEqual(['last30', 'last90']);
  });

  it('builds the period control out of real radios in a named group', async () => {
    await render();

    const fieldset = el(fixture, 'fieldset.dashboard__period');
    expect(fieldset.querySelector('legend')?.textContent?.trim()).toBe('Period');

    const radios = all<HTMLInputElement>(fixture, '.dashboard__radio');
    expect(radios.length).toBe(3);
    expect(radios.every((radio) => radio.type === 'radio')).toBeTrue();
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios[0].checked).toBeTrue();
    expect(all(fixture, '.dashboard__segment-face').map((face) => face.textContent?.trim())).toEqual(
      ['Last 30 days', 'Last 90 days', 'All records'],
    );
  });

  // ---------------------------------------------------------------------------
  // Structure and language
  // ---------------------------------------------------------------------------

  it('gives the page one heading and every chart a described equivalent', async () => {
    await render();

    expect(all(fixture, 'h1').length).toBe(1);
    expect(text(fixture, 'h1')).toBe('Oversight dashboard');

    for (const plot of all(fixture, '[role="img"]')) {
      expect(plot.getAttribute('aria-label')).toBe(
        'Chart. The same figures are listed in the table below.',
      );
      const described = plot.getAttribute('aria-describedby');
      expect(described).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${described}`)).not.toBeNull();
    }
  });

  it('renders the whole screen in Arabic, including the domain names', async () => {
    await render(METRICS, 'ar');

    expect(text(fixture, 'h1')).toBe('لوحة الإشراف');
    expect(all(fixture, '.workload__department')[0].textContent?.trim()).toBe('الأحوال المدنية');
    expect(all(fixture, '.bottleneck__state')[0].textContent?.trim()).toBe('المراجعة الفنية');
  });
});
