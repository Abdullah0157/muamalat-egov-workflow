import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';

import { DataGateway } from '../../core/data/data-gateway';
import { DashboardMetrics, DashboardPeriod } from '../../core/data/metrics';
import { slaStateFor } from '../../core/data/sla';
import { I18nService } from '../../core/i18n/i18n.service';
import { Badge, BadgeTone } from '../../shared/ui/badge/badge';
import { Card } from '../../shared/ui/card/card';
import {
  DataTable,
  DataTableCellDirective,
  DataTableColumn,
} from '../../shared/ui/data-table/data-table';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { IconName } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { SkeletonTable } from '../../shared/ui/skeleton/skeleton-table';
import { StatTile, StatTileTone } from '../../shared/ui/stat-tile/stat-tile';
import { slaPresentation } from '../../shared/ui/status/status-presentation';
import { departmentFor, serviceFor, stateName } from '../shared/request-presentation';
import { BottleneckList } from './bottleneck-list';
import { ThroughputChart } from './throughput-chart';
import { WorkloadChart } from './workload-chart';

/**
 * Where the closed-within-target figure stops being reassuring.
 *
 * Named constants rather than numbers buried in a ternary, because these are the
 * thresholds an oversight team argues about and they have to be findable.
 */
const ON_TIME_GOOD = 0.9;
const ON_TIME_FAIR = 0.75;

interface PeriodOption {
  readonly value: DashboardPeriod;
  readonly labelKey: string;
}

const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { value: 'last30', labelKey: 'supervisor.period30' },
  { value: 'last90', labelKey: 'supervisor.period90' },
  { value: 'all', labelKey: 'supervisor.periodAll' },
];

/** One headline figure, already formatted and already explained. */
interface KpiTile {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly tone: StatTileTone;
  readonly icon: IconName;
}

/** A case that is at risk or already past its deadline. */
interface AttentionRow {
  readonly id: string;
  readonly reference: string;
  readonly service: string;
  readonly department: string;
  readonly state: string;
  readonly slaTone: BadgeTone;
  readonly slaIcon: IconName;
  readonly slaLabel: string;
}

/** A case raised to a supervisor, with how long it has been sitting there. */
interface EscalationViewRow {
  readonly id: string;
  readonly reference: string;
  readonly service: string;
  readonly department: string;
  readonly raised: string;
  readonly age: string;
  /** Raw values so the table sorts chronologically rather than alphabetically. */
  readonly raisedAt: number;
  readonly ageMs: number;
}

/**
 * The oversight dashboard.
 *
 * Every number and every bar on this screen comes out of the single
 * `DashboardMetrics` object the gateway returns for the selected period. Nothing
 * is smoothed, nothing is rounded to look better, and nothing is recomputed here
 * from a second source that could drift away from the first. Where the metrics
 * carry a null, which is what "no case closed in this period" looks like, the
 * tile says so instead of printing a zero: a zero average processing time is a
 * claim about performance, and it would be a false one.
 *
 * The one derived value on the page is the service level chip in the needs
 * attention table, and even that is derived against `metrics.to`, the instant
 * the figures were calculated, so a chip can never disagree with the count of
 * breaches above it.
 */
@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeader,
    Card,
    StatTile,
    Badge,
    DataTable,
    DataTableCellDirective,
    EmptyState,
    ErrorState,
    Skeleton,
    SkeletonTable,
    WorkloadChart,
    BottleneckList,
    ThroughputChart,
  ],
  styleUrl: './dashboard-page.scss',
  host: { class: 'page dashboard' },
  template: `
    <app-page-header
      [heading]="i18n.t('supervisor.title')"
      [description]="i18n.t('supervisor.subtitle')"
    >
      <fieldset pageHeaderActions class="dashboard__period">
        <legend class="u-overline dashboard__period-legend">
          {{ i18n.t('supervisor.period') }}
        </legend>
        <div class="dashboard__segmented">
          @for (option of periodOptions; track option.value) {
            <label class="dashboard__segment">
              <input
                type="radio"
                name="dashboard-period"
                class="dashboard__radio"
                [value]="option.value"
                [checked]="period() === option.value"
                (change)="period.set(option.value)"
              />
              <span class="dashboard__segment-face">{{ i18n.t(option.labelKey) }}</span>
            </label>
          }
        </div>
      </fieldset>
    </app-page-header>

    @if (dashboard.isLoading()) {
      <div class="u-stack-lg">
        <div class="dashboard__kpis">
          @for (tile of skeletonTiles; track tile) {
            <div class="dashboard__skeleton-tile">
              <app-skeleton variant="block" height="100%" [label]="$first ? '' : null" />
            </div>
          }
        </div>
        <div class="dashboard__charts">
          <div class="dashboard__skeleton-chart"><app-skeleton variant="block" height="100%" /></div>
          <div class="dashboard__skeleton-chart"><app-skeleton variant="block" height="100%" /></div>
        </div>
        <app-skeleton-table [rows]="5" [columns]="5" />
      </div>
    } @else if (dashboard.error()) {
      <app-error-state
        [title]="i18n.t('errors.loadDashboardTitle')"
        [description]="i18n.t('errors.loadDashboardDescription')"
        (retry)="dashboard.reload()"
      />
    } @else if (metrics(); as data) {
      <div class="u-stack-lg">
        <section class="dashboard__figures" [attr.aria-label]="i18n.t('common.summary')">
          <div class="dashboard__kpis">
            @for (tile of tiles(); track tile.id) {
              <app-stat-tile
                [label]="tile.label"
                [value]="tile.value"
                [hint]="tile.hint"
                [tone]="tile.tone"
                [icon]="tile.icon"
              />
            }
          </div>
          <p class="dashboard__note">{{ i18n.t('supervisor.figuresNote') }}</p>
        </section>

        @if (data.totalInPeriod === 0) {
          <app-empty-state
            icon="chart"
            [title]="i18n.t('empty.noDataTitle')"
            [description]="i18n.t('empty.noDataDescription')"
          />
        } @else {
          <div class="dashboard__charts">
            <app-card>
              <span cardTitle>{{ i18n.t('supervisor.workloadTitle') }}</span>
              <span cardSubtitle>{{ i18n.t('supervisor.workloadDescription') }}</span>
              @if (data.workload.length === 0) {
                <app-empty-state
                  [title]="i18n.t('empty.noDataTitle')"
                  [description]="i18n.t('empty.noDataDescription')"
                />
              } @else {
                <app-workload-chart [rows]="data.workload" />
              }
            </app-card>

            <app-card>
              <span cardTitle>{{ i18n.t('supervisor.bottleneckTitle') }}</span>
              <span cardSubtitle>{{ i18n.t('supervisor.bottleneckDescription') }}</span>
              @if (data.bottlenecks.length === 0) {
                <app-empty-state
                  [title]="i18n.t('empty.noDataTitle')"
                  [description]="i18n.t('empty.noDataDescription')"
                />
              } @else {
                <app-bottleneck-list [rows]="data.bottlenecks" />
              }
            </app-card>
          </div>

          <app-card>
            <span cardTitle>{{ i18n.t('supervisor.throughputTitle') }}</span>
            <span cardSubtitle>{{ i18n.t('supervisor.throughputDescription') }}</span>
            @if (data.throughput.length === 0) {
              <app-empty-state
                [title]="i18n.t('empty.noDataTitle')"
                [description]="i18n.t('empty.noDataDescription')"
              />
            } @else {
              <app-throughput-chart [points]="data.throughput" />
            }
          </app-card>

          <app-card flush>
            <span cardTitle>{{ i18n.t('supervisor.atRiskTitle') }}</span>
            <span cardSubtitle>{{ i18n.t('supervisor.atRiskDescription') }}</span>

            <app-data-table
              [rows]="attention()"
              [columns]="attentionColumns()"
              [caption]="i18n.t('supervisor.atRiskTitle')"
              [rowLink]="attentionLink"
            >
              <ng-template appDataTableCell="reference" [appDataTableCellFor]="attention()" let-row>
                <span class="u-reference">{{ row.reference }}</span>
              </ng-template>
              <ng-template appDataTableCell="service" [appDataTableCellFor]="attention()" let-row>
                {{ row.service }}
              </ng-template>
              <ng-template appDataTableCell="department" [appDataTableCellFor]="attention()" let-row>
                {{ row.department }}
              </ng-template>
              <ng-template appDataTableCell="state" [appDataTableCellFor]="attention()" let-row>
                {{ row.state }}
              </ng-template>
              <ng-template appDataTableCell="sla" [appDataTableCellFor]="attention()" let-row>
                <app-badge [tone]="row.slaTone" [icon]="row.slaIcon" size="sm">
                  {{ row.slaLabel }}
                </app-badge>
              </ng-template>

              <app-empty-state
                dataTableEmpty
                icon="check-circle"
                [title]="i18n.t('supervisor.noBreaches')"
              />
            </app-data-table>
          </app-card>

          <app-card flush>
            <span cardTitle>{{ i18n.t('supervisor.escalationsTitle') }}</span>
            <span cardSubtitle>{{ i18n.t('supervisor.escalationsDescription') }}</span>

            <app-data-table
              [rows]="escalations()"
              [columns]="escalationColumns()"
              [caption]="i18n.t('supervisor.escalationsTitle')"
              [rowLink]="escalationLink"
            >
              <ng-template
                appDataTableCell="reference"
                [appDataTableCellFor]="escalations()"
                let-row
              >
                <span class="u-reference">{{ row.reference }}</span>
              </ng-template>
              <ng-template appDataTableCell="service" [appDataTableCellFor]="escalations()" let-row>
                {{ row.service }}
              </ng-template>
              <ng-template
                appDataTableCell="department"
                [appDataTableCellFor]="escalations()"
                let-row
              >
                {{ row.department }}
              </ng-template>
              <ng-template appDataTableCell="raised" [appDataTableCellFor]="escalations()" let-row>
                <span class="dashboard__raised">{{ row.raised }}</span>
              </ng-template>

              <ng-template appDataTableCell="age" [appDataTableCellFor]="escalations()" let-row>
                <span class="dashboard__age u-numeric">{{ row.age }}</span>
              </ng-template>

              <app-empty-state
                dataTableEmpty
                icon="flag"
                [title]="i18n.t('empty.noEscalationsTitle')"
                [description]="i18n.t('empty.noEscalationsDescription')"
              />
            </app-data-table>
          </app-card>
        }
      </div>
    }
  `,
})
export class DashboardPage {
  protected readonly i18n = inject(I18nService);
  private readonly gateway = inject(DataGateway);

  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly period = signal<DashboardPeriod>('last30');

  /** Six placeholders, one per tile, so the layout settles once. */
  protected readonly skeletonTiles = Array.from({ length: 6 }, (_, index) => index);

  protected readonly dashboard = resource<DashboardMetrics | null, { period: DashboardPeriod }>({
    params: () => ({ period: this.period() }),
    loader: ({ params }) => this.gateway.getDashboard(params.period),
    defaultValue: null,
  });

  /**
   * `resource.value()` throws while the resource is in the error state, so the
   * error is checked first here as well as in the template. That makes every
   * computed below safe to read from anywhere, not only from the success branch.
   */
  protected readonly metrics = computed<DashboardMetrics | null>(() =>
    this.dashboard.error() ? null : this.dashboard.value(),
  );

  protected readonly tiles = computed<readonly KpiTile[]>(() => {
    const data = this.metrics();
    if (!data) {
      return [];
    }
    const notAvailable = this.i18n.t('common.notAvailable');

    return [
      {
        id: 'open',
        label: this.i18n.t('supervisor.kpiOpen'),
        value: this.i18n.formatNumber(data.open),
        hint: this.i18n.t('supervisor.kpiOpenHint'),
        tone: 'neutral',
        icon: 'inbox',
      },
      {
        id: 'atRisk',
        label: this.i18n.t('supervisor.kpiAtRisk'),
        value: this.i18n.formatNumber(data.atRisk),
        hint: this.i18n.t('supervisor.kpiAtRiskHint'),
        tone: data.atRisk > 0 ? 'warning' : 'neutral',
        icon: 'hourglass',
      },
      {
        id: 'breached',
        // Zero breaches is a real, and good, figure. It is the one place on this
        // screen where a zero is printed rather than suppressed.
        label: this.i18n.t('supervisor.kpiBreached'),
        value: this.i18n.formatNumber(data.breached),
        hint: this.i18n.t('supervisor.kpiBreachedHint'),
        tone: data.breached > 0 ? 'danger' : 'success',
        icon: 'alert-triangle',
      },
      {
        id: 'average',
        label: this.i18n.t('supervisor.kpiAverage'),
        value:
          data.averageProcessingMs === null
            ? notAvailable
            : this.i18n.formatDuration(data.averageProcessingMs),
        hint: this.i18n.t('supervisor.kpiAverageHint'),
        tone: 'neutral',
        icon: 'clock',
      },
      {
        id: 'onTimeRate',
        label: this.i18n.t('supervisor.kpiOnTimeRate'),
        value:
          data.onTimeRate === null ? notAvailable : this.i18n.formatPercent(data.onTimeRate),
        hint: this.i18n.t('supervisor.kpiOnTimeRateHint'),
        tone: onTimeTone(data.onTimeRate),
        icon: 'check-circle',
      },
      {
        id: 'escalations',
        label: this.i18n.t('supervisor.kpiEscalations'),
        value: this.i18n.formatNumber(data.escalations),
        hint: this.i18n.t('supervisor.kpiEscalationsHint'),
        tone: 'neutral',
        icon: 'flag',
      },
    ];
  });

  protected readonly attentionColumns = computed<readonly DataTableColumn<AttentionRow>[]>(() => [
    { id: 'reference', header: this.i18n.t('common.reference'), primary: true },
    { id: 'service', header: this.i18n.t('common.service') },
    { id: 'department', header: this.i18n.t('common.department'), hideBelow: 'lg' },
    // The catalogue has no generic "current state" heading, and "Stage" means
    // something else in this product, so the workflow state wording is reused.
    { id: 'state', header: this.i18n.t('common.workflowState'), hideBelow: 'md' },
    { id: 'sla', header: this.i18n.t('sla.label') },
  ]);

  protected readonly escalationColumns = computed<readonly DataTableColumn<EscalationViewRow>[]>(
    () => [
      { id: 'reference', header: this.i18n.t('common.reference'), primary: true },
      { id: 'service', header: this.i18n.t('common.service') },
      { id: 'department', header: this.i18n.t('common.department'), hideBelow: 'lg' },
      {
        id: 'raised',
        header: this.i18n.t('supervisor.escalationRaised'),
        sortable: true,
        sortValue: (row) => row.raisedAt,
      },
      {
        id: 'age',
        header: this.i18n.t('supervisor.escalationAge'),
        sortable: true,
        numeric: true,
        align: 'end',
        sortValue: (row) => row.ageMs,
      },
    ],
  );

  /**
   * The cases already ordered by deadline in the metrics, decorated with the
   * chip a supervisor reads first. The service level is recomputed against
   * `metrics.to`, the instant the figures were calculated, so the chip and the
   * breach count can never tell two different stories.
   */
  protected readonly attention = computed<readonly AttentionRow[]>(() => {
    const data = this.metrics();
    if (!data) {
      return [];
    }
    const asOf = new Date(data.to);

    return data.attentionCases.map((request) => {
      const sla = slaStateFor(request, asOf);
      const presentation = slaPresentation(sla.status);
      return {
        id: request.id,
        reference: request.reference,
        service: this.i18n.pick(serviceFor(request)?.name),
        department: this.i18n.pick(departmentFor(request)?.name),
        state: stateName(request, this.i18n),
        slaTone: presentation.tone,
        slaIcon: presentation.icon,
        slaLabel: this.slaCounter(sla.remainingMs),
      };
    });
  });

  protected readonly escalations = computed<readonly EscalationViewRow[]>(() => {
    const data = this.metrics();
    if (!data) {
      return [];
    }
    // Already oldest first in the metrics, which is the order a supervisor needs.
    return data.escalatedCases.map((row) => ({
      id: row.requestId,
      reference: row.reference,
      service: this.i18n.pick(row.serviceName),
      department: this.i18n.pick(row.departmentName),
      raised: this.i18n.formatDate(row.raisedAt),
      age: this.i18n.formatDuration(row.ageMs),
      raisedAt: new Date(row.raisedAt).getTime(),
      ageMs: row.ageMs,
    }));
  });

  /** A supervisor who opens one of these rows is going there to act on it. */
  protected readonly attentionLink = (row: AttentionRow): unknown[] => ['/officer', row.reference];

  protected readonly escalationLink = (row: EscalationViewRow): unknown[] => [
    '/officer',
    row.reference,
  ];

  /** "2 d 4 h overdue" or "6 h 10 min left", never a bare number of hours. */
  private slaCounter(remainingMs: number | null): string {
    if (remainingMs === null) {
      return this.i18n.t('sla.notApplicable');
    }
    const time = this.i18n.formatDuration(Math.abs(remainingMs));
    return remainingMs < 0
      ? this.i18n.t('sla.overdue', { time })
      : this.i18n.t('sla.remaining', { time });
  }
}

/** Null keeps the tile neutral: an unknown rate is not a bad rate. */
function onTimeTone(rate: number | null): StatTileTone {
  if (rate === null) {
    return 'neutral';
  }
  if (rate >= ON_TIME_GOOD) {
    return 'success';
  }
  return rate >= ON_TIME_FAIR ? 'warning' : 'danger';
}
