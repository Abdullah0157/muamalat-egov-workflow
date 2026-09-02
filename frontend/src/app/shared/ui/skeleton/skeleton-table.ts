import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Skeleton } from './skeleton';

/**
 * A table shaped placeholder.
 *
 * Several screens open on a table, and a single grey block where a table is
 * about to appear causes the page to jump when the rows arrive. This keeps the
 * row rhythm and the header band, so the layout settles once rather than twice.
 *
 * Rendered as a grid rather than as a real `<table>`: an empty table with no
 * headers is worse for assistive technology than a shape it never sees, and the
 * whole thing is hidden from it anyway.
 */
@Component({
  selector: 'app-skeleton-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  styleUrl: './skeleton.scss',
  host: {
    class: 'skeleton-host',
  },
  template: `
    <div class="skeleton-table" aria-hidden="true" [style.--skeleton-columns]="columns()">
      <div class="skeleton-table__row skeleton-table__row--header">
        @for (column of columnIndices(); track column) {
          <app-skeleton variant="block" height="0.7rem" width="70%" />
        }
      </div>

      @for (row of rowIndices(); track row) {
        <div class="skeleton-table__row">
          @for (column of columnIndices(); track column) {
            <app-skeleton variant="block" height="0.7rem" />
          }
        </div>
      }
    </div>

    @if (label() !== null) {
      <span class="u-visually-hidden" role="status">{{ announcement() }}</span>
    }
  `,
})
export class SkeletonTable {
  readonly rows = input(5);
  readonly columns = input(4);

  /** Same contract as `Skeleton`: unset is silent, empty string is the default wording. */
  readonly label = input<string | null>(null);

  private readonly i18n = inject(I18nService);

  protected readonly rowIndices = computed(() =>
    Array.from({ length: Math.max(1, this.rows()) }, (_, index) => index),
  );
  protected readonly columnIndices = computed(() =>
    Array.from({ length: Math.max(1, this.columns()) }, (_, index) => index),
  );

  protected readonly announcement = computed(() => this.label() || this.i18n.t('table.loadingRows'));
}
