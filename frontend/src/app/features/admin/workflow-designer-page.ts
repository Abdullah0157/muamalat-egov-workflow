import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { DataGateway } from '../../core/data/data-gateway';
import { publishedVersion } from '../../core/data/workflow-definitions';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  ALL_ROLES,
  Role,
  WORKFLOW_STAGES,
  WorkflowDefinition,
  WorkflowStage,
  WorkflowState,
  WorkflowStateKind,
  WorkflowTransition,
  WorkflowVersion,
  WorkflowVersionStatus,
} from '../../core/models/domain';
import { validationMessage } from '../../shared/forms/validation-messages';
import { Alert } from '../../shared/ui/alert/alert';
import { Badge, BadgeTone } from '../../shared/ui/badge/badge';
import { BreadcrumbItem, Breadcrumbs } from '../../shared/ui/breadcrumbs/breadcrumbs';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Checkbox } from '../../shared/ui/checkbox/checkbox';
import { ConfirmDialog } from '../../shared/ui/dialog/confirm-dialog';
import { Drawer } from '../../shared/ui/drawer/drawer';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { errorIdFor, nextControlId } from '../../shared/ui/field/field';
import { Icon, IconName } from '../../shared/ui/icon/icon';
import { IconButton } from '../../shared/ui/icon-button/icon-button';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Select, SelectOption } from '../../shared/ui/select/select';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { TextField } from '../../shared/ui/text-field/text-field';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { WorkflowCanvas } from './workflow-canvas';
import {
  TRANSITION_KINDS,
  ValidationFinding,
  WORKFLOW_STATE_KINDS,
  isOnlyStartState,
  nextFreeColumn,
  nextStateId,
  nextTransitionId,
  transitionsTouching,
  validateWorkflow,
  withState,
  withTransition,
  withoutState,
  withoutTransition,
} from './workflow-model';

/** Which record the editor panel is open on. A null id means "being added". */
type EditorTarget =
  | { readonly kind: 'state'; readonly id: string | null }
  | { readonly kind: 'transition'; readonly id: string | null };

/**
 * Lower camel or kebab, no spaces, never starting with a digit. Running cases
 * quote these keys, so they have to survive being written into a URL, a log line
 * and a database column without being escaped.
 */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$/;

/** Grid cells are whole cells. 1.5 is not a column. */
function wholeNumber(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = String(control.value ?? '').trim();
    if (raw === '') {
      return null;
    }
    return Number.isInteger(Number(raw)) ? null : { numeric: true };
  };
}

/** A transition nobody is allowed to take is a transition that does not exist. */
function atLeastOneRole(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as Record<string, boolean> | null;
    return value && Object.values(value).some(Boolean) ? null : { required: true };
  };
}

const STATUS_ICON: Readonly<Record<WorkflowVersionStatus, IconName>> = {
  draft: 'edit',
  published: 'check-circle',
  archived: 'folder',
};

/**
 * The workflow designer.
 *
 * This is an editor, not a picture of one. The diagram, the two lists under it
 * and the forms in the panel are three views of a single draft held in one
 * signal; every edit replaces that draft with a new immutable version, so the
 * canvas, the validation panel and the unsaved marker cannot disagree about what
 * is on screen.
 *
 * A published or archived version is read only. That is not politeness: cases
 * are running against those definitions right now, and a workflow whose states
 * changed underneath a live case has nowhere to put it. Changes are made in a
 * draft and published as a new version, which is also why the version picker is
 * the first control on the page rather than a detail at the bottom.
 *
 * Position is edited as two numbers and there is no drag and drop. Dragging is
 * unusable from a keyboard without a second, parallel set of commands, a canvas
 * that must read correctly in two writing directions cannot also be a freeform
 * pinboard, and a column of `3` in a diff is reviewable in a way that a pixel
 * offset never is.
 */
@Component({
  selector: 'app-workflow-designer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Alert,
    Badge,
    Breadcrumbs,
    Button,
    Card,
    Checkbox,
    ConfirmDialog,
    Drawer,
    EmptyState,
    ErrorState,
    Icon,
    IconButton,
    PageHeader,
    ReactiveFormsModule,
    Select,
    Skeleton,
    TextField,
    WorkflowCanvas,
  ],
  styleUrl: './workflow-designer-page.scss',
  host: { class: 'page' },
  template: `
    @if (loading()) {
      <div class="designer__loading">
        <app-skeleton variant="heading" width="22rem" label="" />
        <app-skeleton variant="block" height="4.5rem" />
        <app-skeleton variant="block" height="22rem" />
      </div>
    } @else if (workflow.error()) {
      <app-error-state
        [title]="i18n.t('errors.loadWorkflowsTitle')"
        [description]="i18n.t('errors.loadWorkflowsDescription')"
        (retry)="workflow.reload()"
      />
    } @else if (definition(); as definition) {
      <app-page-header
        [heading]="i18n.t('admin.designerTitle', { name: i18n.pick(definition.name) })"
        [description]="headerDescription()"
      >
        <app-breadcrumbs pageHeaderBreadcrumbs [items]="crumbs()" />

        <div pageHeaderMeta class="u-cluster">
          @if (draft(); as version) {
            <app-badge
              size="sm"
              [tone]="statusTone(version.status)"
              [icon]="statusIcon(version.status)"
            >
              {{ i18n.t('admin.versionStatus.' + version.status) }}
            </app-badge>
          }
          <span class="u-meta">
            {{ i18n.t('admin.runningCases', { count: i18n.formatNumber(runningCaseCount()) }) }}
          </span>
          @if (unsaved()) {
            <app-badge size="sm" tone="warning" icon="alert-circle">
              {{ i18n.t('admin.unsavedChanges') }}
            </app-badge>
          }
        </div>

        <div pageHeaderActions class="u-cluster">
          @if (!readOnly()) {
            <app-button
              variant="secondary"
              icon="return-loop"
              [disabled]="!unsaved()"
              (pressed)="discardOpen.set(true)"
            >
              {{ i18n.t('admin.discardChanges') }}
            </app-button>
            <app-button
              variant="primary"
              icon="check"
              [busy]="saving()"
              [disabled]="!unsaved()"
              (pressed)="saveDraft()"
            >
              {{ i18n.t('admin.saveDraft') }}
            </app-button>
          }
        </div>
      </app-page-header>

      <div class="u-stack-lg">
        <app-card>
          <span cardTitle>{{ i18n.t('admin.versionPicker') }}</span>
          <span cardSubtitle>{{ i18n.pick(definition.description) }}</span>

          <div class="designer__version">
            <app-select
              class="designer__version-select"
              [label]="i18n.t('admin.versionPicker')"
              [options]="versionOptions()"
              [formControl]="versionControl"
              (valueChange)="versionId.set($event)"
            />

            @if (draft()?.notes; as notes) {
              <p class="designer__notes">{{ i18n.pick(notes) }}</p>
            }
          </div>

          @if (readOnly()) {
            <app-alert tone="info" class="designer__notice">
              {{
                i18n.t('admin.publishedNotice', {
                  count: i18n.formatNumber(runningCaseCount()),
                })
              }}
            </app-alert>
          }
        </app-card>

        @if (findings().length > 0) {
          <app-alert tone="warning" [heading]="i18n.t('admin.validationTitle')">
            <ul class="designer__findings">
              @for (finding of findings(); track finding.id) {
                <li>{{ findingMessage(finding) }}</li>
              }
            </ul>
          </app-alert>
        } @else {
          <app-alert tone="success">{{ i18n.t('admin.validationClean') }}</app-alert>
        }

        <app-card>
          <span cardTitle>{{ i18n.t('admin.canvasTitle') }}</span>
          <span cardSubtitle>{{ i18n.t('admin.canvasDescription') }}</span>

          <div cardActions class="u-cluster">
            <app-button
              size="sm"
              icon="plus"
              [disabled]="readOnly()"
              (pressed)="openState(null)"
            >
              {{ i18n.t('admin.addState') }}
            </app-button>
            <app-button
              size="sm"
              icon="plus"
              [disabled]="readOnly() || states().length < 2"
              (pressed)="openTransition(null)"
            >
              {{ i18n.t('admin.addTransition') }}
            </app-button>
          </div>

          <p class="designer__hint">{{ i18n.t('admin.canvasHint') }}</p>

          @if (states().length === 0) {
            <app-empty-state
              icon="workflow"
              [title]="i18n.t('empty.noWorkflowsTitle')"
              [description]="i18n.t('empty.noWorkflowsDescription')"
            />
          } @else {
            <!--
              Both presentations are always rendered and CSS chooses between them
              at the md breakpoint. A node graph is unusable on a phone, and a
              hidden branch cannot drift from the one people see.
            -->
            <div class="designer__canvas">
              <app-workflow-canvas
                [states]="states()"
                [transitions]="transitions()"
                [selectedStateKey]="selectedStateKey()"
                [selectedTransitionId]="selectedTransitionId()"
                (stateSelected)="openState($event)"
                (transitionSelected)="openTransition($event)"
              />
            </div>

            <div class="designer__lists">
              <section class="designer__list">
                <h3 class="designer__list-title">{{ i18n.t('admin.statesTitle') }}</h3>
                <ul class="designer__rows">
                  @for (state of states(); track state.id) {
                    <li class="designer__row">
                      <button
                        type="button"
                        class="designer__row-main"
                        aria-haspopup="dialog"
                        [attr.aria-current]="state.key === selectedStateKey() ? 'true' : null"
                        (click)="openState(state)"
                      >
                        <span class="designer__row-name">{{ i18n.pick(state.name) }}</span>
                        <span class="designer__row-meta">
                          {{ i18n.t('stateKind.' + state.kind) }} &middot;
                          {{ i18n.t('stage.' + state.stage) }}
                        </span>
                      </button>
                      <app-icon-button
                        icon="trash"
                        size="sm"
                        [label]="i18n.t('admin.deleteState')"
                        [disabled]="readOnly()"
                        (pressed)="askDeleteState(state)"
                      />
                    </li>
                  }
                </ul>
              </section>

              <section class="designer__list">
                <h3 class="designer__list-title">{{ i18n.t('admin.transitionsTitle') }}</h3>
                <ul class="designer__rows">
                  @for (transition of transitions(); track transition.id) {
                    <li class="designer__row">
                      <button
                        type="button"
                        class="designer__row-main"
                        aria-haspopup="dialog"
                        [attr.aria-current]="
                          transition.id === selectedTransitionId() ? 'true' : null
                        "
                        (click)="openTransition(transition)"
                      >
                        <span class="designer__row-name">{{ i18n.pick(transition.label) }}</span>
                        <span class="designer__row-meta">
                          {{ stateName(transition.fromStateKey) }}
                          <app-icon name="arrow-next" size="sm" />
                          {{ stateName(transition.toStateKey) }}
                        </span>
                      </button>
                      <app-icon-button
                        icon="trash"
                        size="sm"
                        [label]="i18n.t('admin.deleteTransition')"
                        [disabled]="readOnly()"
                        (pressed)="askDeleteTransition(transition)"
                      />
                    </li>
                  }
                </ul>
              </section>
            </div>
          }
        </app-card>
      </div>

      <app-drawer
        size="lg"
        [(open)]="editorOpen"
        [title]="editorTitle()"
        (closed)="editing.set(null)"
      >
        @if (editing(); as target) {
          @if (target.kind === 'state') {
            <form class="designer__form" [formGroup]="stateForm" (ngSubmit)="submitEditor()">
              @if (deleteBlocked()) {
                <app-alert tone="warning">{{ i18n.t('admin.deleteStateBlocked') }}</app-alert>
              }

              <app-text-field
                required
                textDirection="ltr"
                formControlName="key"
                [label]="i18n.t('admin.stateForm.key')"
                [hint]="i18n.t('admin.stateForm.keyHint')"
                [error]="stateError('key')"
              />
              <app-text-field
                required
                textDirection="ltr"
                formControlName="nameEn"
                [label]="i18n.t('admin.stateForm.nameEn')"
                [error]="stateError('nameEn')"
              />
              <app-text-field
                required
                textDirection="rtl"
                formControlName="nameAr"
                [label]="i18n.t('admin.stateForm.nameAr')"
                [error]="stateError('nameAr')"
              />
              <app-select
                required
                formControlName="kind"
                [label]="i18n.t('admin.stateForm.kind')"
                [options]="stateKindOptions()"
                [error]="stateError('kind')"
              />
              <app-select
                required
                formControlName="stage"
                [label]="i18n.t('admin.stateForm.stage')"
                [options]="stageOptions()"
                [error]="stateError('stage')"
              />
              <app-select
                formControlName="assigneeRole"
                [label]="i18n.t('admin.stateForm.assigneeRole')"
                [options]="roleOptions()"
              />
              <app-text-field
                showOptional
                type="number"
                formControlName="slaHours"
                [label]="i18n.t('admin.stateForm.slaHours')"
                [hint]="i18n.t('admin.stateForm.slaHoursHint')"
                [error]="stateError('slaHours')"
              />

              <fieldset class="designer__fieldset">
                <legend class="designer__legend">{{ i18n.t('admin.stateForm.position') }}</legend>
                <div class="designer__pair">
                  <app-text-field
                    required
                    type="number"
                    formControlName="column"
                    [label]="axisLabel(1)"
                    [error]="stateError('column')"
                  />
                  <app-text-field
                    required
                    type="number"
                    formControlName="row"
                    [label]="axisLabel(2)"
                    [error]="stateError('row')"
                  />
                </div>
              </fieldset>
            </form>
          } @else {
            <form class="designer__form" [formGroup]="transitionForm" (ngSubmit)="submitEditor()">
              <app-text-field
                required
                textDirection="ltr"
                formControlName="key"
                [label]="i18n.t('admin.transitionForm.key')"
                [error]="transitionError('key')"
              />
              <app-text-field
                required
                textDirection="ltr"
                formControlName="labelEn"
                [label]="i18n.t('admin.transitionForm.labelEn')"
                [error]="transitionError('labelEn')"
              />
              <app-text-field
                required
                textDirection="rtl"
                formControlName="labelAr"
                [label]="i18n.t('admin.transitionForm.labelAr')"
                [error]="transitionError('labelAr')"
              />
              <app-select
                required
                formControlName="from"
                [label]="i18n.t('admin.transitionForm.from')"
                [options]="stateOptions()"
                [error]="transitionError('from')"
              />
              <app-select
                required
                formControlName="to"
                [label]="i18n.t('admin.transitionForm.to')"
                [options]="stateOptions()"
                [error]="transitionError('to')"
              />
              <app-select
                required
                formControlName="kind"
                [label]="i18n.t('admin.transitionForm.kind')"
                [options]="transitionKindOptions()"
                [error]="transitionError('kind')"
              />

              <fieldset class="designer__fieldset" formGroupName="allowedRoles">
                <legend class="designer__legend">
                  {{ i18n.t('admin.transitionForm.allowedRoles') }}
                </legend>
                @for (role of roles; track role) {
                  <app-checkbox [formControlName]="role" [label]="i18n.t('roles.' + role)" />
                }
                @if (rolesError(); as message) {
                  <p class="designer__error" [id]="rolesErrorId" role="alert">
                    <app-icon name="alert-circle" size="sm" />
                    <span>{{ message }}</span>
                  </p>
                }
              </fieldset>

              <app-text-field
                showOptional
                textDirection="ltr"
                formControlName="guard"
                [label]="i18n.t('admin.transitionForm.guard')"
                [hint]="i18n.t('admin.transitionForm.guardHint')"
              />
              <app-checkbox
                formControlName="requiresComment"
                [label]="i18n.t('admin.transitionForm.requiresComment')"
              />
              <app-checkbox
                formControlName="requiresAttachment"
                [label]="i18n.t('admin.transitionForm.requiresAttachment')"
              />
            </form>
          }
        }

        <div drawerFooter class="designer__actions">
          @if (readOnly()) {
            <app-button variant="secondary" (pressed)="closeEditor()">
              {{ i18n.t('common.close') }}
            </app-button>
          } @else {
            @if (editing()?.id) {
              <app-button
                class="designer__delete"
                variant="danger"
                icon="trash"
                [disabled]="deleteBlocked()"
                (pressed)="deleteEditing()"
              >
                {{ deleteLabel() }}
              </app-button>
            }
            <app-button variant="secondary" (pressed)="closeEditor()">
              {{ i18n.t('common.cancel') }}
            </app-button>
            <app-button variant="primary" (pressed)="submitEditor()">
              {{ i18n.t('common.save') }}
            </app-button>
          }
        </div>
      </app-drawer>

      <app-confirm-dialog
        tone="danger"
        [(open)]="discardOpen"
        [title]="i18n.t('dialog.discardTitle')"
        [description]="i18n.t('dialog.discardDescription')"
        [confirmLabel]="i18n.t('dialog.discardConfirm')"
        [cancelLabel]="i18n.t('dialog.discardCancel')"
        (confirmed)="discardChanges()"
      />

      <app-confirm-dialog
        tone="danger"
        [(open)]="deleteStateOpen"
        [title]="deleteStateTitle()"
        [description]="deleteStateDescription()"
        [confirmLabel]="i18n.t('admin.deleteState')"
        (confirmed)="confirmDeleteState()"
      />

      <app-confirm-dialog
        tone="danger"
        [(open)]="deleteTransitionOpen"
        [title]="deleteTransitionTitle()"
        [description]="deleteTransitionDescription()"
        [confirmLabel]="i18n.t('admin.deleteTransition')"
        (confirmed)="confirmDeleteTransition()"
      />
    } @else {
      <app-error-state
        tone="notFound"
        [retryable]="false"
        [title]="i18n.t('errors.notFoundTitle')"
        [description]="i18n.t('errors.notFoundDescription')"
      />
    }
  `,
})
export class WorkflowDesignerPage {
  readonly id = input.required<string>();

  protected readonly i18n = inject(I18nService);
  private readonly gateway = inject(DataGateway);
  private readonly toast = inject(ToastService);

  protected readonly roles = ALL_ROLES;
  protected readonly rolesErrorId = errorIdFor(nextControlId('allowed-roles'));

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  protected readonly workflow = resource({
    params: () => ({ id: this.id() }),
    loader: ({ params }) => this.gateway.getWorkflow(params.id),
    defaultValue: null as WorkflowDefinition | null,
  });

  protected readonly definition = computed(() =>
    this.workflow.hasValue() ? this.workflow.value() : null,
  );

  /**
   * Only a load with nothing on screen yet blanks the page. Saving writes the
   * returned definition straight back into the resource, and a reload behind an
   * open editor must not replace it with a skeleton.
   */
  protected readonly loading = computed(
    () => this.workflow.isLoading() && this.definition() === null,
  );

  // ---------------------------------------------------------------------------
  // Version selection and the draft being edited
  // ---------------------------------------------------------------------------

  /** Opens on the draft if there is one, because that is what an editor is for. */
  protected readonly versionId = linkedSignal<WorkflowDefinition | null, string | null>({
    source: () => this.definition(),
    computation: (definition, previous) => {
      if (!definition) {
        return null;
      }
      const kept = definition.versions.find((version) => version.id === previous?.value);
      if (kept) {
        return kept.id;
      }
      const draft = definition.versions.find((version) => version.status === 'draft');
      return (draft ?? publishedVersion(definition)).id;
    },
  });

  /** What the gateway holds. The draft is compared against this to find changes. */
  protected readonly storedVersion = computed<WorkflowVersion | null>(() => {
    const definition = this.definition();
    const id = this.versionId();
    if (!definition || id === null) {
      return null;
    }
    return definition.versions.find((version) => version.id === id) ?? null;
  });

  /**
   * The working copy. It is reset by the link whenever a different version is
   * chosen or a save writes a new definition back, which is also what clears the
   * unsaved marker: every edit produces a new object, so identity with the
   * stored version is exactly "nothing to save".
   */
  protected readonly draft = linkedSignal<WorkflowVersion | null, WorkflowVersion | null>({
    source: () => this.storedVersion(),
    computation: (version) => version,
  });

  protected readonly unsaved = computed(() => {
    const stored = this.storedVersion();
    const draft = this.draft();
    return stored !== null && draft !== null && draft !== stored;
  });

  /** A version anyone can file a case against is not a version anyone may edit. */
  protected readonly readOnly = computed(() => this.draft()?.status !== 'draft');

  protected readonly states = computed<readonly WorkflowState[]>(
    () => this.draft()?.states ?? [],
  );
  protected readonly transitions = computed<readonly WorkflowTransition[]>(
    () => this.draft()?.transitions ?? [],
  );

  protected readonly runningCases = resource({
    params: () => ({
      key: this.definition()?.key ?? null,
      version: this.storedVersion()?.version ?? null,
    }),
    loader: ({ params }) =>
      params.key !== null && params.version !== null
        ? this.gateway.countRunningCases(params.key, params.version)
        : Promise.resolve(0),
    defaultValue: 0,
  });

  protected readonly runningCaseCount = computed(() =>
    this.runningCases.hasValue() ? this.runningCases.value() : 0,
  );

  protected readonly saving = signal(false);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  protected readonly findings = computed<readonly ValidationFinding[]>(() => {
    const draft = this.draft();
    return draft ? validateWorkflow(draft.states, draft.transitions) : [];
  });

  // ---------------------------------------------------------------------------
  // Editor panel
  // ---------------------------------------------------------------------------

  protected readonly editing = signal<EditorTarget | null>(null);
  protected readonly editorOpen = signal(false);

  protected readonly discardOpen = signal(false);
  protected readonly deleteStateOpen = signal(false);
  protected readonly deleteTransitionOpen = signal(false);
  private readonly pendingState = signal<WorkflowState | null>(null);
  private readonly pendingTransition = signal<WorkflowTransition | null>(null);

  /**
   * Reactive forms are not signals, so nothing would tell a zoneless template
   * that a control became invalid. Every error accessor reads this counter, and
   * the forms bump it as they change.
   */
  private readonly formRevision = signal(0);

  protected readonly versionControl = new FormControl('', { nonNullable: true });

  protected readonly stateForm = new FormGroup({
    key: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(KEY_PATTERN)],
    }),
    nameEn: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    nameAr: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    kind: new FormControl('task', { nonNullable: true, validators: [Validators.required] }),
    stage: new FormControl('review', { nonNullable: true, validators: [Validators.required] }),
    assigneeRole: new FormControl('', { nonNullable: true }),
    slaHours: new FormControl('', {
      nonNullable: true,
      validators: [wholeNumber(), Validators.min(1)],
    }),
    column: new FormControl('0', {
      nonNullable: true,
      validators: [Validators.required, wholeNumber(), Validators.min(0)],
    }),
    row: new FormControl('0', {
      nonNullable: true,
      validators: [Validators.required, wholeNumber(), Validators.min(0)],
    }),
  });

  protected readonly transitionForm = new FormGroup({
    key: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(KEY_PATTERN)],
    }),
    labelEn: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    labelAr: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    from: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    to: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    kind: new FormControl('forward', { nonNullable: true, validators: [Validators.required] }),
    allowedRoles: new FormGroup(
      {
        citizen: new FormControl(false, { nonNullable: true }),
        officer: new FormControl(false, { nonNullable: true }),
        supervisor: new FormControl(false, { nonNullable: true }),
        admin: new FormControl(false, { nonNullable: true }),
      },
      { validators: [atLeastOneRole()] },
    ),
    guard: new FormControl('', { nonNullable: true }),
    requiresComment: new FormControl(false, { nonNullable: true }),
    requiresAttachment: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    const bump = (): void => this.formRevision.update((value) => value + 1);
    this.stateForm.events.pipe(takeUntilDestroyed()).subscribe(bump);
    this.transitionForm.events.pipe(takeUntilDestroyed()).subscribe(bump);

    // The picker is a form control because that is the only way to write a value
    // into a control value accessor, but the chosen version lives in a signal so
    // that everything downstream of it stays reactive.
    effect(() => {
      const id = this.versionId() ?? '';
      if (this.versionControl.value !== id) {
        this.versionControl.setValue(id, { emitEvent: false });
      }
    });

    // One switch for the whole editor. Disabling the controls rather than hiding
    // them is what lets a published version still be read in the panel.
    effect(() => {
      const locked = this.readOnly();
      for (const form of [this.stateForm, this.transitionForm]) {
        if (locked) {
          form.disable({ emitEvent: false });
        } else {
          form.enable({ emitEvent: false });
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Presentation
  // ---------------------------------------------------------------------------

  protected readonly crumbs = computed<readonly BreadcrumbItem[]>(() => [
    { label: this.i18n.t('nav.workflows'), link: '/admin' },
    { label: this.i18n.pick(this.definition()?.name) },
  ]);

  protected readonly headerDescription = computed(() => {
    const version = this.draft();
    return version === null
      ? null
      : this.i18n.t('admin.designerSubtitle', {
          version: this.i18n.formatNumber(version.version),
        });
  });

  protected readonly versionOptions = computed<readonly SelectOption[]>(() => {
    const definition = this.definition();
    if (!definition) {
      return [];
    }
    return [...definition.versions]
      .sort((a, b) => b.version - a.version)
      .map((version) => ({
        value: version.id,
        label: `${this.i18n.t('admin.designerSubtitle', {
          version: this.i18n.formatNumber(version.version),
        })} (${this.i18n.t(`admin.versionStatus.${version.status}`)})`,
      }));
  });

  protected readonly stateKindOptions = computed<readonly SelectOption[]>(() =>
    WORKFLOW_STATE_KINDS.map((kind) => ({
      value: kind,
      label: this.i18n.t(`stateKind.${kind}`),
    })),
  );

  protected readonly stageOptions = computed<readonly SelectOption[]>(() =>
    WORKFLOW_STAGES.map((stage) => ({ value: stage, label: this.i18n.t(`stage.${stage}`) })),
  );

  protected readonly roleOptions = computed<readonly SelectOption[]>(() => [
    { value: '', label: this.i18n.t('common.none') },
    ...ALL_ROLES.map((role) => ({ value: role, label: this.i18n.t(`roles.${role}`) })),
  ]);

  protected readonly transitionKindOptions = computed<readonly SelectOption[]>(() =>
    TRANSITION_KINDS.map((kind) => ({
      value: kind,
      label: this.i18n.t(`transitionKind.${kind}`),
    })),
  );

  protected readonly stateOptions = computed<readonly SelectOption[]>(() =>
    this.states().map((state) => ({ value: state.key, label: this.i18n.pick(state.name) })),
  );

  protected readonly selectedStateKey = computed(() => {
    const target = this.editing();
    if (!target || target.kind !== 'state' || target.id === null) {
      return null;
    }
    return this.states().find((state) => state.id === target.id)?.key ?? null;
  });

  protected readonly selectedTransitionId = computed(() => {
    const target = this.editing();
    return target !== null && target.kind === 'transition' ? target.id : null;
  });

  protected readonly editorTitle = computed(() => {
    const target = this.editing();
    if (!target) {
      return this.i18n.t('admin.canvasTitle');
    }
    if (target.kind === 'state') {
      return this.i18n.t(target.id === null ? 'admin.addState' : 'admin.editState');
    }
    return this.i18n.t(target.id === null ? 'admin.addTransition' : 'admin.editTransition');
  });

  protected readonly deleteLabel = computed(() =>
    this.i18n.t(
      this.editing()?.kind === 'state' ? 'admin.deleteState' : 'admin.deleteTransition',
    ),
  );

  /** The last start state stays. The panel says so rather than failing silently. */
  protected readonly deleteBlocked = computed(() => {
    const draft = this.draft();
    const state = this.editingState();
    return draft !== null && state !== null && isOnlyStartState(draft, state.key);
  });

  protected readonly deleteStateTitle = computed(() =>
    this.i18n.t('admin.deleteStateTitle', {
      name: this.i18n.pick(this.pendingState()?.name),
    }),
  );

  protected readonly deleteStateDescription = computed(() => {
    const draft = this.draft();
    const state = this.pendingState();
    const count = draft && state ? transitionsTouching(draft, state.key).length : 0;
    return this.i18n.t('admin.deleteStateDescription', {
      count: this.i18n.formatNumber(count),
    });
  });

  protected readonly deleteTransitionTitle = computed(() =>
    this.i18n.t('admin.deleteTransitionTitle', {
      name: this.i18n.pick(this.pendingTransition()?.label),
    }),
  );

  protected readonly deleteTransitionDescription = computed(() => {
    const transition = this.pendingTransition();
    return this.i18n.t('admin.deleteTransitionDescription', {
      from: transition ? this.stateName(transition.fromStateKey) : '',
      to: transition ? this.stateName(transition.toStateKey) : '',
    });
  });

  protected statusTone(status: WorkflowVersionStatus): BadgeTone {
    return status === 'published' ? 'success' : 'neutral';
  }

  protected statusIcon(status: WorkflowVersionStatus): IconName {
    return STATUS_ICON[status];
  }

  protected stateName(key: string): string {
    const state = this.states().find((candidate) => candidate.key === key);
    return state ? this.i18n.pick(state.name) : key;
  }

  protected findingMessage(finding: ValidationFinding): string {
    const name = this.i18n.pick(finding.state?.name);
    switch (finding.code) {
      case 'noStart':
        return this.i18n.t('admin.validationNoStart');
      case 'noEnd':
        return this.i18n.t('admin.validationNoEnd');
      case 'duplicateKey':
        return this.i18n.t('admin.validationDuplicateKey', { key: finding.stateKey ?? '' });
      case 'unreachable':
        return this.i18n.t('admin.validationUnreachable', { name });
      case 'noOutgoing':
        return this.i18n.t('admin.validationNoOutgoing', { name });
    }
  }

  /**
   * The catalogue has one key for the position group and none for its two axes,
   * so the fields are numbered inside the group rather than labelled in English
   * here. See the report: `admin.stateForm.column` and `admin.stateForm.row`.
   */
  protected axisLabel(axis: number): string {
    return `${this.i18n.t('admin.stateForm.position')} ${this.i18n.formatNumber(axis)}`;
  }

  protected stateError(name: string): string | null {
    this.formRevision();
    return validationMessage(this.stateForm.get(name), this.stateFieldLabel(name), this.i18n);
  }

  protected transitionError(name: string): string | null {
    this.formRevision();
    return validationMessage(
      this.transitionForm.get(name),
      this.i18n.t(`admin.transitionForm.${name}`),
      this.i18n,
    );
  }

  protected rolesError(): string | null {
    this.formRevision();
    return validationMessage(
      this.transitionForm.controls.allowedRoles,
      this.i18n.t('admin.transitionForm.allowedRoles'),
      this.i18n,
    );
  }

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  protected openState(state: WorkflowState | null): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    this.stateForm.reset(
      state === null
        ? {
            key: '',
            nameEn: '',
            nameAr: '',
            kind: 'task',
            stage: 'review',
            assigneeRole: 'officer',
            slaHours: '',
            // Past everything already placed, so a new state never lands on top
            // of an existing one.
            column: String(nextFreeColumn(draft)),
            row: '1',
          }
        : {
            key: state.key,
            nameEn: state.name.en,
            nameAr: state.name.ar,
            kind: state.kind,
            stage: state.stage,
            assigneeRole: state.assigneeRole ?? '',
            slaHours: state.slaHours === null ? '' : String(state.slaHours),
            column: String(state.column),
            row: String(state.row),
          },
      { emitEvent: false },
    );
    this.editing.set({ kind: 'state', id: state?.id ?? null });
    this.editorOpen.set(true);
  }

  protected openTransition(transition: WorkflowTransition | null): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    const states = draft.states;
    this.transitionForm.reset(
      transition === null
        ? {
            key: '',
            labelEn: '',
            labelAr: '',
            from: states[0]?.key ?? '',
            to: states[1]?.key ?? states[0]?.key ?? '',
            kind: 'forward',
            allowedRoles: { citizen: false, officer: true, supervisor: false, admin: false },
            guard: '',
            requiresComment: false,
            requiresAttachment: false,
          }
        : {
            key: transition.key,
            labelEn: transition.label.en,
            labelAr: transition.label.ar,
            from: transition.fromStateKey,
            to: transition.toStateKey,
            kind: transition.kind,
            allowedRoles: {
              citizen: transition.allowedRoles.includes('citizen'),
              officer: transition.allowedRoles.includes('officer'),
              supervisor: transition.allowedRoles.includes('supervisor'),
              admin: transition.allowedRoles.includes('admin'),
            },
            guard: transition.guard ?? '',
            requiresComment: transition.requiresComment,
            requiresAttachment: transition.requiresAttachment,
          },
      { emitEvent: false },
    );
    this.editing.set({ kind: 'transition', id: transition?.id ?? null });
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  protected submitEditor(): void {
    if (this.editing()?.kind === 'state') {
      this.submitState();
    } else {
      this.submitTransition();
    }
  }

  protected deleteEditing(): void {
    const target = this.editing();
    if (!target || target.id === null) {
      return;
    }
    if (target.kind === 'state') {
      const state = this.editingState();
      if (state) {
        this.askDeleteState(state);
      }
      return;
    }
    const transition = this.transitions().find((candidate) => candidate.id === target.id);
    if (transition) {
      this.askDeleteTransition(transition);
    }
  }

  protected askDeleteState(state: WorkflowState): void {
    const draft = this.draft();
    if (!draft || this.readOnly()) {
      return;
    }
    if (isOnlyStartState(draft, state.key)) {
      this.toast.warning(this.i18n.t('admin.deleteStateBlocked'));
      return;
    }
    this.pendingState.set(state);
    this.deleteStateOpen.set(true);
  }

  protected confirmDeleteState(): void {
    const draft = this.draft();
    const state = this.pendingState();
    if (!draft || !state) {
      return;
    }
    this.draft.set(withoutState(draft, state.key));
    this.pendingState.set(null);
    this.toast.success(this.i18n.t('toast.stateRemoved'));
    this.closeEditor();
  }

  protected askDeleteTransition(transition: WorkflowTransition): void {
    if (this.readOnly()) {
      return;
    }
    this.pendingTransition.set(transition);
    this.deleteTransitionOpen.set(true);
  }

  protected confirmDeleteTransition(): void {
    const draft = this.draft();
    const transition = this.pendingTransition();
    if (!draft || !transition) {
      return;
    }
    this.draft.set(withoutTransition(draft, transition.id));
    this.pendingTransition.set(null);
    this.toast.success(this.i18n.t('toast.transitionRemoved'));
    this.closeEditor();
  }

  protected discardChanges(): void {
    this.draft.set(this.storedVersion());
    this.closeEditor();
    this.toast.info(this.i18n.t('toast.changesDiscarded'));
  }

  protected async saveDraft(): Promise<void> {
    const definition = this.definition();
    const draft = this.draft();
    if (!definition || !draft || this.readOnly() || this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      const updated = await this.gateway.saveWorkflowVersion(definition.id, draft);
      // Written straight back rather than reloaded: the gateway has just told us
      // what it holds, and a reload would blank the editor for a frame.
      this.workflow.set(updated);
      this.toast.success(this.i18n.t('toast.draftSaved'));
    } catch {
      this.toast.error(
        this.i18n.t('errors.actionFailedTitle'),
        this.i18n.t('errors.actionFailedDescription'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private editingState(): WorkflowState | null {
    const target = this.editing();
    if (!target || target.kind !== 'state' || target.id === null) {
      return null;
    }
    return this.states().find((state) => state.id === target.id) ?? null;
  }

  private stateFieldLabel(name: string): string {
    if (name === 'column') {
      return this.axisLabel(1);
    }
    if (name === 'row') {
      return this.axisLabel(2);
    }
    return this.i18n.t(`admin.stateForm.${name}`);
  }

  private submitState(): void {
    const draft = this.draft();
    const target = this.editing();
    if (!draft || !target || target.kind !== 'state' || this.readOnly()) {
      return;
    }
    if (this.stateForm.invalid) {
      this.stateForm.markAllAsTouched();
      this.formRevision.update((value) => value + 1);
      return;
    }

    const raw = this.stateForm.getRawValue();
    const key = raw.key.trim();
    const existing =
      target.id === null
        ? null
        : (draft.states.find((state) => state.id === target.id) ?? null);

    const state: WorkflowState = {
      id: existing?.id ?? nextStateId(draft, key),
      key,
      name: { en: raw.nameEn.trim(), ar: raw.nameAr.trim() },
      kind: raw.kind as WorkflowStateKind,
      stage: raw.stage as WorkflowStage,
      assigneeRole: raw.assigneeRole === '' ? null : (raw.assigneeRole as Role),
      slaHours: raw.slaHours.trim() === '' ? null : Number(raw.slaHours),
      column: Number(raw.column),
      row: Number(raw.row),
    };

    this.draft.set(withState(draft, state, existing?.key ?? null));
    this.toast.success(this.i18n.t(existing ? 'toast.stateUpdated' : 'toast.stateAdded'));
    this.closeEditor();
  }

  private submitTransition(): void {
    const draft = this.draft();
    const target = this.editing();
    if (!draft || !target || target.kind !== 'transition' || this.readOnly()) {
      return;
    }
    if (this.transitionForm.invalid) {
      this.transitionForm.markAllAsTouched();
      this.formRevision.update((value) => value + 1);
      return;
    }

    const raw = this.transitionForm.getRawValue();
    const key = raw.key.trim();
    const existing =
      target.id === null
        ? null
        : (draft.transitions.find((candidate) => candidate.id === target.id) ?? null);

    const transition: WorkflowTransition = {
      id: existing?.id ?? nextTransitionId(draft, key),
      key,
      label: { en: raw.labelEn.trim(), ar: raw.labelAr.trim() },
      fromStateKey: raw.from,
      toStateKey: raw.to,
      kind: raw.kind as WorkflowTransition['kind'],
      allowedRoles: ALL_ROLES.filter((role) => raw.allowedRoles[role]),
      guard: raw.guard.trim() === '' ? null : raw.guard.trim(),
      requiresComment: raw.requiresComment,
      requiresAttachment: raw.requiresAttachment,
    };

    this.draft.set(withTransition(draft, transition));
    this.toast.success(
      this.i18n.t(existing ? 'toast.transitionUpdated' : 'toast.transitionAdded'),
    );
    this.closeEditor();
  }
}
