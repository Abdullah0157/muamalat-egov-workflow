import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { DepartmentWorkload } from '../../core/data/metrics';
import { I18nService } from '../../core/i18n/i18n.service';
import { nextControlId } from '../../shared/ui/field/field';

/**
 * The three service level buckets, in the order they stack along a bar.
 *
 * `shape` is not decoration: it is the second channel that carries the same
 * distinction the colour does, so the legend still separates the three buckets
 * on a greyscale printout or for a reader with a colour vision deficiency.
 */
const BUCKETS = [
  { key: 'onTrack', modifier: 'on-track', labelKey: 'sla.onTrack' },
  { key: 'atRisk', modifier: 'at-risk', labelKey: 'sla.atRisk' },
  { key: 'breached', modifier: 'breached', labelKey: 'sla.breached' },
] as const;

/** One coloured run inside a department's bar. Zero counts are never drawn. */
interface WorkloadSegment {
  readonly modifier: string;
  readonly labelKey: string;
  readonly count: number;
  /** Share of the busiest department's open count, as a CSS percentage. */
  readonly width: string;
}

interface WorkloadBar {
  readonly departmentId: string;
  readonly name: string;
  readonly open: number;
  readonly row: DepartmentWorkload;
  readonly segments: readonly WorkloadSegment[];
}

/**
 * Open cases per department, split by service level status.
 *
 * Bars are CSS, not SVG. A flex row of percentage widths mirrors correctly in
 * Arabic without a single direction specific rule, which an SVG plot would need
 * a transform and a set of counter transforms on every label to achieve.
 *
 * The scale is shared across departments: a bar's total length is the
 * department's open count measured against the busiest department, so the chart
 * answers "who is carrying the most" as well as "how healthy is each queue".
 * A hundred percent stacked bar would have thrown the first question away.
 *
 * Every figure drawn here is repeated in the table underneath, which is the
 * accessible equivalent the chart points at with `aria-describedby`. The table
 * is visible rather than hidden because a supervisor reading a workload split
 * wants the counts, and hiding them would have served nobody.
 */
@Component({
  selector: 'app-workload-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workload-chart.scss',
  host: { class: 'workload' },
  template: `
    <ul class="workload__legend">
      @for (bucket of buckets; track bucket.key) {
        <li class="workload__legend-item">
          <span
            aria-hidden="true"
            [class]="'workload__swatch workload__swatch--' + bucket.modifier"
          ></span>
          <span>{{ i18n.t(bucket.labelKey) }}</span>
        </li>
      }
    </ul>

    <div
      class="workload__plot"
      role="img"
      [attr.aria-label]="i18n.t('a11y.chartDescription')"
      [attr.aria-describedby]="tableId"
    >
      @for (bar of bars(); track bar.departmentId) {
        <div class="workload__bar">
          <p class="workload__bar-label">
            <span class="workload__department">{{ bar.name }}</span>
            <span class="workload__count u-numeric">{{ i18n.formatNumber(bar.open) }}</span>
          </p>
          <div class="workload__track">
            @for (segment of bar.segments; track segment.modifier) {
              <span
                [class]="'workload__segment workload__segment--' + segment.modifier"
                [style.inline-size]="segment.width"
              ></span>
            }
          </div>
        </div>
      }
    </div>

    <div
      class="workload__table-scroll"
      role="group"
      tabindex="0"
      [attr.aria-label]="i18n.t('supervisor.workloadTitle')"
    >
      <table class="workload__table" [id]="tableId">
        <caption class="u-visually-hidden">
          {{ i18n.t('supervisor.workloadTitle') }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ i18n.t('supervisor.workloadDepartment') }}</th>
            <th scope="col" class="workload__numeric">
              {{ i18n.t('supervisor.workloadOpen') }}
            </th>
            @for (bucket of buckets; track bucket.key) {
              <th scope="col" class="workload__numeric">{{ i18n.t(bucket.labelKey) }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (bar of bars(); track bar.departmentId) {
            <tr>
              <th scope="row">{{ bar.name }}</th>
              <td class="workload__numeric u-numeric">{{ i18n.formatNumber(bar.open) }}</td>
              <td class="workload__numeric u-numeric">
                {{ i18n.formatNumber(bar.row.onTrack) }}
              </td>
              <td class="workload__numeric u-numeric">{{ i18n.formatNumber(bar.row.atRisk) }}</td>
              <td class="workload__numeric u-numeric">
                {{ i18n.formatNumber(bar.row.breached) }}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class WorkloadChart {
  /** Straight from `DashboardMetrics.workload`. Already ordered, busiest first. */
  readonly rows = input<readonly DepartmentWorkload[]>([]);

  protected readonly i18n = inject(I18nService);
  protected readonly buckets = BUCKETS;

  /** Unique so several charts can sit on one page without colliding ids. */
  protected readonly tableId = nextControlId('workload-table');

  /**
   * The widest bar. Read from the data rather than rounded up to a friendly
   * number, so the longest bar is always exactly full and no space is invented.
   */
  private readonly maxOpen = computed(() =>
    this.rows().reduce((largest, row) => Math.max(largest, row.open), 0),
  );

  protected readonly bars = computed<readonly WorkloadBar[]>(() => {
    const max = this.maxOpen();
    return this.rows().map((row) => ({
      departmentId: row.departmentId,
      name: this.i18n.pick(row.name),
      open: row.open,
      row,
      segments: BUCKETS.map((bucket) => ({
        modifier: bucket.modifier,
        labelKey: bucket.labelKey,
        count: row[bucket.key],
        width: max === 0 ? '0%' : `${(row[bucket.key] / max) * 100}%`,
        // A count of zero produces no segment at all. A minimum width would
        // turn "none breached" into a visible sliver of red, which is the one
        // lie a service level chart must never tell.
      })).filter((segment) => segment.count > 0),
    }));
  });
}
