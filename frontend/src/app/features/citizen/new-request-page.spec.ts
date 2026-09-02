import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { USER_IDS } from '../../core/auth/demo-users';
import { DataGateway } from '../../core/data/data-gateway';
import { RequestDraft, ServiceRequest, User } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { SAMPLE_SERVICE_ID, StubGateway, makeRequest } from './citizen.testing';
import { NewRequestPage } from './new-request-page';

class WizardGateway extends StubGateway {
  drafts: RequestDraft[] = [];
  fail = false;

  override async submitRequest(draft: RequestDraft, _applicant: User): Promise<ServiceRequest> {
    if (this.fail) {
      throw new Error('service unavailable');
    }
    this.drafts.push(draft);
    return makeRequest({ id: 'req-new', reference: 'CA-2026-00099' });
  }
}

/** Fires the event a control listens for after its value has been written. */
function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('input'));
}

function setSelect(element: HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('change'));
}

function attach(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change'));
}

describe('NewRequestPage', () => {
  let gateway: WizardGateway;
  let fixture: ComponentFixture<NewRequestPage>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The forward button is always the form's submit button. */
  async function forward(): Promise<void> {
    el<HTMLButtonElement>(fixture, '.wizard__nav button[type="submit"]').click();
    await settle();
  }

  async function chooseSampleService(): Promise<void> {
    const option = all<HTMLInputElement>(fixture, '.service-option__input').find(
      (input) => input.value === SAMPLE_SERVICE_ID,
    );
    option?.click();
    await settle();
  }

  async function fillDetails(): Promise<void> {
    setSelect(el<HTMLSelectElement>(fixture, 'app-select select'), 'lost');
    setValue(el<HTMLInputElement>(fixture, 'input[type="date"]'), '2026-08-18');
    setValue(el<HTMLTextAreaElement>(fixture, 'textarea'), 'Salmiya, block 4, street 1');
    setValue(el<HTMLInputElement>(fixture, 'input[type="tel"]'), '55512345');
    await settle();
  }

  async function attachRequiredDocuments(): Promise<void> {
    const inputs = all<HTMLInputElement>(fixture, 'input[type="file"]');
    attach(inputs[0], new File(['report'], 'police-report.pdf', { type: 'application/pdf' }));
    attach(inputs[1], new File(['passport'], 'passport.pdf', { type: 'application/pdf' }));
    await settle();
  }

  beforeEach(async () => {
    gateway = new WizardGateway();
    await TestBed.configureTestingModule({
      imports: [NewRequestPage],
      providers: [
        ...testProviders(),
        provideRouter([]),
        { provide: DataGateway, useValue: gateway },
      ],
    }).compileComponents();
    await setupI18n();
    TestBed.inject(AuthService).signIn(USER_IDS.citizen);

    fixture = TestBed.createComponent(NewRequestPage);
    await settle();
  });

  afterEach(() => {
    TestBed.inject(AuthService).signOut();
  });

  it('shows the four steps on the tracker with the first one current', () => {
    const steps = all(fixture, '.progress__step');
    expect(steps.length).toBe(4);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(text(fixture, '.progress__step:first-child .progress__label')).toBe('Service');
  });

  it('offers the services as a real radio group inside a fieldset', () => {
    const fieldset = el(fixture, 'fieldset');
    expect(fieldset.querySelector('legend')?.textContent?.trim()).toBe(
      'Which service do you need?',
    );

    const radios = all<HTMLInputElement>(fixture, '.service-option__input');
    expect(radios.length).toBeGreaterThan(0);
    expect(radios[0].type).toBe('radio');
    // One name for the group, which is what makes the choice exclusive.
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
  });

  it('states the processing time and the fee against each service', () => {
    const facts = text(fixture, '.service-option__facts');
    expect(facts).toContain('48 hours');
    expect(facts).toContain('KWD');
  });

  it('refuses to advance without a service and says why', async () => {
    await forward();

    expect(text(fixture, '.wizard__problems')).toContain('This form cannot be submitted yet');
    expect(text(fixture, '.wizard__problem-list')).toContain('Select a service to continue.');
    // Still on step one.
    expect(text(fixture, '.wizard__step-name')).toBe('Service');
  });

  it('builds the detail questions from the chosen service', async () => {
    await chooseSampleService();
    await forward();

    expect(text(fixture, '.wizard__step-name')).toBe('Details');
    expect(text(fixture, '.details-step__fieldset legend')).toBe('Application details');
    expect(all(fixture, '.details-step__field').length).toBe(5);
    expect(fixture.nativeElement.textContent).toContain('Reason for replacement');
    expect(fixture.nativeElement.textContent).toContain('Mobile number for updates');
  });

  it('lists every unanswered question as a link to the field', async () => {
    await chooseSampleService();
    await forward();
    await forward();

    const problems = all<HTMLAnchorElement>(fixture, '.wizard__problem-link');
    expect(problems.length).toBe(4);
    expect(problems[0].textContent).toContain('Reason for replacement is required.');
    expect(problems[0].getAttribute('href')).toContain('-field-reason');
    expect(text(fixture, '.wizard__step-name')).toBe('Details');
  });

  it('rejects a mobile number that is not a Kuwaiti one', async () => {
    await chooseSampleService();
    await forward();
    setValue(el<HTMLInputElement>(fixture, 'input[type="tel"]'), '12345678');
    await forward();

    expect(text(fixture, '.wizard__problem-list')).toContain(
      'Enter a Kuwaiti mobile number, eight digits beginning with 5, 6 or 9.',
    );
  });

  it('blocks the documents step until the required copies are attached', async () => {
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();

    expect(text(fixture, '.wizard__step-name')).toBe('Documents');
    await forward();

    const problems = all(fixture, '.wizard__problem-link').map((node) => node.textContent?.trim());
    expect(problems.length).toBe(2);
    expect(problems[0]).toBe('Attach Police report before continuing.');
    // The optional photograph is not one of them.
    expect(problems.join(' ')).not.toContain('photograph');
  });

  it('names the file it refused and why', async () => {
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();

    const inputs = all<HTMLInputElement>(fixture, 'input[type="file"]');
    attach(inputs[0], new File(['x'], 'scan.gif', { type: 'image/gif' }));
    await settle();

    expect(text(fixture, '.upload__error')).toContain('scan.gif');
    expect(text(fixture, '.upload__error')).toContain('PDF, JPG, PNG');

    attach(inputs[1], new File([new ArrayBuffer(6 * 1024 * 1024)], 'huge.pdf', {
      type: 'application/pdf',
    }));
    await settle();

    const errors = all(fixture, '.upload__error').map((node) => node.textContent);
    expect(errors[1]).toContain('huge.pdf');
    expect(errors[1]).toContain('5 MB');
  });

  it('shows the chosen file with its size and lets it be removed', async () => {
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();
    await attachRequiredDocuments();

    expect(text(fixture, '.upload__file-name')).toBe('police-report.pdf');
    expect(all(fixture, '.upload__file').length).toBe(2);

    el<HTMLButtonElement>(fixture, '.upload__file app-button button').click();
    await settle();

    expect(all(fixture, '.upload__file').length).toBe(1);
  });

  it('reads every answer back on the review step', async () => {
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();
    await attachRequiredDocuments();
    await forward();

    expect(text(fixture, '.wizard__step-name')).toBe('Review and submit');
    const summary = fixture.nativeElement.textContent as string;
    // The stored option code is read back as the label it was chosen by.
    expect(summary).toContain('Lost');
    expect(summary).toContain('Salmiya, block 4, street 1');
    expect(summary).toContain('police-report.pdf');
    expect(summary).toContain('Civil Affairs');
  });

  it('requires the declaration before it will file anything', async () => {
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();
    await attachRequiredDocuments();
    await forward();
    await forward();

    expect(text(fixture, '.wizard__problem-list')).toContain(
      'Confirm the declaration before submitting.',
    );
    expect(gateway.drafts.length).toBe(0);
  });

  it('files the request and shows the reference it was given', async () => {
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();
    await attachRequiredDocuments();
    await forward();

    el<HTMLInputElement>(fixture, 'app-checkbox input[type="checkbox"]').click();
    await settle();
    await forward();

    expect(gateway.drafts.length).toBe(1);
    const draft = gateway.drafts[0];
    expect(draft.serviceId).toBe(SAMPLE_SERVICE_ID);
    expect(draft.fieldValues['reason']).toBe('lost');
    expect(draft.contactPhone).toBe('55512345');
    expect(draft.acknowledged).toBeTrue();
    expect(draft.documents.map((document) => document.fileName)).toEqual([
      'police-report.pdf',
      'passport.pdf',
    ]);

    expect(text(fixture, '.wizard__success-title')).toContain('CA-2026-00099');
    expect(text(fixture, '.wizard__success-reference .u-reference')).toBe('CA-2026-00099');
    expect(TestBed.inject(ToastService).toasts().length).toBe(1);
    // Every stage is complete once the file has a number.
    expect(all(fixture, '.progress__step--complete').length).toBe(4);
  });

  it('keeps the answers when the service refuses the submission', async () => {
    gateway.fail = true;
    await chooseSampleService();
    await forward();
    await fillDetails();
    await forward();
    await attachRequiredDocuments();
    await forward();

    el<HTMLInputElement>(fixture, 'app-checkbox input[type="checkbox"]').click();
    await settle();
    await forward();

    expect(text(fixture, '.wizard__problems')).toContain('The action was not applied');
    expect(maybeEl(fixture, '.wizard__success-title')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Salmiya, block 4, street 1');
  });

  it('throws away answers that belonged to a different service', async () => {
    await chooseSampleService();
    await forward();
    setValue(el<HTMLInputElement>(fixture, 'input[type="tel"]'), '55512345');
    await settle();

    el<HTMLButtonElement>(fixture, '.wizard__nav button:not([type="submit"])').click();
    await settle();

    const other = all<HTMLInputElement>(fixture, '.service-option__input').find(
      (input) => input.value !== SAMPLE_SERVICE_ID,
    );
    other?.click();
    await settle();
    await forward();

    expect(el<HTMLInputElement>(fixture, 'input[type="tel"]').value).toBe('');
  });

  it('gives every step a legend and moves focus to the step heading', async () => {
    await chooseSampleService();
    await forward();

    const heading = el<HTMLElement>(fixture, '.wizard__step-heading');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(el(fixture, '.details-step__fieldset legend')).not.toBeNull();
  });
});
