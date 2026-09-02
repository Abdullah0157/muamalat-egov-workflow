import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DataGateway } from '../../core/data/data-gateway';
import { slaStateFor } from '../../core/data/sla';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  RequestDocument,
  ServiceField,
  ServiceRequest,
  WorkflowTransition,
} from '../../core/models/domain';
import { validationMessage } from '../../shared/forms/validation-messages';
import { Alert } from '../../shared/ui/alert/alert';
import { Badge } from '../../shared/ui/badge/badge';
import { BreadcrumbItem, Breadcrumbs } from '../../shared/ui/breadcrumbs/breadcrumbs';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { nextControlId } from '../../shared/ui/field/field';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressStep, ProgressTracker } from '../../shared/ui/progress-tracker/progress-tracker';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import {
  priorityPresentation,
  requestStatusPresentation,
  slaPresentation,
  verificationPresentation,
} from '../../shared/ui/status/status-presentation';
import { Textarea } from '../../shared/ui/textarea/textarea';
import { TimelineItem, Timeline } from '../../shared/ui/timeline/timeline';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  availableTransitions,
  buildHistoryItems,
  buildStageSteps,
  departmentFor,
  serviceFor,
  stateName,
} from '../shared/request-presentation';
import { acceptAttributeFor, formatAcceptedFormats } from './wizard-model';

/** The transition a citizen takes to answer a request for information. */
const INFORMATION_PROVIDED = 'informationProvided';

/** What a response may carry. Mirrors the widest requirement in the catalogue. */
const RESPONSE_FORMATS: readonly string[] = ['pdf', 'jpg', 'png'];

/**
 * One request, in full.
 *
 * This is the page a member of the public opens to find out what is happening
 * to their application, so it is ordered by what they came for: anything they
 * have to do first, then where the file has reached, then what they sent, then
 * the record of everything that has happened to it. The rail carries the facts
 * they would quote on the phone.
 *
 * The "more information needed" loop is real. When the workflow puts the file
 * back with the applicant, the response form applies the same transition an
 * officer would see, through the same gateway, and the case moves on.
 */
@Component({
  selector: 'app-request-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alert,
    Badge,
    Breadcrumbs,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Icon,
    PageHeader,
    ProgressTracker,
    ReactiveFormsModule,
    Skeleton,
    Textarea,
    Timeline,
  ],
  styleUrl: './request-detail-page.scss',
  host: { class: 'page' },
  template: `
    @if (request.isLoading()) {
      <app-page-header [heading]="i18n.t('citizen.detailTitle', { reference: reference() })">
        <app-breadcrumbs pageHeaderBreadcrumbs [items]="breadcrumbs()" />
      </app-page-header>

      <div class="detail__layout">
        <div class="detail__main">
          <app-card [hasHeader]="false">
            <app-skeleton variant="block" height="5rem" [label]="i18n.t('a11y.loading')" />
          </app-card>
          <app-card [hasHeader]="false">
            <app-skeleton variant="text" [lines]="6" />
          </app-card>
        </div>
        <div class="detail__rail">
          <app-card [hasHeader]="false">
            <app-skeleton variant="text" [lines]="4" />
          </app-card>
        </div>
      </div>
    } @else if (request.error()) {
      <app-error-state
        [title]="i18n.t('errors.loadRequestTitle')"
        [description]="i18n.t('errors.loadRequestDescription')"
        (retry)="request.reload()"
      >
        <app-button errorStateAction variant="secondary" icon="arrow-prev" (pressed)="goToList()">
          {{ i18n.t('citizen.title') }}
        </app-button>
      </app-error-state>
    } @else {
      @if (request.value(); as record) {
        <app-page-header
          [heading]="i18n.t('citizen.detailTitle', { reference: record.reference })"
          [description]="filedOn(record)"
        >
          <app-breadcrumbs pageHeaderBreadcrumbs [items]="breadcrumbs()" />

          <div pageHeaderMeta class="detail__chips u-cluster">
            <app-badge
              solid
              [tone]="statusOf(record).tone"
              [icon]="statusOf(record).icon"
            >
              {{ i18n.t(statusOf(record).labelKey) }}
            </app-badge>
            <app-badge [tone]="priorityOf(record).tone" [icon]="priorityOf(record).icon">
              {{ i18n.t(priorityOf(record).labelKey) }}
            </app-badge>
            <app-badge [tone]="slaOf(record).tone" [icon]="slaOf(record).icon">
              {{ i18n.t(slaOf(record).labelKey) }}
            </app-badge>
          </div>
        </app-page-header>

        @if (record.status === 'moreInfo') {
          <app-alert tone="warning" [heading]="i18n.t('citizen.actionNeededTitle')">
            {{ i18n.t('citizen.actionNeededDescription') }}
          </app-alert>

          <app-card class="detail__response" [id]="responseId">
            <span cardTitle>{{ i18n.t('citizen.respond') }}</span>

            <form class="u-stack" (submit)="sendResponse($event, record)">
              <app-textarea
                required
                autoGrow
                [rows]="4"
                [formControl]="responseBody"
                [label]="i18n.t('citizen.respond')"
                [placeholder]="i18n.t('citizen.responsePlaceholder')"
                [error]="responseError()"
              />

              <div class="detail__response-file">
                <input
                  type="file"
                  class="detail__file-input"
                  [id]="responseFileId"
                  [accept]="responseAccept"
                  [attr.aria-describedby]="responseFileHintId"
                  (change)="chooseResponseFile($event)"
                />
                <label class="detail__file-button" [attr.for]="responseFileId">
                  <app-icon name="paperclip" size="md" />
                  <span>{{ i18n.t('citizen.wizard.chooseFile') }}</span>
                </label>

                <p class="detail__file-hint" [id]="responseFileHintId">{{ responseAccepted() }}</p>

                @if (responseFile(); as chosen) {
                  <p class="detail__file-chosen">
                    <span class="detail__file-name">{{ chosen.fileName }}</span>
                    <span class="detail__file-size">{{ i18n.formatFileSize(chosen.sizeKb) }}</span>
                    <app-button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      (pressed)="clearResponseFile()"
                    >
                      {{ i18n.t('citizen.wizard.removeFile') }}
                    </app-button>
                  </p>
                }
              </div>

              @if (responseFailed()) {
                <app-alert tone="danger" [heading]="i18n.t('errors.actionFailedTitle')">
                  {{ i18n.t('errors.actionFailedDescription') }}
                </app-alert>
              }

              <div class="detail__response-actions u-cluster-end">
                <app-button type="submit" variant="primary" icon="send" [busy]="responding()">
                  {{ i18n.t('citizen.respond') }}
                </app-button>
              </div>
            </form>
          </app-card>
        }

        <div class="detail__layout">
          <div class="detail__main">
            <app-card>
              <span cardTitle>{{ i18n.t('citizen.progressTitle') }}</span>
              <span cardSubtitle>{{ i18n.t('citizen.progressDescription') }}</span>
              <app-progress-tracker [steps]="stageSteps(record)" />
            </app-card>

            <app-card>
              <span cardTitle>{{ i18n.t('citizen.detailsTitle') }}</span>
              <dl class="u-fields">
                @for (entry of answers(record); track entry.id) {
                  <div>
                    <dt>{{ entry.label }}</dt>
                    <dd>{{ entry.value }}</dd>
                  </div>
                }
              </dl>
            </app-card>

            <app-card>
              <span cardTitle>{{ i18n.t('citizen.documentsTitle') }}</span>
              <span cardSubtitle>{{ i18n.t('citizen.documentsDescription') }}</span>

              @if (record.documents.length === 0) {
                <app-empty-state
                  icon="file"
                  [title]="i18n.t('empty.noDocumentsTitle')"
                  [description]="i18n.t('empty.noDocumentsDescription')"
                />
              } @else {
                <ul class="detail__documents">
                  @for (document of record.documents; track document.id) {
                    <li class="detail__document">
                      <app-icon name="file" size="md" class="detail__document-icon" />

                      <div class="detail__document-body">
                        <p class="detail__document-name">{{ document.fileName }}</p>
                        <p class="detail__document-meta">
                          <span>{{ requirementName(record, document) }}</span>
                          <span>{{ i18n.formatFileSize(document.sizeKb) }}</span>
                          <span>
                            {{ i18n.t('documents.uploadedOn', {
                              date: i18n.formatDate(document.uploadedAt)
                            }) }}
                          </span>
                        </p>

                        @if (document.note; as note) {
                          <p class="detail__document-note">
                            <span class="detail__document-note-label">
                              {{ i18n.t('documents.rejectedReason') }}
                            </span>
                            <span>{{ note }}</span>
                          </p>
                        }
                      </div>

                      <app-badge
                        size="sm"
                        [tone]="verificationOf(document).tone"
                        [icon]="verificationOf(document).icon"
                      >
                        {{ i18n.t(verificationOf(document).labelKey) }}
                      </app-badge>
                    </li>
                  }
                </ul>
              }
            </app-card>

            <app-card>
              <span cardTitle>{{ i18n.t('citizen.historyTitle') }}</span>
              <span cardSubtitle>{{ i18n.t('citizen.historyDescription') }}</span>
              <app-timeline [items]="historyItems(record)" />
            </app-card>
          </div>

          <aside class="detail__rail">
            <app-card>
              <span cardTitle>{{ i18n.t('common.summary') }}</span>
              <dl class="u-fields detail__summary">
                <div>
                  <dt>{{ i18n.t('common.reference') }}</dt>
                  <dd><span class="u-reference">{{ record.reference }}</span></dd>
                </div>
                <div>
                  <dt>{{ i18n.t('common.service') }}</dt>
                  <dd>{{ serviceName(record) }}</dd>
                </div>
                <div>
                  <dt>{{ i18n.t('common.department') }}</dt>
                  <dd>{{ departmentName(record) }}</dd>
                </div>
                <div>
                  <dt>{{ i18n.t('common.stage') }}</dt>
                  <dd>{{ currentStateName(record) }}</dd>
                </div>
                <div>
                  <dt>{{ i18n.t('common.submitted') }}</dt>
                  <dd>{{ i18n.formatDateTime(record.submittedAt ?? record.createdAt) }}</dd>
                </div>
              </dl>
            </app-card>

            <app-card>
              <span cardTitle>{{ i18n.t('common.sla') }}</span>
              <span cardSubtitle>{{ i18n.t(slaOf(record).labelKey) }}</span>

              @if (record.dueAt; as dueAt) {
                <!--
                  Both calendars, labelled. Official Kuwaiti correspondence
                  carries the two, and a deadline is exactly the kind of date
                  someone checks against a paper notice.
                -->
                <p class="detail__deadline-label">{{ i18n.t('citizen.estimatedCompletion') }}</p>
                <dl class="detail__calendars">
                  <div class="detail__calendar">
                    <dt>{{ i18n.t('common.gregorian') }}</dt>
                    <dd>{{ i18n.formatDate(dueAt) }}</dd>
                  </div>
                  @if (i18n.formatHijri(dueAt); as hijri) {
                    <div class="detail__calendar">
                      <dt>{{ i18n.t('common.hijri') }}</dt>
                      <dd>{{ hijri }}</dd>
                    </div>
                  }
                </dl>

                @if (slaCounter(record); as counter) {
                  <p class="detail__counter">{{ counter }}</p>
                }
                @if (slaExplanation(record); as explanation) {
                  <p class="detail__explanation">{{ explanation }}</p>
                }
              } @else {
                <p class="detail__explanation">{{ i18n.t('sla.notApplicable') }}</p>
              }
            </app-card>
          </aside>
        </div>
      } @else {
        <app-error-state
          tone="notFound"
          [retryable]="false"
          [title]="i18n.t('errors.requestNotFoundTitle')"
          [description]="i18n.t('errors.requestNotFoundDescription', { reference: reference() })"
        >
          <app-button errorStateAction variant="primary" icon="arrow-prev" (pressed)="goToList()">
            {{ i18n.t('citizen.title') }}
          </app-button>
        </app-error-state>
      }
    }
  `,
})
export class RequestDetailPage {
  /** The public reference number, bound straight from the route segment. */
  readonly reference = input.required<string>();

  protected readonly i18n = inject(I18nService);

  private readonly gateway = inject(DataGateway);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly responseId = nextControlId('response');
  protected readonly responseFileId = `${this.responseId}-file`;
  protected readonly responseFileHintId = `${this.responseId}-file-hint`;
  protected readonly responseAccept = acceptAttributeFor(RESPONSE_FORMATS);

  /**
   * Null is "no such request", which is a different answer from the loader
   * throwing. The two get different copy, because one is a mistyped reference
   * and the other is an outage.
   */
  protected readonly request = resource({
    params: () => ({ reference: this.reference() }),
    loader: ({ params }) => this.gateway.getRequest(params.reference),
    defaultValue: null as ServiceRequest | null,
  });

  protected readonly responseBody = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  protected readonly responseFile = signal<{ fileName: string; sizeKb: number } | null>(null);
  protected readonly responding = signal(false);
  protected readonly responseFailed = signal(false);

  /** One instant for every deadline figure on the page. */
  private readonly now = new Date();

  protected readonly breadcrumbs = computed<readonly BreadcrumbItem[]>(() => [
    { label: this.i18n.t('citizen.title'), link: '/citizen' },
    { label: this.reference() },
  ]);

  // ---------------------------------------------------------------------------
  // Presentation
  // ---------------------------------------------------------------------------

  protected filedOn(record: ServiceRequest): string {
    return this.i18n.t('citizen.detailSubtitle', {
      date: this.i18n.formatDate(record.submittedAt ?? record.createdAt),
    });
  }

  protected statusOf(record: ServiceRequest) {
    return requestStatusPresentation(record.status);
  }

  protected priorityOf(record: ServiceRequest) {
    return priorityPresentation(record.priority);
  }

  protected slaOf(record: ServiceRequest) {
    return slaPresentation(slaStateFor(record, this.now).status);
  }

  protected verificationOf(document: RequestDocument) {
    return verificationPresentation(document.verification);
  }

  protected stageSteps(record: ServiceRequest): readonly ProgressStep[] {
    return buildStageSteps(record, this.i18n);
  }

  protected historyItems(record: ServiceRequest): readonly TimelineItem[] {
    return buildHistoryItems(record, this.i18n);
  }

  protected serviceName(record: ServiceRequest): string {
    const service = serviceFor(record);
    return service ? this.i18n.pick(service.name) : this.i18n.t('common.notAvailable');
  }

  protected departmentName(record: ServiceRequest): string {
    const department = departmentFor(record);
    return department ? this.i18n.pick(department.name) : this.i18n.t('common.notAvailable');
  }

  protected currentStateName(record: ServiceRequest): string {
    return stateName(record, this.i18n);
  }

  protected requirementName(record: ServiceRequest, document: RequestDocument): string {
    const requirement = serviceFor(record)?.documents.find(
      (candidate) => candidate.id === document.requirementId,
    );
    return requirement ? this.i18n.pick(requirement.name) : this.i18n.t('documents.requirement');
  }

  /**
   * The answers as they were submitted, labelled from the service definition.
   *
   * Anything the catalogue no longer defines is still shown under its stored
   * key rather than dropped: a record that hides part of itself because the form
   * has since changed is not a record.
   */
  protected answers(record: ServiceRequest): readonly { id: string; label: string; value: string }[] {
    const service = serviceFor(record);
    const rows: { id: string; label: string; value: string }[] = [];

    for (const field of service?.fields ?? []) {
      rows.push({
        id: field.id,
        label: this.i18n.pick(field.label),
        value: this.answerValue(field, record.fieldValues[field.id] ?? ''),
      });
    }

    // Written onto the record by the wizard rather than by the service
    // definition, so it is labelled here.
    const phone = record.fieldValues['contactPhone'];
    if (phone) {
      rows.push({
        id: 'contactPhone',
        label: this.i18n.t('citizen.wizard.contactPhone'),
        value: phone,
      });
    }

    for (const [key, value] of Object.entries(record.fieldValues)) {
      if (key !== 'contactPhone' && !rows.some((row) => row.id === key)) {
        rows.push({ id: key, label: key, value });
      }
    }

    return rows;
  }

  private answerValue(field: ServiceField, raw: string): string {
    const value = raw.trim();
    if (value === '') {
      return this.i18n.t('common.notSet');
    }
    switch (field.type) {
      case 'select': {
        const option = field.options.find((candidate) => candidate.value === value);
        return option ? this.i18n.pick(option.label) : value;
      }
      case 'date': {
        const day = toCalendarDay(value);
        return day ? this.i18n.formatDate(day) : value;
      }
      case 'number': {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : this.i18n.formatNumber(parsed);
      }
      default:
        return value;
    }
  }

  protected slaCounter(record: ServiceRequest): string | null {
    const state = slaStateFor(record, this.now);
    if (state.remainingMs === null) {
      return null;
    }
    const time = this.i18n.formatDuration(state.remainingMs);
    return state.remainingMs < 0
      ? this.i18n.t('sla.overdue', { time })
      : this.i18n.t('sla.remaining', { time });
  }

  protected slaExplanation(record: ServiceRequest): string | null {
    switch (slaStateFor(record, this.now).status) {
      case 'atRisk':
        return this.i18n.t('sla.atRiskExplanation');
      case 'breached':
        return this.i18n.t('sla.breachedExplanation');
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // The more information loop
  // ---------------------------------------------------------------------------

  protected responseError(): string | null {
    return validationMessage(this.responseBody, this.i18n.t('citizen.respond'), this.i18n);
  }

  protected responseAccepted(): string {
    return this.i18n.t('citizen.wizard.accepted', {
      formats: formatAcceptedFormats(RESPONSE_FORMATS),
      size: this.i18n.formatFileSize(5 * 1024),
    });
  }

  protected chooseResponseFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) {
      this.responseFile.set({
        fileName: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
      });
    }
  }

  protected clearResponseFile(): void {
    this.responseFile.set(null);
  }

  /**
   * Applies the transition the published workflow offers a citizen from the
   * "more information" state. The key is read off the definition rather than
   * assumed, so a workflow that renames it keeps working.
   */
  protected async sendResponse(event: Event, record: ServiceRequest): Promise<void> {
    event.preventDefault();
    this.responseBody.markAsTouched();
    if (this.responseBody.invalid) {
      this.host.nativeElement.querySelector<HTMLElement>(`#${this.responseId} textarea`)?.focus();
      return;
    }

    const transition = this.responseTransition(record);
    const actor = this.auth.user();
    if (!transition || !actor) {
      this.responseFailed.set(true);
      return;
    }

    this.responding.set(true);
    this.responseFailed.set(false);
    try {
      const updated = await this.gateway.applyTransition({
        requestId: record.id,
        transitionKey: transition.key,
        actor,
        comment: this.responseComment(),
        internalComment: false,
      });

      this.responseBody.reset('');
      this.responseFile.set(null);
      this.toasts.success(
        this.i18n.t('toast.transitionApplied', { state: stateName(updated, this.i18n) }),
      );
      // Re-read rather than patch, so the page shows what the service now holds.
      this.request.reload();
    } catch {
      this.responseFailed.set(true);
    } finally {
      this.responding.set(false);
    }
  }

  private responseTransition(record: ServiceRequest): WorkflowTransition | null {
    const available = availableTransitions(record, 'citizen');
    return (
      available.find((transition) => transition.key === INFORMATION_PROVIDED) ??
      available[0] ??
      null
    );
  }

  /**
   * The chosen file cannot be transmitted by this build, so it is recorded by
   * name on the comment rather than being silently dropped. The officer sees
   * exactly what the applicant said they were providing.
   */
  private responseComment(): string {
    const body = this.responseBody.value.trim();
    const chosen = this.responseFile();
    if (!chosen) {
      return body;
    }
    return `${body}\n${this.i18n.t('common.attachment')}: ${chosen.fileName}`;
  }

  protected goToList(): void {
    void this.router.navigate(['/citizen']);
  }
}

/** `yyyy-mm-dd` as a calendar day, so it does not slip a day across midnight. */
function toCalendarDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
