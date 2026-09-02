import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { USER_IDS } from '../../core/auth/demo-users';
import { DataGateway, ServiceUnavailableError, TransitionInput } from '../../core/data/data-gateway';
import { ServiceRequest } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { StubGateway, makeRequest } from './citizen.testing';
import { RequestDetailPage } from './request-detail-page';

class DetailGateway extends StubGateway {
  record: ServiceRequest | null = makeRequest();
  calls = 0;
  failOnce = false;
  transitions: TransitionInput[] = [];

  override async getRequest(): Promise<ServiceRequest | null> {
    this.calls += 1;
    if (this.failOnce) {
      this.failOnce = false;
      throw new ServiceUnavailableError();
    }
    return this.record;
  }

  override async applyTransition(input: TransitionInput): Promise<ServiceRequest> {
    this.transitions.push(input);
    const moved = makeRequest({ currentStateKey: 'documentCheck', status: 'inReview' });
    this.record = moved;
    return moved;
  }
}

const AWAITING_APPLICANT = makeRequest({
  currentStateKey: 'moreInfo',
  status: 'moreInfo',
  documents: [
    {
      id: 'doc-2',
      requirementId: 'passport-copy',
      fileName: 'passport.pdf',
      sizeKb: 2048,
      mimeType: 'application/pdf',
      uploadedAt: '2026-08-20T08:00:00.000Z',
      verification: 'rejected',
      note: 'The photograph page is not legible.',
    },
  ],
});

describe('RequestDetailPage', () => {
  let gateway: DetailGateway;
  let fixture: ComponentFixture<RequestDetailPage>;

  async function render(reference = 'CA-2026-00001'): Promise<void> {
    fixture = TestBed.createComponent(RequestDetailPage);
    fixture.componentRef.setInput('reference', reference);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    gateway = new DetailGateway();
    await TestBed.configureTestingModule({
      imports: [RequestDetailPage],
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

  it('heads the page with the reference and the date it was filed', async () => {
    await render();

    expect(text(fixture, '.page-header__title')).toBe('Request CA-2026-00001');
    expect(text(fixture, '.page-header__description')).toContain('Filed');
    expect(all(fixture, '.breadcrumbs__crumb')[0].textContent?.trim()).toBe('My requests');
  });

  it('carries status, priority and service level as chips, never colour alone', async () => {
    await render();

    const chips = all(fixture, '.detail__chips app-badge');
    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toContain('In review');
    expect(chips[1].textContent).toContain('Normal');
    // Each chip pairs its word with a glyph.
    chips.forEach((chip) => expect(chip.querySelector('app-icon')).not.toBeNull());
  });

  it('shows where the file has reached on the progress tracker', async () => {
    await render();

    const steps = all(fixture, '.progress__step');
    expect(steps.length).toBe(4);
    expect(text(fixture, '.progress__step--current .progress__label')).toBe('Review');
  });

  it('reads the submitted answers back under their catalogue labels', async () => {
    await render();

    const details = text(fixture, '.detail__main app-card:nth-of-type(2)');
    expect(details).toContain('Reason for replacement');
    expect(details).toContain('Lost');
    expect(details).toContain('Salmiya, block 4, street 1');
    expect(details).toContain('Mobile number for updates');
  });

  it('lists each attachment with its verification state and size', async () => {
    await render();

    expect(text(fixture, '.detail__document-name')).toBe('police-report.pdf');
    expect(text(fixture, '.detail__document-meta')).toContain('Police report');
    expect(text(fixture, '.detail__document-meta')).toContain('420 KB');
    expect(text(fixture, '.detail__document app-badge')).toContain('Verified');
  });

  it('shows the reason a document was rejected', async () => {
    gateway.record = AWAITING_APPLICANT;
    await render();

    expect(text(fixture, '.detail__document-note')).toContain('The photograph page is not legible.');
  });

  it('prints the deadline in both calendars, each labelled', async () => {
    await render();

    const calendars = all(fixture, '.detail__calendar');
    expect(calendars.length).toBe(2);
    expect(calendars[0].querySelector('dt')?.textContent?.trim()).toBe('Gregorian');
    expect(calendars[1].querySelector('dt')?.textContent?.trim()).toBe('Hijri');
    expect(calendars[0].querySelector('dd')?.textContent?.trim()).toContain('2026');
    expect(calendars[1].querySelector('dd')?.textContent?.trim()).not.toBe('');
  });

  it('renders the activity history newest first', async () => {
    await render();

    const entries = all(fixture, '.timeline__item');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].textContent).toContain('Request submitted');
  });

  it('shows a skeleton while the record is being read', async () => {
    let release!: (record: ServiceRequest | null) => void;
    gateway.getRequest = () =>
      new Promise<ServiceRequest | null>((resolve) => {
        release = resolve;
      });

    fixture = TestBed.createComponent(RequestDetailPage);
    fixture.componentRef.setInput('reference', 'CA-2026-00001');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(all(fixture, 'app-skeleton').length).toBeGreaterThan(0);

    release(null);
    await fixture.whenStable();
  });

  it('separates a missing request from a failed read', async () => {
    gateway.record = null;
    await render('CA-2026-99999');

    expect(text(fixture, '.error-state__title')).toBe('Request not found');
    expect(text(fixture, '.error-state__description')).toContain('CA-2026-99999');
    // Retrying a reference that does not exist would just fail again.
    expect(maybeEl(fixture, '.error-state__actions app-button[icon="refresh"]')).toBeNull();
  });

  it('offers a retry when the read itself failed', async () => {
    gateway.failOnce = true;
    await render();

    expect(text(fixture, '.error-state__title')).toBe('This request could not be opened');
    expect(gateway.calls).toBe(1);

    el<HTMLButtonElement>(fixture, '.error-state__actions app-button button').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.calls).toBe(2);
    expect(maybeEl(fixture, 'app-error-state')).toBeNull();
  });

  it('asks for the missing information when the file is back with the applicant', async () => {
    gateway.record = AWAITING_APPLICANT;
    await render();

    expect(text(fixture, 'app-alert .alert__heading')).toBe('Action needed from you');
    expect(text(fixture, 'app-alert .alert__body')).toContain('asked for more information');
    expect(maybeEl(fixture, '.detail__response')).not.toBeNull();
    // The tracker says the case is waiting rather than moving.
    expect(all(fixture, '.progress__step--blocked').length).toBe(1);
  });

  it('will not send an empty response', async () => {
    gateway.record = AWAITING_APPLICANT;
    await render();

    el<HTMLButtonElement>(fixture, '.detail__response-actions button').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(gateway.transitions.length).toBe(0);
    expect(text(fixture, '.detail__response .field__error')).toContain('is required');
  });

  it('applies the information provided transition and re-reads the record', async () => {
    gateway.record = AWAITING_APPLICANT;
    await render();

    const textarea = el<HTMLTextAreaElement>(fixture, '.detail__response textarea');
    textarea.value = 'A clearer copy of the passport page is attached.';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const file = el<HTMLInputElement>(fixture, '.detail__file-input');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'passport-clear.pdf', { type: 'application/pdf' }));
    file.files = transfer.files;
    file.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, '.detail__file-name')).toBe('passport-clear.pdf');

    el<HTMLButtonElement>(fixture, '.detail__response-actions button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.transitions.length).toBe(1);
    expect(gateway.transitions[0].transitionKey).toBe('informationProvided');
    expect(gateway.transitions[0].comment).toContain('clearer copy');
    // The file could not be transmitted, so it is recorded by name instead.
    expect(gateway.transitions[0].comment).toContain('passport-clear.pdf');
    expect(gateway.transitions[0].internalComment).toBeFalse();
    // The record was re-read, and the case has moved off the applicant.
    expect(gateway.calls).toBe(2);
    expect(maybeEl(fixture, '.detail__response')).toBeNull();
  });

  it('reads right to left in Arabic while keeping the reference isolated', async () => {
    await setupI18n('ar');
    await render();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(text(fixture, '.detail__summary .u-reference')).toBe('CA-2026-00001');
    expect(all(fixture, '.detail__calendar').length).toBe(2);
  });
});
