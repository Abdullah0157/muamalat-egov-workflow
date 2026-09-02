import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { AuthService } from '../../core/auth/auth.service';
import { findUser } from '../../core/auth/demo-users';
import { DataGateway, TransitionNotAllowedError } from '../../core/data/data-gateway';
import { slaStateFor } from '../../core/data/sla';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  DocumentVerification,
  RequestDocument,
  ServiceRequest,
  SlaState,
  TransitionKind,
  WorkflowTransition,
} from '../../core/models/domain';
import { Alert } from '../../shared/ui/alert/alert';
import { Badge } from '../../shared/ui/badge/badge';
import { BreadcrumbItem, Breadcrumbs } from '../../shared/ui/breadcrumbs/breadcrumbs';
import { Button, ButtonVariant } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Checkbox } from '../../shared/ui/checkbox/checkbox';
import { ConfirmDialog, ConfirmTone } from '../../shared/ui/dialog/confirm-dialog';
import { Dialog } from '../../shared/ui/dialog/dialog';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { Icon, IconName } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import {
  priorityPresentation,
  requestStatusPresentation,
  slaPresentation,
  transitionPresentation,
  verificationPresentation,
} from '../../shared/ui/status/status-presentation';
import { Textarea } from '../../shared/ui/textarea/textarea';
import { Timeline } from '../../shared/ui/timeline/timeline';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  allRequiredDocumentsVerified,
  buildHistoryItems,
  availableTransitions,
  serviceFor,
  stateName,
  stateNameByKey,
  versionFor,
  waitingOnRole,
} from '../shared/request-presentation';

/** The one guard the published workflows use, and the one this screen can explain. */
const DOCUMENTS_GUARD = 'allRequiredDocumentsVerified';

/** One submitted answer, paired with the question the service definition asked. */
interface FieldRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

/** One attachment, paired with the requirement it was filed against. */
interface DocumentRow {
  readonly document: RequestDocument;
  readonly requirement: string;
  readonly required: boolean;
}

/**
 * A transition as it is offered to the officer.
 *
 * `blockedReason` is the important field. A workflow can refuse an action for
 * two reasons the officer can actually fix, and a button that is simply dead
 * teaches people to hunt rather than to act, so the reason travels with the
 * button instead of being implied by its disabled state.
 */
interface TransitionAction {
  readonly transition: WorkflowTransition;
  readonly label: string;
  readonly variant: ButtonVariant;
  readonly icon: IconName;
  readonly targetState: string;
  readonly blockedReason: string | null;
  readonly needsComment: boolean;
}

/**
 * The case file.
 *
 * This is the screen an officer lives in, so it is laid out as a document with
 * a rail rather than as a dashboard: everything that describes the case reads
 * down the main column in the order it would be checked, and everything that
 * changes the case sits together in the rail. Nothing is applied without a
 * confirmation that names the action, the file and the stage it moves to, so
 * the outcome of a button is knowable before it is pressed.
 */
@Component({
  selector: 'app-case-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    Alert,
    Badge,
    Breadcrumbs,
    Button,
    Card,
    Checkbox,
    ConfirmDialog,
    Dialog,
    EmptyState,
    ErrorState,
    Icon,
    PageHeader,
    Skeleton,
    Textarea,
    Timeline,
  ],
  styleUrl: './case-detail-page.scss',
  host: { class: 'page' },
  template: `
    <app-page-header [heading]="i18n.t('officer.detailTitle', { reference: reference() })">
      <app-breadcrumbs pageHeaderBreadcrumbs [items]="crumbs()" />

      <div pageHeaderMeta class="case__chips">
        @if (caseFile(); as file) {
          <app-badge
            [tone]="statusPresentation(file).tone"
            [icon]="statusPresentation(file).icon"
          >
            {{ i18n.t(statusPresentation(file).labelKey) }}
          </app-badge>

          <app-badge
            [tone]="priorityTone(file)"
            [icon]="priorityIcon(file)"
          >
            {{ i18n.t('priority.' + file.priority) }}
          </app-badge>

          <span class="case__sla">
            <app-badge [tone]="slaTone()" [icon]="slaIcon()">{{ i18n.t(slaLabelKey()) }}</app-badge>
            @if (slaCountdown(); as countdown) {
              <span class="case__sla-countdown u-numeric">{{ countdown }}</span>
            }
          </span>

          <app-badge tone="neutral" icon="workflow">{{ currentStateName() }}</app-badge>

          <app-badge tone="neutral" icon="user">{{ assigneeLabel() }}</app-badge>
        }
      </div>

      <div pageHeaderActions>
        @if (canAssign()) {
          <app-button
            variant="primary"
            icon="user"
            [busy]="assigning()"
            (pressed)="assignToMe()"
          >
            {{ i18n.t('officer.assignToMe') }}
          </app-button>
        }
      </div>
    </app-page-header>

    @if (isFirstLoad()) {
      <div class="case__layout">
        <div class="u-stack-lg">
          @for (placeholder of skeletonCards; track placeholder) {
            <app-card [hasHeader]="false">
              <app-skeleton variant="heading" width="12rem" />
              <app-skeleton [lines]="4" />
            </app-card>
          }
        </div>
        <div class="u-stack-lg">
          <app-card [hasHeader]="false">
            <app-skeleton variant="heading" width="8rem" />
            <app-skeleton variant="block" height="7rem" label="" />
          </app-card>
        </div>
      </div>
    } @else if (request.error()) {
      <app-card [hasHeader]="false">
        <app-error-state
          [title]="i18n.t('errors.loadRequestTitle')"
          [description]="i18n.t('errors.loadRequestDescription')"
          (retry)="request.reload()"
        />
      </app-card>
    } @else if (caseFile() === null) {
      <app-card [hasHeader]="false">
        <app-error-state
          tone="notFound"
          [retryable]="false"
          [title]="i18n.t('errors.requestNotFoundTitle')"
          [description]="i18n.t('errors.requestNotFoundDescription', { reference: reference() })"
        />
      </app-card>
    } @else if (caseFile(); as file) {
      <div class="case__layout" [attr.aria-busy]="request.isLoading() ? 'true' : null">
        <!-- Main column: the file, read in the order it is checked. -->
        <div class="u-stack-lg">
          <app-card>
            <span cardTitle>{{ i18n.t('officer.applicantSection') }}</span>
            <dl class="u-fields">
              <div>
                <dt>{{ i18n.t('common.applicant') }}</dt>
                <dd>{{ i18n.pick(file.applicantName) }}</dd>
              </div>
              <div>
                <dt>{{ i18n.t('auth.civilId') }}</dt>
                <dd><span class="u-reference">{{ applicantCivilId() }}</span></dd>
              </div>
              @if (contactPhone(); as phone) {
                <div>
                  <dt>{{ i18n.t('officer.contactPhone') }}</dt>
                  <dd><span class="u-reference">{{ phone }}</span></dd>
                </div>
              }
            </dl>
          </app-card>

          <app-card>
            <span cardTitle>{{ i18n.t('officer.applicationSection') }}</span>
            <span cardSubtitle>{{ serviceName() }}</span>
            <dl class="u-fields">
              @for (field of fieldRows(); track field.id) {
                <div>
                  <dt>{{ field.label }}</dt>
                  <dd>{{ field.value }}</dd>
                </div>
              }
            </dl>
          </app-card>

          <app-card>
            <span cardTitle>{{ i18n.t('officer.documentsSection') }}</span>
            <span cardSubtitle>{{ i18n.t('officer.documentsHint') }}</span>

            <p
              cardActions
              class="documents__progress"
              [class.documents__progress--complete]="documentsComplete()"
              aria-live="polite"
            >
              <app-icon [name]="documentsComplete() ? 'check-circle' : 'file-check'" size="sm" />
              <!--
                One sentence rather than a bare fraction: this is read out by a
                live region after every verification, and "3 / 4" on its own is
                not something anyone can act on.
              -->
              <span class="u-numeric">
                {{
                  i18n.t('officer.documentsVerifiedCount', {
                    verified: i18n.formatNumber(verifiedRequiredCount()),
                    required: i18n.formatNumber(requiredDocumentCount()),
                  })
                }}
              </span>
            </p>

            @if (documentRows().length === 0) {
              <app-empty-state
                icon="paperclip"
                [title]="i18n.t('empty.noDocumentsTitle')"
                [description]="i18n.t('empty.noDocumentsDescription')"
              />
            } @else {
              <ul class="documents__list">
                @for (row of documentRows(); track row.document.id) {
                  <li class="documents__item">
                    <div class="documents__detail">
                      <p class="documents__name">
                        <span>{{ row.requirement }}</span>
                        @if (row.required) {
                          <span class="documents__required u-meta">
                            {{ i18n.t('common.required') }}
                          </span>
                        }
                      </p>
                      <p class="documents__file u-meta">
                        <span class="u-reference">{{ row.document.fileName }}</span>
                        <span>{{ i18n.formatFileSize(row.document.sizeKb) }}</span>
                        <span>
                          {{
                            i18n.t('documents.uploadedOn', {
                              date: i18n.formatDate(row.document.uploadedAt),
                            })
                          }}
                        </span>
                      </p>
                      @if (row.document.note; as note) {
                        <p class="documents__note">
                          <span class="u-strong">{{ i18n.t('documents.rejectedReason') }}:</span>
                          {{ note }}
                        </p>
                      }
                    </div>

                    <div class="documents__state">
                      <app-badge
                        size="sm"
                        [tone]="verificationTone(row.document.verification)"
                        [icon]="verificationIcon(row.document.verification)"
                      >
                        {{ i18n.t(verificationLabelKey(row.document.verification)) }}
                      </app-badge>
                    </div>

                    <div class="documents__actions">
                      <app-button
                        size="sm"
                        variant="secondary"
                        icon="check"
                        [disabled]="row.document.verification === 'verified'"
                        [busy]="busyDocumentId() === row.document.id"
                        (pressed)="verifyDocument(row.document)"
                      >
                        {{ i18n.t('officer.verify') }}
                      </app-button>
                      <app-button
                        size="sm"
                        variant="ghost"
                        icon="x-circle"
                        [disabled]="row.document.verification === 'rejected'"
                        (pressed)="openReject(row.document)"
                      >
                        {{ i18n.t('officer.reject') }}
                      </app-button>
                    </div>
                  </li>
                }
              </ul>
            }
          </app-card>

          <app-card>
            <span cardTitle>{{ i18n.t('common.history') }}</span>
            <app-timeline dense [items]="historyItems()" />
          </app-card>
        </div>

        <!-- Rail: everything that changes the case, in one place. -->
        <div class="case__rail u-stack-lg">
          <app-card>
            <span cardTitle>{{ i18n.t('officer.actionsSection') }}</span>
            <span cardSubtitle>{{ i18n.t('officer.actionsHint') }}</span>

            @if (actionFailed()) {
              <app-alert tone="danger" [heading]="i18n.t('errors.actionFailedTitle')">
                {{ i18n.t('errors.actionFailedDescription') }}
              </app-alert>
            }

            @if (actions().length === 0) {
              <app-empty-state
                icon="lock"
                [title]="i18n.t('officer.noActionsTitle')"
                [description]="noActionsDescription()"
              />
            } @else {
              <ul class="actions__list">
                @for (action of actions(); track action.transition.key) {
                  <li class="actions__item">
                    <app-button
                      block
                      [variant]="action.variant"
                      [icon]="action.icon"
                      [disabled]="action.blockedReason !== null"
                      [busy]="busyTransitionKey() === action.transition.key"
                      (pressed)="askToApply(action)"
                    >
                      {{ action.label }}
                    </app-button>

                    <p class="actions__target u-meta">
                      <app-icon name="arrow-next" size="sm" />
                      <span>{{ action.targetState }}</span>
                    </p>

                    @if (action.blockedReason; as reason) {
                      <div class="actions__blocked">
                        <p class="actions__reason">
                          <app-icon name="alert-circle" size="sm" />
                          <span>{{ reason }}</span>
                        </p>
                        @if (action.needsComment) {
                          <app-button variant="link" size="sm" (pressed)="focusComment()">
                            {{ i18n.t('officer.commentSection') }}
                          </app-button>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            }
          </app-card>

          <app-card #commentBox>
            <span cardTitle>{{ i18n.t('officer.commentSection') }}</span>

            <div class="u-stack">
              <app-textarea
                autoGrow
                [rows]="4"
                [maxLength]="1000"
                [formControl]="commentControl"
                [label]="i18n.t('common.comment')"
                [placeholder]="i18n.t('officer.commentPlaceholder')"
              />

              <app-checkbox
                [formControl]="internalControl"
                [label]="i18n.t('officer.internalComment')"
              />

              <app-button
                variant="secondary"
                icon="comment"
                [disabled]="commentText().trim() === ''"
                [busy]="savingComment()"
                (pressed)="addComment()"
              >
                {{ i18n.t('officer.addComment') }}
              </app-button>
            </div>
          </app-card>
        </div>
      </div>

      <!--
        Confirmation names the action, the file and the stage it lands in, and
        repeats the comment that will be recorded, so nothing about the outcome
        is a surprise.
      -->
      <app-confirm-dialog
        [(open)]="confirmOpen"
        [title]="confirmTitle()"
        [description]="confirmDescription()"
        [confirmLabel]="pendingAction()?.label ?? null"
        [tone]="confirmTone()"
        (confirmed)="applyPending()"
        (cancelled)="pendingAction.set(null)"
      >
        @if (commentText().trim(); as body) {
          <dl class="u-fields case__confirm">
            <div>
              <dt>{{ i18n.t('common.comment') }}</dt>
              <dd>{{ body }}</dd>
            </div>
            @if (internalComment()) {
              <div>
                <dt>{{ i18n.t('common.detail') }}</dt>
                <dd>{{ i18n.t('officer.internalComment') }}</dd>
              </div>
            }
          </dl>
        }
      </app-confirm-dialog>

      <app-dialog
        size="sm"
        [(open)]="rejectOpen"
        [title]="i18n.t('officer.rejectDocumentTitle')"
        [description]="i18n.t('officer.rejectDocumentHint')"
        (closed)="resetReject()"
      >
        <app-textarea
          dialogAutofocus
          required
          [rows]="4"
          [maxLength]="500"
          [formControl]="rejectNoteControl"
          [label]="i18n.t('documents.rejectedReason')"
          [error]="rejectError()"
        />

        <app-button dialogFooter variant="secondary" (pressed)="rejectOpen.set(false)">
          {{ i18n.t('common.cancel') }}
        </app-button>
        <app-button
          dialogFooter
          variant="danger"
          icon="x-circle"
          [busy]="busyDocumentId() !== null"
          (pressed)="confirmReject()"
        >
          {{ i18n.t('officer.reject') }}
        </app-button>
      </app-dialog>
    }
  `,
})
export class CaseDetailPage {
  /** The public reference from the route, not the internal id. */
  readonly reference = input.required<string>();

  protected readonly i18n = inject(I18nService);
  private readonly gateway = inject(DataGateway);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly skeletonCards = [0, 1, 2];

  protected readonly request = resource({
    params: () => ({ reference: this.reference() }),
    loader: ({ params }) => this.gateway.getRequest(params.reference),
    defaultValue: null as ServiceRequest | null,
  });

  // Reactive form controls so the comment can be cleared once it has been
  // recorded, and so the same value can feed both the comment button and a
  // transition that requires a justification.
  protected readonly commentControl = new FormControl('', { nonNullable: true });
  protected readonly internalControl = new FormControl(false, { nonNullable: true });
  protected readonly rejectNoteControl = new FormControl('', { nonNullable: true });

  protected readonly commentText = toSignal(this.commentControl.valueChanges, {
    initialValue: '',
  });
  protected readonly internalComment = toSignal(this.internalControl.valueChanges, {
    initialValue: false,
  });
  private readonly rejectNote = toSignal(this.rejectNoteControl.valueChanges, { initialValue: '' });

  protected readonly assigning = signal(false);
  protected readonly savingComment = signal(false);
  protected readonly busyTransitionKey = signal<string | null>(null);
  protected readonly busyDocumentId = signal<string | null>(null);

  /**
   * Set when the workflow service refuses a transition. The case is left exactly
   * as it was and the alert says so, because silently reloading after a refusal
   * makes it look as though something happened.
   */
  protected readonly actionFailed = signal(false);

  protected readonly confirmOpen = signal(false);
  protected readonly pendingAction = signal<TransitionAction | null>(null);

  protected readonly rejectOpen = signal(false);
  private readonly rejectTarget = signal<RequestDocument | null>(null);
  private readonly rejectAttempted = signal(false);

  // Read as an element rather than as the card component: the target is the
  // textarea inside it, and only the host element knows where that is.
  private readonly commentBox = viewChild('commentBox', { read: ElementRef });

  /** Null while loading, while in error, and when the reference matches nothing. */
  protected readonly caseFile = computed<ServiceRequest | null>(() =>
    this.request.error() ? null : this.request.value(),
  );

  /**
   * Skeletons only stand in for the first load. A reload after a verification
   * or a transition keeps the file on screen and marks it busy, because tearing
   * the case down and rebuilding it after every action loses the officer's
   * place in a long document.
   */
  protected readonly isFirstLoad = computed(() => this.request.status() === 'loading');

  protected readonly crumbs = computed<readonly BreadcrumbItem[]>(() => [
    { label: this.i18n.t('officer.title'), link: '/officer' },
    { label: this.reference() },
  ]);

  /**
   * Measured once per loaded record rather than per chip, so the header and the
   * countdown beside it cannot disagree by a render.
   */
  private readonly sla = computed<SlaState | null>(() => {
    const file = this.caseFile();
    return file === null ? null : slaStateFor(file, new Date());
  });

  protected readonly currentStateName = computed(() => {
    const file = this.caseFile();
    return file === null ? '' : stateName(file, this.i18n);
  });

  protected readonly serviceName = computed(() => {
    const file = this.caseFile();
    return file === null ? '' : this.i18n.pick(serviceFor(file)?.name);
  });

  protected readonly applicantCivilId = computed(() => {
    const file = this.caseFile();
    const applicant = file === null ? undefined : findUser(file.applicantId);
    return applicant?.civilId ?? this.i18n.t('common.notAvailable');
  });

  /** Filed by the citizen wizard alongside the service questions, when given. */
  protected readonly contactPhone = computed(() => {
    const file = this.caseFile();
    return file?.fieldValues['contactPhone'] ?? null;
  });

  protected readonly assigneeLabel = computed(() => {
    const file = this.caseFile();
    if (!file || file.assigneeId === null) {
      return this.i18n.t('common.unassigned');
    }
    if (file.assigneeId === this.auth.user()?.id) {
      return this.i18n.t('officer.filters.assignedToMe');
    }
    const holder = findUser(file.assigneeId);
    return holder ? this.i18n.pick(holder.name) : this.i18n.t('common.assignee');
  });

  protected readonly canAssign = computed(
    () => this.caseFile()?.assigneeId === null && this.auth.user() !== null,
  );

  /**
   * The submitted answers in the order the service asked them, with select
   * values resolved back to their labels and dates and numbers formatted, so
   * the officer reads the application rather than the storage format.
   */
  protected readonly fieldRows = computed<readonly FieldRow[]>(() => {
    const file = this.caseFile();
    const service = file === null ? undefined : serviceFor(file);
    if (!file || !service) {
      return [];
    }
    return service.fields
      .filter((field) => (file.fieldValues[field.id] ?? '') !== '')
      .map((field) => {
        const raw = file.fieldValues[field.id];
        let value = raw;
        if (field.type === 'select') {
          const option = field.options.find((candidate) => candidate.value === raw);
          value = option ? this.i18n.pick(option.label) : raw;
        } else if (field.type === 'date') {
          value = this.i18n.formatDate(raw);
        } else if (field.type === 'number') {
          value = this.i18n.formatNumber(Number(raw));
        }
        return { id: field.id, label: this.i18n.pick(field.label), value };
      });
  });

  protected readonly documentRows = computed<readonly DocumentRow[]>(() => {
    const file = this.caseFile();
    const service = file === null ? undefined : serviceFor(file);
    if (!file) {
      return [];
    }
    return file.documents.map((document) => {
      const requirement = service?.documents.find(
        (candidate) => candidate.id === document.requirementId,
      );
      return {
        document,
        requirement: requirement ? this.i18n.pick(requirement.name) : document.requirementId,
        required: requirement?.required ?? false,
      };
    });
  });

  protected readonly requiredDocumentCount = computed(
    () => this.documentRows().filter((row) => row.required).length,
  );

  protected readonly verifiedRequiredCount = computed(
    () =>
      this.documentRows().filter(
        (row) => row.required && row.document.verification === 'verified',
      ).length,
  );

  /** The condition the "documents verified" transition is guarded on. */
  protected readonly documentsComplete = computed(() => {
    const file = this.caseFile();
    return file !== null && allRequiredDocumentsVerified(file);
  });

  protected readonly historyItems = computed(() => {
    const file = this.caseFile();
    return file === null ? [] : buildHistoryItems(file, this.i18n);
  });

  /**
   * What the published workflow allows this role to do from here, with the
   * reason attached wherever the action is not yet applicable.
   */
  protected readonly actions = computed<readonly TransitionAction[]>(() => {
    const file = this.caseFile();
    if (file === null) {
      return [];
    }
    const version = versionFor(file);
    const hasComment = this.commentText().trim() !== '';
    const documentsVerified = this.documentsComplete();

    return availableTransitions(file, this.auth.role()).map((transition) => {
      const presentation = transitionPresentation(transition.kind);
      let blockedReason: string | null = null;
      if (transition.guard === DOCUMENTS_GUARD && !documentsVerified) {
        blockedReason = this.i18n.t('officer.documentsRequiredBlocked');
      } else if (transition.requiresComment && !hasComment) {
        blockedReason = this.i18n.t('validation.commentRequired');
      }

      return {
        transition,
        label: this.i18n.pick(transition.label),
        variant: transitionVariant(transition.kind),
        icon: presentation.icon,
        targetState: stateNameByKey(version, transition.toStateKey, this.i18n),
        blockedReason,
        needsComment: transition.requiresComment && !hasComment,
      };
    });
  });

  /** Named so the panel can say who the case is with instead of showing nothing. */
  protected readonly noActionsDescription = computed(() => {
    const file = this.caseFile();
    const role = file === null ? null : waitingOnRole(file);
    return role === null
      ? null
      : this.i18n.t('officer.noActionsDescription', { role: this.i18n.t(`roles.${role}`) });
  });

  protected readonly confirmTitle = computed(() => {
    const action = this.pendingAction();
    return action === null
      ? ''
      : this.i18n.t('officer.confirmActionTitle', { action: action.label });
  });

  protected readonly confirmDescription = computed(() => {
    const action = this.pendingAction();
    const file = this.caseFile();
    if (action === null || file === null) {
      return null;
    }
    return this.i18n.t('officer.confirmActionDescription', {
      reference: file.reference,
      state: action.targetState,
    });
  });

  protected readonly confirmTone = computed<ConfirmTone>(() =>
    this.pendingAction()?.transition.kind === 'reject' ? 'danger' : 'default',
  );

  protected readonly rejectError = computed(() =>
    this.rejectAttempted() && this.rejectNote().trim() === ''
      ? this.i18n.t('validation.required', { field: this.i18n.t('documents.rejectedReason') })
      : null,
  );

  // ---------------------------------------------------------------------------
  // Presentation helpers
  // ---------------------------------------------------------------------------

  protected statusPresentation(file: ServiceRequest) {
    return requestStatusPresentation(file.status);
  }

  protected priorityTone(file: ServiceRequest) {
    return priorityPresentation(file.priority).tone;
  }

  protected priorityIcon(file: ServiceRequest) {
    return priorityPresentation(file.priority).icon;
  }

  protected slaTone() {
    return slaPresentation(this.sla()?.status ?? 'notApplicable').tone;
  }

  protected slaIcon() {
    return slaPresentation(this.sla()?.status ?? 'notApplicable').icon;
  }

  protected slaLabelKey(): string {
    return slaPresentation(this.sla()?.status ?? 'notApplicable').labelKey;
  }

  protected slaCountdown(): string | null {
    const remaining = this.sla()?.remainingMs ?? null;
    if (remaining === null) {
      return null;
    }
    const time = this.i18n.formatDuration(Math.abs(remaining));
    return remaining >= 0
      ? this.i18n.t('sla.remaining', { time })
      : this.i18n.t('sla.overdue', { time });
  }

  protected verificationTone(state: DocumentVerification) {
    return verificationPresentation(state).tone;
  }

  protected verificationIcon(state: DocumentVerification) {
    return verificationPresentation(state).icon;
  }

  protected verificationLabelKey(state: DocumentVerification): string {
    return verificationPresentation(state).labelKey;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  protected async assignToMe(): Promise<void> {
    const file = this.caseFile();
    const actor = this.auth.user();
    if (!file || !actor) {
      return;
    }
    this.assigning.set(true);
    try {
      await this.gateway.assignRequest(file.id, actor.id);
      this.request.reload();
    } finally {
      this.assigning.set(false);
    }
  }

  /** Moves focus to the box the blocked transition is waiting on. */
  protected focusComment(): void {
    const host = this.commentBox()?.nativeElement as HTMLElement | undefined;
    const control = host?.querySelector('textarea');
    control?.scrollIntoView({ block: 'nearest' });
    control?.focus();
  }

  protected askToApply(action: TransitionAction): void {
    if (action.blockedReason !== null) {
      return;
    }
    this.actionFailed.set(false);
    this.pendingAction.set(action);
    this.confirmOpen.set(true);
  }

  protected async applyPending(): Promise<void> {
    const action = this.pendingAction();
    const file = this.caseFile();
    const actor = this.auth.user();
    if (!action || !file || !actor) {
      return;
    }

    const comment = this.commentText().trim();
    this.busyTransitionKey.set(action.transition.key);
    try {
      const updated = await this.gateway.applyTransition({
        requestId: file.id,
        transitionKey: action.transition.key,
        actor,
        comment: comment === '' ? null : comment,
        internalComment: this.internalComment(),
      });
      this.toast.success(
        this.i18n.t('toast.transitionApplied', { state: stateName(updated, this.i18n) }),
      );
      // The comment has been recorded against the case, so the box is emptied
      // rather than left to be attached to the next action by accident.
      this.commentControl.setValue('');
      this.internalControl.setValue(false);
      this.request.reload();
    } catch (error) {
      // Every failure leaves the record untouched, so they all read the same to
      // the officer: the action was not applied and the case is where it was.
      // `TransitionNotAllowedError` is the one the workflow raises by design.
      this.actionFailed.set(true);
      if (!(error instanceof TransitionNotAllowedError)) {
        console.error(error);
      }
    } finally {
      this.busyTransitionKey.set(null);
      this.pendingAction.set(null);
    }
  }

  protected async addComment(): Promise<void> {
    const file = this.caseFile();
    const author = this.auth.user();
    const body = this.commentText().trim();
    if (!file || !author || body === '') {
      return;
    }
    this.savingComment.set(true);
    try {
      await this.gateway.addComment({
        requestId: file.id,
        author,
        body,
        internal: this.internalComment(),
      });
      this.toast.success(this.i18n.t('toast.commentAdded'));
      this.commentControl.setValue('');
      this.internalControl.setValue(false);
      this.request.reload();
    } finally {
      this.savingComment.set(false);
    }
  }

  protected async verifyDocument(document: RequestDocument): Promise<void> {
    await this.setVerification(document, 'verified', null);
    this.toast.success(this.i18n.t('toast.documentVerified'));
  }

  protected openReject(document: RequestDocument): void {
    this.rejectTarget.set(document);
    this.rejectAttempted.set(false);
    this.rejectNoteControl.setValue('');
    this.rejectOpen.set(true);
  }

  protected async confirmReject(): Promise<void> {
    const document = this.rejectTarget();
    const note = this.rejectNote().trim();
    this.rejectAttempted.set(true);
    if (!document || note === '') {
      return;
    }
    await this.setVerification(document, 'rejected', note);
    this.toast.success(this.i18n.t('toast.documentRejected'));
    this.rejectOpen.set(false);
  }

  protected resetReject(): void {
    this.rejectTarget.set(null);
    this.rejectAttempted.set(false);
    this.rejectNoteControl.setValue('');
  }

  private async setVerification(
    document: RequestDocument,
    verification: DocumentVerification,
    note: string | null,
  ): Promise<void> {
    const file = this.caseFile();
    const actor = this.auth.user();
    if (!file || !actor) {
      return;
    }
    this.busyDocumentId.set(document.id);
    try {
      await this.gateway.setDocumentVerification({
        requestId: file.id,
        documentId: document.id,
        actor,
        verification,
        note,
      });
      this.request.reload();
    } finally {
      this.busyDocumentId.set(null);
    }
  }
}

/**
 * The button treatment follows the kind of transition, so the same decision
 * always looks the same across every workflow: advancing is the primary action,
 * refusing is destructive, and asking for more or escalating are neither.
 */
function transitionVariant(kind: TransitionKind): ButtonVariant {
  switch (kind) {
    case 'forward':
      return 'primary';
    case 'reject':
      return 'danger';
    case 'moreInfo':
    case 'escalate':
      return 'secondary';
  }
}
