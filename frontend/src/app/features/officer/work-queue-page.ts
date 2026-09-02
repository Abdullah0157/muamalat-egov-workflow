import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { DataGateway, QueueAssignment, QueueResult } from '../../core/data/data-gateway';
import { findDepartment } from '../../core/data/service-catalogue';
import { slaStateFor } from '../../core/data/sla';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  RequestPriority,
  ServiceDefinition,
  ServiceRequest,
  SlaState,
  SlaStatus,
} from '../../core/models/domain';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import {
  DataTable,
  DataTableCellDirective,
  DataTableColumn,
} from '../../shared/ui/data-table/data-table';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Select, SelectOption } from '../../shared/ui/select/select';
import { SkeletonTable } from '../../shared/ui/skeleton/skeleton-table';
import { priorityPresentation, slaPresentation } from '../../shared/ui/status/status-presentation';
import { TextField } from '../../shared/ui/text-field/text-field';
import { serviceNameOf, stateName } from '../shared/request-presentation';

/**
 * Long enough that a typed reference number is one request rather than twelve,
 * short enough that the queue still feels like it is reacting to the keyboard.
 */
const SEARCH_DEBOUNCE_MS = 250;

/** The queue an officer opens on, so it is also what "clear filters" returns to. */
const DEFAULT_ASSIGNMENT: QueueAssignment = 'mine';

/**
 * A queue row with its service level already derived.
 *
 * The deadline is the column an officer reads first, and it depends on the
 * clock rather than on the record, so it is computed once for the whole page
 * against a single instant. Deriving it per cell would let two rows on the same
 * screen be measured against two different moments.
 */
interface QueueRow {
  readonly request: ServiceRequest;
  readonly sla: SlaState;
}

/**
 * The officer work queue.
 *
 * Deadline first: the gateway returns the queue in deadline order and the table
 * keeps that order, so the case closest to breaching is the first row without
 * anyone having to sort. Everything else on the screen exists to narrow that
 * list, which is why the filters sit above the table rather than behind a panel.
 */
@Component({
  selector: 'app-work-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    Badge,
    Button,
    Card,
    DataTable,
    DataTableCellDirective,
    EmptyState,
    ErrorState,
    PageHeader,
    Select,
    SkeletonTable,
    TextField,
  ],
  styleUrl: './work-queue-page.scss',
  host: { class: 'page' },
  template: `
    <app-page-header
      [heading]="i18n.t('officer.title')"
      [description]="i18n.t('officer.subtitle')"
    >
      <div pageHeaderMeta>
        @if (departmentName(); as department) {
          <app-badge tone="neutral" size="sm" icon="building">{{ department }}</app-badge>
        }
      </div>
    </app-page-header>

    <div class="u-stack-lg">
      <app-card [hasHeader]="false">
        <fieldset class="queue__filters">
          <legend class="u-visually-hidden">{{ i18n.t('officer.filters.legend') }}</legend>

          <app-text-field
            class="queue__filter queue__filter--search"
            type="search"
            icon="search"
            [formControl]="searchControl"
            [label]="i18n.t('search.label')"
            [placeholder]="i18n.t('search.placeholder')"
          />

          <app-select
            class="queue__filter"
            [formControl]="assignmentControl"
            [label]="i18n.t('officer.filters.assignment')"
            [options]="assignmentOptions()"
          />

          <app-select
            class="queue__filter"
            [formControl]="serviceControl"
            [label]="i18n.t('officer.filters.service')"
            [options]="serviceOptions()"
          />

          <app-select
            class="queue__filter"
            [formControl]="priorityControl"
            [label]="i18n.t('officer.filters.priority')"
            [options]="priorityOptions()"
          />

          <app-select
            class="queue__filter"
            [formControl]="slaControl"
            [label]="i18n.t('officer.filters.slaStatus')"
            [options]="slaOptions()"
          />

          <div class="queue__filter queue__filter--clear">
            <app-button
              variant="ghost"
              icon="close"
              [disabled]="!hasAnyFilter()"
              (pressed)="clearFilters()"
            >
              {{ i18n.t('common.clearFilters') }}
            </app-button>
          </div>
        </fieldset>
      </app-card>

      @if (isFirstLoad()) {
        <app-card [hasHeader]="false" flush>
          <app-skeleton-table [rows]="8" [columns]="6" label="" />
        </app-card>
      } @else if (queue.error()) {
        <app-card [hasHeader]="false">
          <app-error-state
            [title]="i18n.t('errors.loadRequestsTitle')"
            [description]="i18n.t('errors.loadRequestsDescription')"
            (retry)="queue.reload()"
          />
        </app-card>
      } @else {
        <p class="queue__summary" role="status">
          {{
            i18n.t('officer.filters.showing', {
              shown: i18n.formatNumber(rows().length),
              total: i18n.formatNumber(total()),
            })
          }}
        </p>

        @if (rows().length === 0) {
          <app-card [hasHeader]="false">
            @if (searchTerm()) {
              <app-empty-state
                icon="search"
                [title]="i18n.t('empty.noResultsTitle', { term: searchTerm() })"
                [description]="i18n.t('empty.noResultsDescription', { term: searchTerm() })"
              >
                <app-button emptyStateAction variant="secondary" (pressed)="clearFilters()">
                  {{ i18n.t('common.clearFilters') }}
                </app-button>
              </app-empty-state>
            } @else if (hasNarrowingFilter()) {
              <app-empty-state
                icon="filter"
                [title]="i18n.t('empty.noFilteredRequestsTitle')"
                [description]="i18n.t('empty.noFilteredRequestsDescription')"
              >
                <app-button emptyStateAction variant="secondary" (pressed)="clearFilters()">
                  {{ i18n.t('common.clearFilters') }}
                </app-button>
              </app-empty-state>
            } @else {
              <app-empty-state
                icon="inbox"
                [title]="i18n.t('empty.noQueueTitle')"
                [description]="i18n.t('empty.noQueueDescription')"
              />
            }
          </app-card>
        } @else {
          <app-card [hasHeader]="false" flush>
            <app-data-table
              [rows]="rows()"
              [columns]="columns()"
              [caption]="i18n.t('officer.queueCaption')"
              [loading]="queue.isLoading()"
              [pageSize]="25"
              [rowLink]="rowLink"
            >
              <ng-template appDataTableCell="reference" [appDataTableCellFor]="rows()" let-row>
                <span class="u-reference">{{ row.request.reference }}</span>
              </ng-template>

              <ng-template appDataTableCell="service" [appDataTableCellFor]="rows()" let-row>
                {{ serviceName(row.request) }}
              </ng-template>

              <ng-template appDataTableCell="applicant" [appDataTableCellFor]="rows()" let-row>
                {{ i18n.pick(row.request.applicantName) }}
              </ng-template>

              <ng-template appDataTableCell="submitted" [appDataTableCellFor]="rows()" let-row>
                @if (row.request.submittedAt; as submitted) {
                  <time [attr.datetime]="submitted">{{ i18n.formatDate(submitted) }}</time>
                } @else {
                  <span class="u-tertiary">{{ i18n.t('common.notAvailable') }}</span>
                }
              </ng-template>

              <ng-template appDataTableCell="priority" [appDataTableCellFor]="rows()" let-row>
                <app-badge
                  size="sm"
                  [tone]="priorityTone(row.request.priority)"
                  [icon]="priorityIcon(row.request.priority)"
                >
                  {{ i18n.t('priority.' + row.request.priority) }}
                </app-badge>
              </ng-template>

              <ng-template appDataTableCell="state" [appDataTableCellFor]="rows()" let-row>
                {{ currentState(row.request) }}
              </ng-template>

              <ng-template appDataTableCell="deadline" [appDataTableCellFor]="rows()" let-row>
                <span class="queue__sla">
                  <app-badge size="sm" [tone]="slaTone(row.sla)" [icon]="slaIcon(row.sla)">
                    {{ i18n.t(slaLabelKey(row.sla)) }}
                  </app-badge>
                  @if (slaCountdown(row.sla); as countdown) {
                    <span class="queue__sla-countdown u-numeric">{{ countdown }}</span>
                  }
                </span>
              </ng-template>
            </app-data-table>
          </app-card>
        }
      }
    </div>
  `,
})
export class WorkQueuePage {
  protected readonly i18n = inject(I18nService);
  private readonly gateway = inject(DataGateway);
  private readonly auth = inject(AuthService);

  // Reactive form controls rather than bare signals, because "clear filters"
  // has to put the visible controls back as well as the query behind them.
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly assignmentControl = new FormControl<QueueAssignment>(DEFAULT_ASSIGNMENT, {
    nonNullable: true,
  });
  protected readonly serviceControl = new FormControl('', { nonNullable: true });
  protected readonly priorityControl = new FormControl('', { nonNullable: true });
  protected readonly slaControl = new FormControl('', { nonNullable: true });

  /**
   * What the officer has typed so far. Drives the clear button and the empty
   * state copy, so both react to the keystroke rather than to the fetch.
   */
  protected readonly searchTerm = toSignal(this.searchControl.valueChanges, { initialValue: '' });

  /** What is actually sent. Every keystroke would otherwise be a round trip. */
  private readonly debouncedSearch = toSignal(
    this.searchControl.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS)),
    { initialValue: '' },
  );

  private readonly assignment = toSignal(this.assignmentControl.valueChanges, {
    initialValue: DEFAULT_ASSIGNMENT,
  });
  private readonly serviceId = toSignal(this.serviceControl.valueChanges, { initialValue: '' });
  private readonly priority = toSignal(this.priorityControl.valueChanges, { initialValue: '' });
  private readonly slaStatus = toSignal(this.slaControl.valueChanges, { initialValue: '' });

  /**
   * The queue. Every filter is a dependency of `params`, so changing one is the
   * only thing that refetches, and the gateway keeps ownership of what matching
   * means rather than the screen filtering a list it downloaded.
   */
  protected readonly queue = resource({
    params: () => ({
      officerId: this.auth.user()?.id ?? '',
      departmentId: this.auth.departmentId(),
      assignment: this.assignment(),
      search: this.debouncedSearch(),
      serviceId: this.serviceId() || null,
      priority: (this.priority() || null) as RequestPriority | null,
      slaStatus: (this.slaStatus() || null) as SlaStatus | null,
    }),
    loader: ({ params }) => this.gateway.listQueue(params),
    defaultValue: { rows: [], total: 0 } as QueueResult,
  });

  /**
   * The services this department actually files, so the filter offers the eight
   * an officer could meet rather than the whole catalogue.
   */
  private readonly services = resource({
    params: () => ({ departmentId: this.auth.departmentId() }),
    loader: async ({ params }) => {
      const all = await this.gateway.listServices();
      return params.departmentId === null
        ? all
        : all.filter((service) => service.departmentId === params.departmentId);
    },
    defaultValue: [] as readonly ServiceDefinition[],
  });

  protected readonly departmentName = computed(() => {
    const id = this.auth.departmentId();
    return id === null ? null : this.i18n.pick(findDepartment(id)?.name);
  });

  /**
   * A skeleton only replaces the table on the first load. A refetch caused by a
   * filter keeps the rows on screen and marks the table busy instead, because
   * tearing the list down on every keystroke loses the officer's place.
   */
  protected readonly isFirstLoad = computed(() => this.queue.status() === 'loading');

  protected readonly rows = computed<readonly QueueRow[]>(() => {
    if (this.queue.error()) {
      return [];
    }
    const now = new Date();
    return this.queue
      .value()
      .rows.map((request) => ({ request, sla: slaStateFor(request, now) }));
  });

  protected readonly total = computed(() => (this.queue.error() ? 0 : this.queue.value().total));

  /** Anything the officer set. Governs whether "clear filters" does something. */
  protected readonly hasAnyFilter = computed(
    () => this.searchTerm() !== '' || this.hasNarrowingFilter(),
  );

  /**
   * The filters that can hide a case that exists. The search term is deliberately
   * excluded: "nothing matched your search" is a different sentence from
   * "nothing matched your filters", and the two empty states say so.
   */
  protected readonly hasNarrowingFilter = computed(
    () =>
      this.assignment() !== DEFAULT_ASSIGNMENT ||
      this.serviceId() !== '' ||
      this.priority() !== '' ||
      this.slaStatus() !== '',
  );

  protected readonly assignmentOptions = computed<readonly SelectOption[]>(() => [
    { value: 'mine', label: this.i18n.t('officer.filters.assignedToMe') },
    { value: 'unassigned', label: this.i18n.t('officer.filters.unassigned') },
    { value: 'department', label: this.i18n.t('officer.filters.everything') },
  ]);

  protected readonly serviceOptions = computed<readonly SelectOption[]>(() => {
    const all: SelectOption = { value: '', label: this.i18n.t('common.all') };
    // A catalogue that failed to load must not take the queue down with it: the
    // filter simply offers "all" until the next reload.
    if (this.services.error()) {
      return [all];
    }
    return [
      all,
      ...this.services
        .value()
        .map((service) => ({ value: service.id, label: this.i18n.pick(service.name) })),
    ];
  });

  protected readonly priorityOptions = computed<readonly SelectOption[]>(() => [
    { value: '', label: this.i18n.t('common.any') },
    { value: 'urgent', label: this.i18n.t('priority.urgent') },
    { value: 'high', label: this.i18n.t('priority.high') },
    { value: 'normal', label: this.i18n.t('priority.normal') },
  ]);

  protected readonly slaOptions = computed<readonly SelectOption[]>(() => [
    { value: '', label: this.i18n.t('common.any') },
    { value: 'breached', label: this.i18n.t('sla.breached') },
    { value: 'atRisk', label: this.i18n.t('sla.atRisk') },
    { value: 'onTrack', label: this.i18n.t('sla.onTrack') },
  ]);

  /**
   * Headers are read through `t()` so the table relabels itself on a language
   * switch. Sort values are supplied wherever the cell renders something other
   * than the raw field, so ordering matches what the column shows.
   */
  protected readonly columns = computed<readonly DataTableColumn<QueueRow>[]>(() => [
    {
      id: 'reference',
      header: this.i18n.t('common.reference'),
      primary: true,
      sortable: true,
      width: '10rem',
      sortValue: (row) => row.request.reference,
    },
    {
      id: 'service',
      header: this.i18n.t('common.service'),
      hideBelow: 'lg',
      sortValue: (row) => this.serviceName(row.request),
    },
    {
      id: 'applicant',
      header: this.i18n.t('common.applicant'),
      sortValue: (row) => this.i18n.pick(row.request.applicantName),
    },
    {
      id: 'submitted',
      header: this.i18n.t('common.submitted'),
      sortable: true,
      hideBelow: 'lg',
      width: '9rem',
      sortValue: (row) => timestampOf(row.request.submittedAt, 0),
    },
    { id: 'priority', header: this.i18n.t('common.priority'), width: '7.5rem' },
    { id: 'state', header: this.i18n.t('officer.stateColumn'), hideBelow: 'md' },
    {
      id: 'deadline',
      header: this.i18n.t('officer.slaColumn'),
      sortable: true,
      width: '13rem',
      sortValue: (row) => timestampOf(row.request.dueAt, Number.MAX_SAFE_INTEGER),
    },
  ]);

  /** Stable reference so the table is not handed a new function every render. */
  protected readonly rowLink = (row: QueueRow): unknown[] => ['/officer', row.request.reference];

  protected serviceName(request: ServiceRequest): string {
    return serviceNameOf(request, this.i18n);
  }

  protected currentState(request: ServiceRequest): string {
    return stateName(request, this.i18n);
  }

  protected priorityTone(priority: RequestPriority) {
    return priorityPresentation(priority).tone;
  }

  protected priorityIcon(priority: RequestPriority) {
    return priorityPresentation(priority).icon;
  }

  protected slaTone(sla: SlaState) {
    return slaPresentation(sla.status).tone;
  }

  protected slaIcon(sla: SlaState) {
    return slaPresentation(sla.status).icon;
  }

  protected slaLabelKey(sla: SlaState): string {
    return slaPresentation(sla.status).labelKey;
  }

  /** "2 d 6 h left" or "4 h 10 min overdue", beside the chip that names the state. */
  protected slaCountdown(sla: SlaState): string | null {
    if (sla.remainingMs === null) {
      return null;
    }
    const time = this.i18n.formatDuration(Math.abs(sla.remainingMs));
    return sla.remainingMs >= 0
      ? this.i18n.t('sla.remaining', { time })
      : this.i18n.t('sla.overdue', { time });
  }

  protected clearFilters(): void {
    this.searchControl.setValue('');
    this.assignmentControl.setValue(DEFAULT_ASSIGNMENT);
    this.serviceControl.setValue('');
    this.priorityControl.setValue('');
    this.slaControl.setValue('');
  }
}

/** Missing dates sort to a caller chosen end rather than to 1970. */
function timestampOf(value: string | null, fallback: number): number {
  return value === null ? fallback : new Date(value).getTime();
}
