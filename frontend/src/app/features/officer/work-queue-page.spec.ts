import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DEPARTMENT_IDS, USER_IDS } from '../../core/auth/demo-users';
import {
  DataGateway,
  QueueQuery,
  QueueResult,
  ServiceUnavailableError,
} from '../../core/data/data-gateway';
import { SERVICES } from '../../core/data/service-catalogue';
import { WORKFLOW_KEYS } from '../../core/data/workflow-definitions';
import { ServiceDefinition, ServiceRequest } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { WorkQueuePage } from './work-queue-page';

function notUsed(): Error {
  return new Error('The work queue does not call this gateway method.');
}

/** Only the two reads the queue makes are real; the rest fail loudly. */
class FakeGateway extends DataGateway {
  readonly queries: QueueQuery[] = [];
  result: QueueResult = { rows: [], total: 0 };
  failNext = false;
  neverResolves = false;

  override async listQueue(query: QueueQuery): Promise<QueueResult> {
    this.queries.push(query);
    if (this.neverResolves) {
      return new Promise<QueueResult>(() => undefined);
    }
    if (this.failNext) {
      this.failNext = false;
      throw new ServiceUnavailableError();
    }
    return this.result;
  }

  override async listServices(): Promise<readonly ServiceDefinition[]> {
    return SERVICES;
  }

  override listDepartments(): never {
    throw notUsed();
  }
  override getService(): never {
    throw notUsed();
  }
  override listRequestsForApplicant(): never {
    throw notUsed();
  }
  override getRequest(): never {
    throw notUsed();
  }
  override submitRequest(): never {
    throw notUsed();
  }
  override applyTransition(): never {
    throw notUsed();
  }
  override addComment(): never {
    throw notUsed();
  }
  override setDocumentVerification(): never {
    throw notUsed();
  }
  override assignRequest(): never {
    throw notUsed();
  }
  override listWorkflows(): never {
    throw notUsed();
  }
  override getWorkflow(): never {
    throw notUsed();
  }
  override saveWorkflowVersion(): never {
    throw notUsed();
  }
  override countRunningCases(): never {
    throw notUsed();
  }
  override getDashboard(): never {
    throw notUsed();
  }
}

function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequest {
  const now = Date.now();
  return {
    id: 'req-1',
    reference: 'CA-2026-00042',
    serviceId: 'svc-birth-certificate',
    departmentId: DEPARTMENT_IDS.civilAffairs,
    applicantId: USER_IDS.citizen,
    applicantName: { en: 'Fahad Al Sabah', ar: 'فهد الصباح' },
    workflowKey: WORKFLOW_KEYS.civil,
    workflowVersion: 1,
    currentStateKey: 'documentCheck',
    status: 'inReview',
    priority: 'high',
    createdAt: new Date(now - 7_200_000).toISOString(),
    submittedAt: new Date(now - 7_200_000).toISOString(),
    dueAt: new Date(now + 7_200_000).toISOString(),
    closedAt: null,
    assigneeId: USER_IDS.officer,
    fieldValues: {},
    documents: [],
    history: [],
    comments: [],
    ...overrides,
  };
}

describe('WorkQueuePage', () => {
  let fixture: ComponentFixture<WorkQueuePage>;
  let gateway: FakeGateway;

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(WorkQueuePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Renders with the load still in flight. `whenStable` would wait for the
   * gateway that is deliberately never answering, so the pass is driven by
   * hand instead.
   */
  async function renderWhileLoading(): Promise<void> {
    gateway.neverResolves = true;
    fixture = TestBed.createComponent(WorkQueuePage);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  /** Selects render in the order they are declared: assignment, service, priority, service level. */
  async function chooseInSelect(index: number, value: string): Promise<void> {
    const control = all<HTMLSelectElement>(fixture, 'app-select select')[index];
    control.value = value;
    control.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkQueuePage],
      providers: [
        ...testProviders(),
        provideRouter([]),
        { provide: DataGateway, useClass: FakeGateway },
      ],
    }).compileComponents();

    await setupI18n();
    TestBed.inject(AuthService).signIn(USER_IDS.officer);
    gateway = TestBed.inject(DataGateway) as FakeGateway;
  });

  afterEach(() => {
    // The account is remembered in storage, so it has to be given back or it
    // leaks into every spec that runs after this file.
    TestBed.inject(AuthService).signOut();
  });

  it('shows a table shaped placeholder while the first page loads', async () => {
    await renderWhileLoading();

    expect(maybeEl(fixture, 'app-skeleton-table')).not.toBeNull();
    expect(maybeEl(fixture, 'app-data-table')).toBeNull();
  });

  it('asks the gateway for the signed in officer and department', async () => {
    await render();

    expect(gateway.queries[0].officerId).toBe(USER_IDS.officer);
    expect(gateway.queries[0].departmentId).toBe(DEPARTMENT_IDS.civilAffairs);
    expect(gateway.queries[0].assignment).toBe('mine');
  });

  it('renders the queue with its reference numbers', async () => {
    gateway.result = {
      rows: [makeRequest(), makeRequest({ id: 'req-2', reference: 'CA-2026-00043' })],
      total: 9,
    };
    await render();

    const references = all(fixture, '.u-reference').map((node) => node.textContent?.trim());
    expect(references).toContain('CA-2026-00042');
    expect(references).toContain('CA-2026-00043');
  });

  it('counts the filtered rows against the unfiltered total', async () => {
    gateway.result = { rows: [makeRequest()], total: 9 };
    await render();

    expect(text(fixture, '.queue__summary')).toBe('Showing 1 of 9 cases');
  });

  it('renders the deadline as a chip and a remaining time', async () => {
    gateway.result = { rows: [makeRequest()], total: 1 };
    await render();

    const deadline = el(fixture, '.queue__sla');
    expect(deadline.textContent).toContain('On track');
    expect(text(fixture, '.queue__sla-countdown')).toContain('left');
  });

  it('explains a failed load and retries through the gateway', async () => {
    gateway.failNext = true;
    await render();

    expect(text(fixture, '.error-state__title')).toBe('Requests could not be loaded');
    const before = gateway.queries.length;

    el<HTMLButtonElement>(fixture, 'app-error-state button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.queries.length).toBe(before + 1);
    expect(maybeEl(fixture, 'app-error-state')).toBeNull();
  });

  it('says the queue is clear when nothing is filtered out', async () => {
    await render();

    expect(text(fixture, '.empty-state__title')).toBe('Your queue is clear');
  });

  it('distinguishes an empty queue from one emptied by a filter', async () => {
    await render();
    await chooseInSelect(2, 'urgent');

    expect(gateway.queries[gateway.queries.length - 1].priority).toBe('urgent');
    expect(text(fixture, '.empty-state__title')).toBe('No requests match these filters');
  });

  it('names the search term when a search returns nothing', async () => {
    await render();

    const search = el<HTMLInputElement>(fixture, 'app-text-field input');
    search.value = 'ZZZ-999';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, '.empty-state__description')).toContain('ZZZ-999');
  });

  it('waits for a pause in typing before it refetches', async () => {
    await render();
    const before = gateway.queries.length;

    const search = el<HTMLInputElement>(fixture, 'app-text-field input');
    for (const value of ['C', 'CA', 'CA-']) {
      search.value = value;
      search.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    await fixture.whenStable();

    expect(gateway.queries.length).toBe(before);

    await new Promise((resolve) => setTimeout(resolve, 400));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(gateway.queries.length).toBe(before + 1);
    expect(gateway.queries[gateway.queries.length - 1].search).toBe('CA-');
  });

  it('only offers to clear filters once something is set', async () => {
    await render();

    const clear = el<HTMLButtonElement>(fixture, '.queue__filter--clear button');
    expect(clear.disabled).toBeTrue();

    await chooseInSelect(2, 'urgent');
    expect(el<HTMLButtonElement>(fixture, '.queue__filter--clear button').disabled).toBeFalse();

    el<HTMLButtonElement>(fixture, '.queue__filter--clear button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.queries[gateway.queries.length - 1].priority).toBeNull();
    expect(el<HTMLButtonElement>(fixture, '.queue__filter--clear button').disabled).toBeTrue();
  });

  it('groups the filters under a legend that is announced but not shown', async () => {
    await render();

    const legend = el(fixture, 'fieldset legend');
    expect(legend.textContent?.trim()).toBe('Filter the queue');
    expect(legend.classList).toContain('u-visually-hidden');
  });

  it('names the table for a screen reader and links each row to its case', async () => {
    gateway.result = { rows: [makeRequest()], total: 1 };
    await render();

    expect(text(fixture, 'table caption')).toBe('Cases awaiting action');
    expect(el<HTMLAnchorElement>(fixture, 'tbody a').getAttribute('href')).toBe(
      '/officer/CA-2026-00042',
    );
  });

  it('renders in Arabic when the catalogue is switched', async () => {
    await setupI18n('ar');
    gateway.result = { rows: [makeRequest()], total: 1 };
    await render();

    expect(text(fixture, 'h1')).toBe('قائمة العمل');
    expect(text(fixture, 'table caption')).not.toBe('Cases awaiting action');
  });
});
