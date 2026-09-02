import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { ThroughputPoint } from '../../core/data/metrics';
import { I18nService } from '../../core/i18n/i18n.service';
import { nextControlId } from '../../shared/ui/field/field';

/** The two series, in the order they appear in every group and in the legend. */
const SERIES = [
  { key: 'submitted', modifier: 'submitted', labelKey: 'supervisor.throughputSubmitted' },
  { key: 'closed', modifier: 'closed', labelKey: 'supervisor.throughputClosed' },
] as const;

interface ThroughputBar {
  readonly modifier: string;
  readonly count: number;
  /** Share of the tallest bar in the series, as a CSS percentage. */
  readonly height: string;
}

interface ThroughputGroup {
  readonly weekStart: string;
  readonly label: string;
  readonly submitted: string;
  readonly closed: string;
  readonly bars: readonly ThroughputBar[];
}

/**
 * Cases submitted against cases closed, by week.
 *
 * Two bars per week rather than two lines, because the question is "did we clear
 * as much as arrived" and a pair of adjacent bars answers it without the reader
 * tracing two paths. Both series are counts of the same thing on the same scale,
 * so there is one axis: a second axis here would invent a relationship between
 * the series that the data does not contain.
 *
 * Laid out with `flex-direction: row`, which means the weeks read right to left
 * in Arabic for free, and the bars grow from a shared baseline with percentage
 * heights taken from the tallest value in the series. The whole plot scrolls
 * inside its own container so a narrow screen never scrolls the page sideways.
 */
@Component({
  selector: 'app-throughput-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './throughput-chart.scss',
  host: { class: 'throughput' },
  template: `
    <ul class="throughput__legend">
      @for (series of series; track series.key) {
        <li class="throughput__legend-item">
          <span
            aria-hidden="true"
            [class]="'throughput__swatch throughput__swatch--' + series.modifier"
          ></span>
          <span>{{ i18n.t(series.labelKey) }}</span>
        </li>
      }
    </ul>

    <div class="throughput__plot">
      <div class="throughput__axis" aria-hidden="true">
        <span class="throughput__tick">{{ maxLabel() }}</span>
        <span class="throughput__tick">{{ zeroLabel() }}</span>
      </div>

      <div
        class="throughput__scroll"
        role="img"
        tabindex="0"
        [attr.aria-label]="i18n.t('a11y.chartDescription')"
        [attr.aria-describedby]="tableId"
      >
        <div class="throughput__groups">
          @for (group of groups(); track group.weekStart) {
            <div class="throughput__group">
              <div class="throughput__bars">
                @for (bar of group.bars; track bar.modifier) {
                  <span class="throughput__slot">
                    @if (bar.count > 0) {
                      <span
                        [class]="'throughput__bar throughput__bar--' + bar.modifier"
                        [style.block-size]="bar.height"
                      ></span>
                    }
                  </span>
                }
              </div>
              <p class="throughput__label">{{ group.label }}</p>
            </div>
          }
        </div>
      </div>
    </div>

    <div
      class="throughput__table-scroll"
      role="group"
      tabindex="0"
      [attr.aria-label]="i18n.t('supervisor.throughputTitle')"
    >
      <table class="throughput__table" [id]="tableId">
        <caption class="u-visually-hidden">
          {{ i18n.t('supervisor.throughputTitle') }}
        </caption>
        <thead>
          <tr>
            <!-- The catalogue has no bare "week" heading; the column holds time
                 periods, so "Period" is the closest existing wording. -->
            <th scope="col">{{ i18n.t('supervisor.weekColumn') }}</th>
            @for (series of series; track series.key) {
              <th scope="col" class="throughput__numeric">{{ i18n.t(series.labelKey) }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (group of groups(); track group.weekStart) {
            <tr>
              <th scope="row">{{ group.label }}</th>
              <td class="throughput__numeric u-numeric">{{ group.submitted }}</td>
              <td class="throughput__numeric u-numeric">{{ group.closed }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ThroughputChart {
  /** Straight from `DashboardMetrics.throughput`, oldest week first. */
  readonly points = input<readonly ThroughputPoint[]>([]);

  protected readonly i18n = inject(I18nService);
  protected readonly series = SERIES;
  protected readonly tableId = nextControlId('throughput-table');

  /**
   * The tallest bar in the whole series. Taken from the data rather than rounded
   * up to a tidy axis maximum, so the top gridline is a figure that really
   * occurred rather than a number nobody reported.
   */
  private readonly peak = computed(() =>
    this.points().reduce((largest, point) => Math.max(largest, point.submitted, point.closed), 0),
  );

  protected readonly maxLabel = computed(() => this.i18n.formatNumber(this.peak()));
  protected readonly zeroLabel = computed(() => this.i18n.formatNumber(0));

  protected readonly groups = computed<readonly ThroughputGroup[]>(() => {
    const peak = this.peak();
    return this.points().map((point) => ({
      weekStart: point.weekStart,
      label: this.i18n.t('supervisor.week', {
        date: this.i18n.formatDate(point.weekStart, { day: 'numeric', month: 'short' }),
      }),
      submitted: this.i18n.formatNumber(point.submitted),
      closed: this.i18n.formatNumber(point.closed),
      bars: SERIES.map((series) => ({
        modifier: series.modifier,
        count: point[series.key],
        height: peak === 0 ? '0%' : `${(point[series.key] / peak) * 100}%`,
      })),
    }));
  });
}
