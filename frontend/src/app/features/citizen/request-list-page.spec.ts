import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { USER_IDS } from '../../core/auth/demo-users';
import { DataGateway, ServiceUnavailableError } from '../../core/data/data-gateway';
import { ServiceRequest } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { StubGateway, makeRequest } from './citizen.testing';
import { RequestListPage } from './request-list-page';

/** Overridable per spec, so each test decides what the gateway does. */
class ListGateway extends StubGateway {
  rows: readonly ServiceRequest[] = [];
  calls = 0;
  failOnce = false;

  override async listRequestsForApplicant(): Promise<readonly ServiceRequest[]> {
    this.calls += 1;
    if (this.failOnce) {
      this.failOnce = false;
      throw new ServiceUnavailableError();
    }
    return this.rows;
  }
}

const OPEN = makeRequest();
const CLOSED = makeRequest({
  id: 'req-ca-2026-00002',
  reference: 'CA-2026-00002',
  currentStateKey: 'completed',
  status: 'completed',
  closedAt: '2026-08-21T08:00:00.000Z',
});

describe('RequestListPage', () => {
  let gateway: ListGateway;
  let fixture: ComponentFixture<RequestListPage>;

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(RequestListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    gateway = new ListGateway();
    await TestBed.configureTestingModule({
      imports: [RequestListPage],
      providers: [
        ...testProviders(),
        provideRouter([]),
        { provide: DataGateway, useValue: gateway },
      ],
    }).compileComponents();
    await setupI18n();
    TestBed.inject(AuthService).signIn(USER_IDS.citizen);
  });

  afterEach(() => {
    TestBed.inject(AuthService).signOut();
  });

  it('renders the heading and a way to file a new request', async () => {
    gateway.rows = [OPEN];
    await render();

    expect(text(fixture, '.page-header__title')).toBe('My requests');
    expect(text(fixture, '.page-header__actions app-button')).toContain('New request');
  });

  it('lists the applicant requests with their reference and status', async () => {
    gateway.rows = [OPEN, CLOSED];
    await render();

    const references = all(fixture, '.u-reference').map((node) => node.textContent?.trim());
    expect(references).toContain('CA-2026-00001');
    expect(all(fixture, 'app-badge').length).toBeGreaterThan(0);
  });

  it('splits open from closed and puts the counts on the tabs', async () => {
    gateway.rows = [OPEN, CLOSED];
    await render();

    const tabs = all(fixture, '[role="tab"]');
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toContain('Open');
    expect(tabs[0].textContent).toContain('1');
    expect(tabs[1].textContent).toContain('Closed');
    expect(tabs[1].textContent).toContain('1');
    expect(tabs[2].textContent).toContain('2');
  });

  it('shows skeleton rows while the list is loading', async () => {
    let release!: (rows: readonly ServiceRequest[]) => void;
    gateway.listRequestsForApplicant = () =>
      new Promise<readonly ServiceRequest[]>((resolve) => {
        release = resolve;
      });

    fixture = TestBed.createComponent(RequestListPage);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(all(fixture, '.data-table__skeleton').length).toBeGreaterThan(0);

    release([]);
    await fixture.whenStable();
  });

  it('explains a failed load and retries through the gateway', async () => {
    gateway.failOnce = true;
    await render();

    expect(text(fixture, 'app-error-state .error-state__title')).toBe(
      'Requests could not be loaded',
    );
    expect(gateway.calls).toBe(1);

    el<HTMLButtonElement>(fixture, 'app-error-state app-button button').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.calls).toBe(2);
    expect(maybeEl(fixture, 'app-error-state')).toBeNull();
  });

  it('distinguishes having nothing from matching nothing', async () => {
    gateway.rows = [];
    await render();

    expect(text(fixture, 'app-empty-state .empty-state__title')).toBe(
      'You have not submitted any requests',
    );
    // No tabs at all: there is nothing to filter.
    expect(all(fixture, '[role="tab"]').length).toBe(0);
  });

  it('uses the filtered empty copy inside a tab that has no rows', async () => {
    gateway.rows = [OPEN];
    await render();

    const tabs = all<HTMLButtonElement>(fixture, '[role="tab"]');
    tabs[1].click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, 'app-empty-state .empty-state__title')).toBe(
      'No requests match these filters',
    );
  });

  it('names the table and the tab strip for assistive technology', async () => {
    gateway.rows = [OPEN];
    await render();

    expect(text(fixture, 'caption')).toContain('Your requests');
    expect(el(fixture, '[role="tablist"]').getAttribute('aria-label')).toBe('Your requests');
    expect(el(fixture, '[role="tab"]').getAttribute('aria-selected')).toBe('true');
  });

  it('links each row to the request rather than relying on a click handler', async () => {
    gateway.rows = [OPEN];
    await render();

    const link = el<HTMLAnchorElement>(fixture, '.data-table__link');
    expect(link.getAttribute('href')).toBe('/citizen/CA-2026-00001');
  });

  it('reads right to left in Arabic without changing structure', async () => {
    gateway.rows = [OPEN];
    await setupI18n('ar');
    await render();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    // The reference stays isolated so it does not reorder inside Arabic text.
    expect(all(fixture, '.u-reference').length).toBeGreaterThan(0);
    expect(all(fixture, '[role="tab"]').length).toBe(3);
  });
});
