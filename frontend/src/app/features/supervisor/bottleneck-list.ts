import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { BottleneckRow } from '../../core/data/metrics';
import { I18nService } from '../../core/i18n/i18n.service';

interface BottleneckEntry {
  readonly stateKey: string;
  readonly name: string;
  readonly average: string;
  readonly cases: string;
  /** Share of the slowest state's average wait, as a CSS percentage. */
  readonly width: string;
  /** False when the average is zero, so nothing is drawn for a state with no wait. */
  readonly hasBar: boolean;
}

/**
 * Where cases wait longest, ranked.
 *
 * A real table rather than a list of divs, because this is the one chart on the
 * dashboard a supervisor acts on: the averages have to be comparable straight
 * down a column, and the counts beside them decide whether a long wait is a
 * staffing problem or a single stuck file.
 *
 * The bar lives inside the average cell and is scaled against the slowest state
 * in the set, so the ranking is legible at a glance without the numbers moving
 * out of their column. Because the bar is a table cell rather than a plot, the
 * table is its own accessible equivalent and no second copy of the figures is
 * needed.
 */
@Component({
  selector: 'app-bottleneck-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bottleneck-list.scss',
  host: { class: 'bottleneck' },
  template: `
    <div
      class="bottleneck__scroll"
      role="group"
      tabindex="0"
      [attr.aria-label]="i18n.t('supervisor.bottleneckTitle')"
    >
      <table class="bottleneck__table">
        <caption class="u-visually-hidden">
          {{ i18n.t('supervisor.bottleneckTitle') }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ i18n.t('supervisor.bottleneckState') }}</th>
            <th scope="col">{{ i18n.t('supervisor.bottleneckAverage') }}</th>
            <th scope="col" class="bottleneck__numeric">
              {{ i18n.t('supervisor.bottleneckCases') }}
            </th>
          </tr>
        </thead>
        <tbody>
          @for (entry of entries(); track entry.stateKey) {
            <tr>
              <th scope="row" class="bottleneck__state">{{ entry.name }}</th>
              <td class="bottleneck__measure">
                <span class="bottleneck__track" aria-hidden="true">
                  @if (entry.hasBar) {
                    <span class="bottleneck__bar" [style.inline-size]="entry.width"></span>
                  }
                </span>
                <span class="bottleneck__value u-numeric">{{ entry.average }}</span>
              </td>
              <td class="bottleneck__numeric u-numeric">{{ entry.cases }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class BottleneckList {
  /** Straight from `DashboardMetrics.bottlenecks`. */
  readonly rows = input<readonly BottleneckRow[]>([]);

  protected readonly i18n = inject(I18nService);

  protected readonly entries = computed<readonly BottleneckEntry[]>(() => {
    // Sorted here as well as in the metrics, because a ranked list that is not
    // ranked is worse than no ranking at all and the cost is one comparison.
    const ordered = [...this.rows()].sort((a, b) => b.averageMs - a.averageMs);
    const slowest = ordered.reduce((largest, row) => Math.max(largest, row.averageMs), 0);

    return ordered.map((row) => ({
      stateKey: row.stateKey,
      name: this.i18n.pick(row.name),
      average: this.i18n.formatDuration(row.averageMs),
      cases: this.i18n.formatNumber(row.caseCount),
      width: slowest === 0 ? '0%' : `${(row.averageMs / slowest) * 100}%`,
      hasBar: row.averageMs > 0,
    }));
  });
}
