import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DEPARTMENT_IDS, USER_IDS } from '../../core/auth/demo-users';
import {
  DataGateway,
  DocumentVerificationInput,
  ServiceUnavailableError,
  TransitionInput,
  TransitionNotAllowedError,
} from '../../core/data/data-gateway';
import { WORKFLOW_KEYS } from '../../core/data/workflow-definitions';
import { RequestDocument, ServiceRequest, WorkflowTransition } from '../../core/models/domain';
import { all, el, maybeEl, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { CaseDetailPage } from './case-detail-page';

const REFERENCE = 'CA-2026-00042';

function notUsed(): Error {
  return new Error('The case detail page does not call this gateway method.');
}

/** Records what the screen asked for, so the specs assert on the call rather than the mock. */
class FakeGateway extends DataGateway {
  /** The engine's answer is not under test here; screens drive state directly. */
  async listAvailableTransitions(): Promise<readonly WorkflowTransition[]> {
    return [];
  }

  record: ServiceRequest | null = null;
  failNext = false;
  neverResolves = false;
  refuseTransition = false;
  reads = 0;
  readonly transitions: TransitionInput[] = [];
  readonly verifications: DocumentVerificationInput[] = [];
  assigned: string | null = null;

  override async getRequest(): Promise<ServiceRequest | null> {
    this.reads += 1;
    if (this.neverResolves) {
      return new Promise<ServiceRequest | null>(() => undefined);
    }
    if (this.failNext) {
      this.failNext = false;
      throw new ServiceUnavailableError();
    }
    return this.record;
  }

  override async applyTransition(input: TransitionInput): Promise<ServiceRequest> {
    this.transitions.push(input);
    if (this.refuseTransition) {
      throw new TransitionNotAllowedError(input.transitionKey);
    }
    return this.record as ServiceRequest;
  }

  override async setDocumentVerification(
    input: DocumentVerificationInput,
  ): Promise<ServiceRequest> {
    this.verifications.push(input);
    return this.record as ServiceRequest;
  }

  override async assignRequest(
    _requestId: string,
    assigneeId: string | null,
  ): Promise<ServiceRequest> {
    this.assigned = assigneeId;
    return this.record as ServiceRequest;
  }

  override listDepartments(): never {
    throw notUsed();
  }
  override listServices(): never {
    throw notUsed();
  }
  override getService(): never {
    throw notUsed();
  }
  override listRequestsForApplicant(): never {
    throw notUsed();
  }
  override listQueue(): never {
    throw notUsed();
  }
  override submitRequest(): never {
    throw notUsed();
  }
  override addComment(): never {
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

function makeDocument(overrides: Partial<RequestDocument> = {}): RequestDocument {
  return {
    id: 'doc-1',
    requirementId: 'civil-id-copy',
    fileName: 'civil-id.pdf',
    sizeKb: 820,
    mimeType: 'application/pdf',
    uploadedAt: new Date(Date.now() - 86_400_000).toISOString(),
    verification: 'pending',
    note: null,
    ...overrides,
  };
}

/**
 * A civil document request. That workflow carries all three shapes the action
 * panel has to explain: an unconditional transition, one guarded on the
 * documents, and two that require a comment.
 */
function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequest {
  const now = Date.now();
  return {
    id: 'req-1',
    reference: REFERENCE,
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
    fieldValues: { subjectName: 'Fahad Al Sabah', copies: '2', contactPhone: '55512345' },
    documents: [makeDocument()],
    history: [
      {
        id: 'hist-1',
        at: new Date(now - 7_200_000).toISOString(),
        actorId: USER_IDS.citizen,
        actorName: { en: 'Fahad Al Sabah', ar: 'فهد الصباح' },
        actorRole: 'citizen',
        action: 'submitted',
        fromStateKey: null,
        toStateKey: 'submitted',
        transitionKey: null,
        comment: null,
      },
    ],
    comments: [],
    ...overrides,
  };
}

describe('CaseDetailPage', () => {
  let fixture: ComponentFixture<CaseDetailPage>;
  let gateway: FakeGateway;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(CaseDetailPage);
    fixture.componentRef.setInput('reference', REFERENCE);
    await settle();
  }

  /**
   * Renders with the load still in flight. `whenStable` would wait for the
   * gateway that is deliberately never answering, so the pass is driven by
   * hand instead.
   */
  async function renderWhileLoading(): Promise<void> {
    gateway.neverResolves = true;
    fixture = TestBed.createComponent(CaseDetailPage);
    fixture.componentRef.setInput('reference', REFERENCE);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  /** The transition buttons only, not the "add a comment" link beside a blocked one. */
  function actionButtons(): HTMLButtonElement[] {
    return all<HTMLButtonElement>(fixture, '.actions__item > app-button button');
  }

  function actionNamed(label: string): HTMLButtonElement | undefined {
    return actionButtons().find((button) => button.textContent?.trim() === label);
  }

  /** Two dialogs live on this page, so they are told apart by their heading. */
  function dialogTitled(title: string): HTMLElement {
    const found = all<HTMLElement>(fixture, 'dialog').find(
      (node) => node.querySelector('.dialog__title')?.textContent?.trim() === title,
    );
    if (!found) {
      throw new Error(`Expected a dialog titled "${title}".`);
    }
    return found;
  }

  function footerButtons(dialog: HTMLElement): HTMLButtonElement[] {
    return Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__footer button'));
  }

  function typeComment(value: string): void {
    const box = el<HTMLTextAreaElement>(fixture, '.case__rail textarea');
    box.value = value;
    box.dispatchEvent(new Event('input'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CaseDetailPage],
      providers: [
        ...testProviders(),
        provideRouter([]),
        { provide: DataGateway, useClass: FakeGateway },
      ],
    }).compileComponents();

    await setupI18n();
    TestBed.inject(AuthService).signIn(USER_IDS.officer);
    gateway = TestBed.inject(DataGateway) as FakeGateway;
    gateway.record = makeRequest();
  });

  afterEach(() => {
    // The account is remembered in storage, so it has to be given back or it
    // leaks into every spec that runs after this file.
    TestBed.inject(AuthService).signOut();
  });

  it('keeps the heading and the trail while the file loads', async () => {
    await renderWhileLoading();

    expect(text(fixture, 'h1')).toBe(`Case ${REFERENCE}`);
    expect(maybeEl(fixture, 'app-skeleton')).not.toBeNull();
    expect(maybeEl(fixture, '.case__rail')).toBeNull();
  });

  it('explains a failed load and retries through the gateway', async () => {
    gateway.failNext = true;
    await render();

    expect(text(fixture, '.error-state__title')).toBe('This request could not be opened');

    el<HTMLButtonElement>(fixture, 'app-error-state button').click();
    await settle();

    expect(gateway.reads).toBe(2);
    expect(maybeEl(fixture, 'app-error-state')).toBeNull();
  });

  it('says which reference was not found rather than that something went wrong', async () => {
    gateway.record = null;
    await render();

    expect(text(fixture, '.error-state__title')).toBe('Request not found');
    expect(text(fixture, '.error-state__description')).toContain(REFERENCE);
  });

  it('shows the applicant, their civil ID and the contact number', async () => {
    await render();

    const applicant = el(fixture, '.case__layout dl');
    expect(applicant.textContent).toContain('Fahad Al Sabah');
    expect(applicant.textContent).toContain('289061500321');
    expect(applicant.textContent).toContain('55512345');
  });

  it('renders the submitted answers under the questions the service asked', async () => {
    await render();

    const application = all(fixture, '.case__layout dl')[1];
    expect(application.textContent).toContain('Name on the record');
    expect(application.textContent).toContain('Number of copies');
  });

  it('lists each attachment with its requirement and verification state', async () => {
    await render();

    expect(text(fixture, '.documents__name')).toContain('Civil ID copy');
    expect(text(fixture, '.documents__file')).toContain('civil-id.pdf');
    expect(text(fixture, '.documents__state')).toBe('Not checked');
    expect(text(fixture, '.documents__progress')).toBe('0 of 1 required documents verified');
  });

  it('records a verification against the officer and reloads the case', async () => {
    await render();

    el<HTMLButtonElement>(fixture, '.documents__actions button').click();
    await settle();

    expect(gateway.verifications.length).toBe(1);
    expect(gateway.verifications[0].verification).toBe('verified');
    expect(gateway.verifications[0].actor.id).toBe(USER_IDS.officer);
    expect(gateway.reads).toBe(2);
  });

  it('will not reject a document without a reason for the applicant', async () => {
    await render();

    all<HTMLButtonElement>(fixture, '.documents__actions button')[1].click();
    await settle();

    const dialog = dialogTitled('Why is this document being rejected?');
    expect(dialog.textContent).toContain('The applicant sees this note');

    footerButtons(dialog)[1].click();
    await settle();

    expect(gateway.verifications.length).toBe(0);
    expect(maybeEl(fixture, '.field__error')).not.toBeNull();
  });

  it('offers the transitions the workflow allows this role, under their own labels', async () => {
    await render();

    const labels = actionButtons().map((button) => button.textContent?.trim());
    expect(labels).toContain('Records match');
    expect(labels).toContain('Request information');
    expect(labels).toContain('Reject as incomplete');
  });

  it('blocks a guarded transition and says which condition is unmet', async () => {
    await render();

    expect(actionNamed('Records match')?.disabled).toBeTrue();
    expect(el(fixture, '.actions__list').textContent).toContain(
      'Every required document has to be verified before this action becomes available.',
    );
  });

  it('blocks a transition that needs a comment until one is written', async () => {
    await render();

    expect(actionNamed('Request information')?.disabled).toBeTrue();
    expect(el(fixture, '.actions__list').textContent).toContain(
      'This action requires a comment explaining the decision.',
    );

    typeComment('The birth record does not match the name given.');
    await settle();

    expect(actionNamed('Request information')?.disabled).toBeFalse();
  });

  it('confirms an action by naming the case and the stage it moves to', async () => {
    gateway.record = makeRequest({ currentStateKey: 'submitted', status: 'submitted' });
    await render();

    actionButtons()[0].click();
    await settle();

    const dialog = dialogTitled('Apply "Begin review"?');
    expect(dialog.textContent).toContain(REFERENCE);
    expect(dialog.textContent).toContain('Record check');
  });

  it('applies the confirmed transition with the comment that was written', async () => {
    gateway.record = makeRequest({ currentStateKey: 'submitted', status: 'submitted' });
    await render();

    typeComment('Documents checked against the register.');
    await settle();

    actionButtons()[0].click();
    await settle();

    footerButtons(dialogTitled('Apply "Begin review"?'))[1].click();
    await settle();

    expect(gateway.transitions.length).toBe(1);
    expect(gateway.transitions[0].transitionKey).toBe('beginReview');
    expect(gateway.transitions[0].comment).toBe('Documents checked against the register.');
    expect(gateway.reads).toBe(2);
  });

  it('leaves the case where it was when the workflow refuses the transition', async () => {
    gateway.record = makeRequest({ currentStateKey: 'submitted', status: 'submitted' });
    gateway.refuseTransition = true;
    await render();

    actionButtons()[0].click();
    await settle();
    footerButtons(dialogTitled('Apply "Begin review"?'))[1].click();
    await settle();

    const alert = el(fixture, 'app-alert');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('The action was not applied');
    // Still on the same stage, and not reloaded behind the officer's back.
    expect(gateway.reads).toBe(1);
    expect(el(fixture, '.case__chips').textContent).toContain('Submitted');
  });

  it('says who a case is waiting on when the role has nothing to do', async () => {
    gateway.record = makeRequest({ currentStateKey: 'moreInfo', status: 'moreInfo' });
    await render();

    expect(text(fixture, '.empty-state__title')).toBe('No actions available to you');
    expect(text(fixture, '.empty-state__description')).toContain('Citizen');
  });

  it('offers to take an unassigned case and records the officer against it', async () => {
    gateway.record = makeRequest({ assigneeId: null });
    await render();

    const assign = el<HTMLButtonElement>(fixture, '[pageHeaderActions] button');
    expect(assign.textContent?.trim()).toBe('Assign to me');

    assign.click();
    await settle();

    expect(gateway.assigned).toBe(USER_IDS.officer);
  });

  it('gives the page one heading and a trail back to the queue', async () => {
    await render();

    expect(all(fixture, 'h1').length).toBe(1);
    expect(el<HTMLAnchorElement>(fixture, 'app-breadcrumbs a').getAttribute('href')).toBe(
      '/officer',
    );
    expect(el(fixture, 'app-breadcrumbs [aria-current="page"]').textContent?.trim()).toBe(
      REFERENCE,
    );
  });
});
