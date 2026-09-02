import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DataGateway } from '../../core/data/data-gateway';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  DraftDocument,
  RequestDraft,
  RequestPriority,
  ServiceDefinition,
  ServiceRequest,
} from '../../core/models/domain';
import { kuwaitPhoneValidator, messageFor, mustAcknowledge } from '../../shared/forms/validation-messages';
import { Alert } from '../../shared/ui/alert/alert';
import { BreadcrumbItem, Breadcrumbs } from '../../shared/ui/breadcrumbs/breadcrumbs';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { nextControlId } from '../../shared/ui/field/field';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressStep, ProgressTracker } from '../../shared/ui/progress-tracker/progress-tracker';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { CitizenDetailsStep } from './details-step';
import { CitizenDocumentsStep, DocumentChoice } from './documents-step';
import { CitizenReviewStep } from './review-step';
import { CitizenServiceStep } from './service-step';
import {
  DocumentRejection,
  WIZARD_STEP_DETAILS,
  WIZARD_STEP_DOCUMENTS,
  WIZARD_STEP_KEYS,
  WIZARD_STEP_REVIEW,
  WIZARD_STEP_SERVICE,
  WizardProblem,
  fieldAnchorId,
  formatAcceptedFormats,
} from './wizard-model';

/** A kilobyte, as the file APIs count them. */
const BYTES_PER_KB = 1024;

/**
 * Filing a new request.
 *
 * Four steps rather than one long form, because the questions in step two are
 * not known until the service in step one has been chosen, and because a page
 * that asks for documents before it has said which documents it wants is a page
 * people abandon.
 *
 * Everything here is real: real reactive forms with real validators, a real
 * radio group, real file inputs. What is deliberately not real is the transfer
 * of the files themselves, which this build has nowhere to send. The documents
 * step says so in plain words and no wording anywhere claims a file was
 * uploaded; what is recorded against the draft is the name, size and type the
 * browser reported.
 *
 * Validation is only shown when someone tries to move on. Marking a form dirty
 * on load teaches people to ignore red text before they have typed anything.
 */
@Component({
  selector: 'app-new-request-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alert,
    Breadcrumbs,
    Button,
    Card,
    CitizenDetailsStep,
    CitizenDocumentsStep,
    CitizenReviewStep,
    CitizenServiceStep,
    ErrorState,
    Icon,
    PageHeader,
    ProgressTracker,
    Skeleton,
  ],
  styleUrl: './new-request-page.scss',
  host: { class: 'page' },
  template: `
    <app-page-header [heading]="i18n.t('citizen.wizard.title')">
      <app-breadcrumbs pageHeaderBreadcrumbs [items]="breadcrumbs()" />
    </app-page-header>

    <!--
      Kept outside the branch below so the receipt still shows the journey, all
      four steps complete, rather than dropping the tracker at the moment it
      finally has good news to report.
    -->
    <app-progress-tracker [steps]="trackerSteps()" />

    @if (submitted(); as request) {
      <app-card [hasHeader]="false" class="wizard__success">
        <app-icon name="check-circle" size="xl" class="wizard__success-icon" />

        <h2 #stepHeading class="wizard__success-title" tabindex="-1">
          {{ i18n.t('citizen.wizard.successTitle', { reference: request.reference }) }}
        </h2>

        <p class="wizard__success-description">
          {{ i18n.t('citizen.wizard.successDescription') }}
        </p>

        <p class="wizard__success-reference">
          <span class="wizard__success-reference-label">{{ i18n.t('common.reference') }}</span>
          <span class="u-reference">{{ request.reference }}</span>
        </p>

        <div class="wizard__success-actions">
          <app-button variant="primary" icon="file" (pressed)="viewRequest(request)">
            {{ i18n.t('citizen.wizard.viewRequest') }}
          </app-button>
          <app-button variant="secondary" icon="plus" (pressed)="startAnother()">
            {{ i18n.t('citizen.wizard.startAnother') }}
          </app-button>
        </div>
      </app-card>
    } @else {
      @if (services.isLoading()) {
        <app-card [hasHeader]="false">
          <div class="wizard__loading">
            <app-skeleton variant="heading" width="16rem" [label]="i18n.t('a11y.loading')" />
            <app-skeleton variant="block" height="7rem" />
            <app-skeleton variant="block" height="7rem" />
            <app-skeleton variant="block" height="7rem" />
          </div>
        </app-card>
      } @else if (services.error()) {
        <app-error-state
          [title]="i18n.t('errors.loadServicesTitle')"
          [description]="i18n.t('errors.loadServicesDescription')"
          (retry)="services.reload()"
        />
      } @else {
        <form class="wizard__form" (submit)="handleSubmit($event)">
          <app-card [hasHeader]="false">
            <h2 #stepHeading class="wizard__step-heading" tabindex="-1">
              <span class="wizard__step-count">{{ stepCounter() }}</span>
              <span class="wizard__step-name">{{ i18n.t(stepKey()) }}</span>
            </h2>

            @if (showProblems() && problems().length > 0) {
              <app-alert
                tone="danger"
                class="wizard__problems"
                [heading]="i18n.t('validation.summaryTitle')"
              >
                <p>{{ i18n.t('validation.summaryIntro') }}</p>
                <ul class="wizard__problem-list">
                  @for (problem of problems(); track problem.anchor) {
                    <li>
                      <a
                        class="wizard__problem-link"
                        [href]="'#' + problem.anchor"
                        (click)="focusAnchor(problem.anchor, $event)"
                      >
                        {{ problem.message }}
                      </a>
                    </li>
                  }
                </ul>
              </app-alert>
            }

            @switch (step()) {
              @case (serviceStep) {
                <app-citizen-service-step
                  [services]="services.value()"
                  [selected]="serviceId()"
                  [idPrefix]="instanceId"
                  (chose)="selectService($event)"
                />
              }
              @case (detailsStep) {
                @if (selectedService(); as service) {
                  <app-citizen-details-step
                    [service]="service"
                    [form]="detailsForm()"
                    [idPrefix]="instanceId"
                  />
                }
              }
              @case (documentsStep) {
                @if (selectedService(); as service) {
                  <app-citizen-documents-step
                    [requirements]="service.documents"
                    [attachments]="attachments()"
                    [errors]="documentErrors()"
                    [idPrefix]="instanceId"
                    (chose)="chooseDocument($event)"
                    (removed)="removeDocument($event)"
                  />
                }
              }
              @case (reviewStep) {
                @if (selectedService(); as service) {
                  <app-citizen-review-step
                    [service]="service"
                    [form]="detailsForm()"
                    [attachments]="attachments()"
                    [declaration]="declaration"
                    [declarationError]="declarationError()"
                    [idPrefix]="instanceId"
                    (edit)="goToStep($event)"
                  />
                }
              }
            }

            @if (submitFailed()) {
              <app-alert
                tone="danger"
                class="wizard__problems"
                [heading]="i18n.t('errors.actionFailedTitle')"
              >
                {{ i18n.t('errors.actionFailedDescription') }}
              </app-alert>
            }

            <div cardFooter class="wizard__nav">
              <app-button
                variant="secondary"
                icon="arrow-prev"
                [disabled]="step() === serviceStep"
                (pressed)="back()"
              >
                {{ i18n.t('common.back') }}
              </app-button>

              @if (step() === reviewStep) {
                <app-button type="submit" variant="primary" icon="send" [busy]="submitting()">
                  {{ submitting() ? i18n.t('citizen.wizard.submitting') : i18n.t('citizen.wizard.submitRequest') }}
                </app-button>
              } @else {
                <app-button type="submit" variant="primary" trailingIcon="arrow-next">
                  {{ i18n.t('common.next') }}
                </app-button>
              }
            </div>
          </app-card>
        </form>
      }
    }
  `,
})
export class NewRequestPage {
  protected readonly i18n = inject(I18nService);

  private readonly gateway = inject(DataGateway);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Prefix for every id this wizard mints, so two could coexist on a page. */
  protected readonly instanceId = nextControlId('wizard');

  protected readonly serviceStep = WIZARD_STEP_SERVICE;
  protected readonly detailsStep = WIZARD_STEP_DETAILS;
  protected readonly documentsStep = WIZARD_STEP_DOCUMENTS;
  protected readonly reviewStep = WIZARD_STEP_REVIEW;

  protected readonly services = resource({
    loader: () => this.gateway.listServices(),
    defaultValue: [] as readonly ServiceDefinition[],
  });

  protected readonly step = signal(WIZARD_STEP_SERVICE);
  protected readonly serviceId = signal<string | null>(null);

  /**
   * Rebuilt whenever the service changes, because the questions belong to the
   * service. Held in a signal so the template picks the new group up.
   */
  protected readonly detailsForm = signal(new FormGroup({}));

  protected readonly attachments = signal<Readonly<Record<string, DraftDocument>>>({});
  private readonly rejections = signal<Readonly<Record<string, DocumentRejection>>>({});
  private readonly documentsTouched = signal(false);

  protected readonly declaration = new FormControl(false, {
    nonNullable: true,
    validators: [mustAcknowledge()],
  });

  protected readonly showProblems = signal(false);
  protected readonly submitting = signal(false);
  protected readonly submitFailed = signal(false);
  protected readonly submitted = signal<ServiceRequest | null>(null);

  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  protected readonly selectedService = computed(
    () => this.services.value().find((candidate) => candidate.id === this.serviceId()) ?? null,
  );

  protected readonly breadcrumbs = computed<readonly BreadcrumbItem[]>(() => [
    { label: this.i18n.t('citizen.title'), link: '/citizen' },
    { label: this.i18n.t('citizen.wizard.title') },
  ]);

  /**
   * The tracker is the real step state, not a decoration: a completed step is
   * one that has been passed, and everything is complete once the request has a
   * reference number.
   */
  protected readonly trackerSteps = computed<readonly ProgressStep[]>(() => {
    const current = this.step();
    const filed = this.submitted() !== null;
    return WIZARD_STEP_KEYS.map((key, index) => {
      const state: ProgressStep['state'] =
        filed || index < current ? 'complete' : index === current ? 'current' : 'upcoming';
      return { id: key, label: this.i18n.t(key), state };
    });
  });

  /**
   * Per requirement messages, already localised. Computed rather than stored so
   * they follow a language switch, and so the required message appears only
   * after the step has been attempted.
   */
  protected readonly documentErrors = computed<Readonly<Record<string, string>>>(() => {
    const service = this.selectedService();
    if (!service) {
      return {};
    }
    const rejections = this.rejections();
    const attachments = this.attachments();
    const touched = this.documentsTouched();
    const errors: Record<string, string> = {};

    for (const requirement of service.documents) {
      const rejection = rejections[requirement.id];
      if (rejection) {
        errors[requirement.id] =
          rejection.kind === 'size'
            ? this.i18n.t('validation.fileTooLarge', {
                file: rejection.fileName,
                size: this.i18n.formatFileSize(rejection.sizeKb),
                limit: this.i18n.formatFileSize(requirement.maxSizeMb * BYTES_PER_KB),
              })
            : this.i18n.t('validation.fileType', {
                file: rejection.fileName,
                formats: formatAcceptedFormats(requirement.formats),
              });
        continue;
      }
      if (requirement.required && !attachments[requirement.id] && touched) {
        errors[requirement.id] = this.i18n.t('validation.fileRequired', {
          field: this.i18n.pick(requirement.name),
        });
      }
    }
    return errors;
  });

  protected stepKey(): string {
    return WIZARD_STEP_KEYS[this.step()] ?? WIZARD_STEP_KEYS[0];
  }

  protected stepCounter(): string {
    return this.i18n.t('common.step', {
      current: this.i18n.formatNumber(this.step() + 1),
      total: this.i18n.formatNumber(WIZARD_STEP_KEYS.length),
    });
  }

  protected declarationError(): string | null {
    if (!this.declaration.touched || this.declaration.valid) {
      return null;
    }
    return this.i18n.t('validation.acknowledgeRequired');
  }

  // ---------------------------------------------------------------------------
  // Step one
  // ---------------------------------------------------------------------------

  /**
   * Changing the service throws away the answers and the attachments, because
   * they belonged to questions that no longer exist. Carrying them across would
   * file a request answering the wrong form.
   */
  protected selectService(serviceId: string): void {
    if (serviceId === this.serviceId()) {
      return;
    }
    this.serviceId.set(serviceId);
    const service = this.services.value().find((candidate) => candidate.id === serviceId);
    this.detailsForm.set(service ? buildDetailsForm(service) : new FormGroup({}));
    this.attachments.set({});
    this.rejections.set({});
    this.documentsTouched.set(false);
    this.declaration.reset(false);
    this.showProblems.set(false);
  }

  // ---------------------------------------------------------------------------
  // Step three
  // ---------------------------------------------------------------------------

  /**
   * Size and extension are checked here rather than left to the `accept`
   * attribute, which is a filter on the picker and not a guarantee: a file can
   * still arrive by drag and drop or from a picker that ignores it.
   */
  protected chooseDocument(choice: DocumentChoice): void {
    const { requirement, file } = choice;
    const sizeKb = Math.max(1, Math.round(file.size / BYTES_PER_KB));
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

    if (!requirement.formats.includes(extension)) {
      this.reject(requirement.id, { kind: 'type', fileName: file.name, sizeKb });
      return;
    }
    if (file.size > requirement.maxSizeMb * BYTES_PER_KB * BYTES_PER_KB) {
      this.reject(requirement.id, { kind: 'size', fileName: file.name, sizeKb });
      return;
    }

    this.clearRejection(requirement.id);
    this.attachments.update((current) => ({
      ...current,
      [requirement.id]: {
        requirementId: requirement.id,
        fileName: file.name,
        sizeKb,
        // Some browsers report nothing for an unfamiliar extension, and an
        // empty string is a more honest record than a guess.
        mimeType: file.type,
      },
    }));
  }

  protected removeDocument(requirementId: string): void {
    this.clearRejection(requirementId);
    this.attachments.update((current) => {
      const next = { ...current };
      delete next[requirementId];
      return next;
    });
  }

  private reject(requirementId: string, rejection: DocumentRejection): void {
    this.rejections.update((current) => ({ ...current, [requirementId]: rejection }));
  }

  private clearRejection(requirementId: string): void {
    this.rejections.update((current) => {
      const next = { ...current };
      delete next[requirementId];
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * One submit path for the whole wizard. The forward button is always the
   * form's submit button, so pressing Enter in a field does exactly what
   * pressing it does.
   */
  protected handleSubmit(event: Event): void {
    event.preventDefault();
    if (this.step() === WIZARD_STEP_REVIEW) {
      void this.submit();
    } else {
      this.next();
    }
  }

  protected next(): void {
    if (!this.completeCurrentStep()) {
      this.reportProblems();
      return;
    }
    this.showProblems.set(false);
    this.step.update((current) => Math.min(current + 1, WIZARD_STEP_REVIEW));
    this.focusHeading();
  }

  protected back(): void {
    this.showProblems.set(false);
    this.submitFailed.set(false);
    this.step.update((current) => Math.max(current - 1, WIZARD_STEP_SERVICE));
    this.focusHeading();
  }

  /** Used by the review step's edit links, which jump rather than step back. */
  protected goToStep(step: number): void {
    this.showProblems.set(false);
    this.step.set(Math.min(Math.max(step, WIZARD_STEP_SERVICE), WIZARD_STEP_REVIEW));
    this.focusHeading();
  }

  /**
   * Marks the current step's controls touched so their own messages appear, and
   * answers whether it may be left.
   */
  private completeCurrentStep(): boolean {
    switch (this.step()) {
      case WIZARD_STEP_SERVICE:
        return this.serviceId() !== null;
      case WIZARD_STEP_DETAILS:
        this.detailsForm().markAllAsTouched();
        return this.detailsForm().valid;
      case WIZARD_STEP_DOCUMENTS:
        this.documentsTouched.set(true);
        return this.documentProblems().length === 0;
      case WIZARD_STEP_REVIEW:
        this.declaration.markAsTouched();
        return this.declaration.valid;
      default:
        return true;
    }
  }

  private reportProblems(): void {
    this.showProblems.set(true);
    const first = this.problems()[0];
    if (first) {
      afterNextRender(() => this.moveFocusTo(first.anchor), { injector: this.injector });
    }
  }

  /**
   * Everything wrong with the current step, in the order the questions are
   * asked. Recomputed on demand rather than stored, so it cannot describe a
   * problem that has since been fixed.
   */
  protected problems(): readonly WizardProblem[] {
    switch (this.step()) {
      case WIZARD_STEP_SERVICE:
        return this.serviceId() !== null
          ? []
          : [
              {
                anchor: fieldAnchorId(this.instanceId, 'service'),
                message: this.i18n.t('citizen.wizard.noServiceSelected'),
              },
            ];
      case WIZARD_STEP_DETAILS:
        return this.detailProblems();
      case WIZARD_STEP_DOCUMENTS:
        return this.documentProblems();
      case WIZARD_STEP_REVIEW:
        return this.declaration.valid
          ? []
          : [
              {
                anchor: fieldAnchorId(this.instanceId, 'declaration'),
                message: this.i18n.t('validation.acknowledgeRequired'),
              },
            ];
      default:
        return [];
    }
  }

  private detailProblems(): readonly WizardProblem[] {
    const service = this.selectedService();
    if (!service) {
      return [];
    }
    const form = this.detailsForm();
    const named: readonly { name: string; label: string }[] = [
      ...service.fields.map((field) => ({ name: field.id, label: this.i18n.pick(field.label) })),
      { name: 'contactPhone', label: this.i18n.t('citizen.wizard.contactPhone') },
      { name: 'priority', label: this.i18n.t('citizen.wizard.priorityLabel') },
    ];

    const problems: WizardProblem[] = [];
    for (const entry of named) {
      const errors = form.get(entry.name)?.errors;
      if (!errors) {
        continue;
      }
      const message = messageFor(errors, entry.label, this.i18n);
      if (message) {
        problems.push({ anchor: fieldAnchorId(this.instanceId, entry.name), message });
      }
    }
    return problems;
  }

  private documentProblems(): readonly WizardProblem[] {
    const service = this.selectedService();
    if (!service) {
      return [];
    }
    const errors = this.documentErrors();
    return service.documents
      .filter((requirement) => errors[requirement.id] !== undefined)
      .map((requirement) => ({
        anchor: fieldAnchorId(this.instanceId, `document-${requirement.id}`),
        message: errors[requirement.id],
      }));
  }

  /**
   * Follows a summary entry to the answer it describes. The anchor is a real
   * href, so the link works without script and reads as a link, and the handler
   * additionally puts the caret in the control rather than only scrolling to it.
   */
  protected focusAnchor(anchor: string, event: Event): void {
    event.preventDefault();
    this.moveFocusTo(anchor);
  }

  private moveFocusTo(anchor: string): void {
    const container = this.host.nativeElement.querySelector<HTMLElement>(`#${anchor}`);
    if (!container) {
      return;
    }
    const control = container.querySelector<HTMLElement>('input, select, textarea, button');
    (control ?? container).focus();
    container.scrollIntoView({ block: 'nearest' });
  }

  /** Moving between steps replaces the content, so focus follows the heading. */
  private focusHeading(): void {
    afterNextRender(() => this.stepHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  private async submit(): Promise<void> {
    if (!this.completeCurrentStep()) {
      this.reportProblems();
      return;
    }
    const service = this.selectedService();
    const applicant = this.auth.user();
    if (!service || !applicant) {
      return;
    }

    this.submitting.set(true);
    this.submitFailed.set(false);
    try {
      const request = await this.gateway.submitRequest(this.draftFor(service), applicant);
      this.submitted.set(request);
      this.toasts.success(
        this.i18n.t('toast.requestSubmitted', { reference: request.reference }),
        this.i18n.t('toast.requestSubmittedDetail'),
      );
      this.focusHeading();
    } catch {
      // Nothing was filed, so the wizard stays exactly as it was and the panel
      // above the buttons says so. Losing the answers here would be unforgivable.
      this.submitFailed.set(true);
    } finally {
      this.submitting.set(false);
    }
  }

  private draftFor(service: ServiceDefinition): RequestDraft {
    const values = this.detailsForm().getRawValue() as Record<string, string>;
    const fieldValues: Record<string, string> = {};
    for (const field of service.fields) {
      fieldValues[field.id] = values[field.id] ?? '';
    }
    const attachments = this.attachments();

    return {
      serviceId: service.id,
      fieldValues,
      // Kept in requirement order so the officer reads them in the order the
      // service asked for them.
      documents: service.documents
        .map((requirement) => attachments[requirement.id])
        .filter((document): document is DraftDocument => document !== undefined),
      priority: (values['priority'] ?? 'normal') as RequestPriority,
      contactPhone: values['contactPhone'] ?? '',
      acknowledged: this.declaration.value,
    };
  }

  protected viewRequest(request: ServiceRequest): void {
    void this.router.navigate(['/citizen', request.reference]);
  }

  protected startAnother(): void {
    this.submitted.set(null);
    this.submitFailed.set(false);
    this.serviceId.set(null);
    this.detailsForm.set(new FormGroup({}));
    this.attachments.set({});
    this.rejections.set({});
    this.documentsTouched.set(false);
    this.declaration.reset(false);
    this.showProblems.set(false);
    this.step.set(WIZARD_STEP_SERVICE);
    this.focusHeading();
  }
}

/**
 * Turns a service definition into a form group.
 *
 * The validators come off the definition rather than being written per service,
 * which is what keeps "required" in the catalogue and "required" in the form the
 * same fact. Two controls are added to every service: the number updates are
 * sent to, and the applicant's own view of how urgent it is.
 */
function buildDetailsForm(service: ServiceDefinition): FormGroup {
  const controls: Record<string, FormControl<string>> = {};

  for (const field of service.fields) {
    const validators = [];
    if (field.required) {
      validators.push(Validators.required);
    }
    if (field.maxLength !== null) {
      validators.push(Validators.maxLength(field.maxLength));
    }
    controls[field.id] = new FormControl('', { nonNullable: true, validators });
  }

  controls['contactPhone'] = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, kuwaitPhoneValidator()],
  });
  controls['priority'] = new FormControl('normal', { nonNullable: true });

  return new FormGroup(controls);
}
