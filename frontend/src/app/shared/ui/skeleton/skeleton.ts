import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';

export type SkeletonVariant = 'text' | 'heading' | 'block' | 'circle';

/**
 * A placeholder in the shape of the thing that is loading.
 *
 * The shapes are hidden from assistive technology. Announcing "loading" once
 * per placeholder would produce a dozen announcements for one screen, so the
 * container that swaps skeletons for content normally owns the live region.
 * `label` exists for the case where a skeleton stands alone.
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './skeleton.scss',
  host: {
    class: 'skeleton-host',
  },
  template: `
    @if (variant() === 'text') {
      <span class="skeleton__lines" aria-hidden="true">
        @for (line of lineIndices(); track line) {
          <span class="skeleton skeleton--text" [style.inline-size]="lineWidth($last)"></span>
        }
      </span>
    } @else {
      <span
        class="skeleton"
        aria-hidden="true"
        [class.skeleton--heading]="variant() === 'heading'"
        [class.skeleton--block]="variant() === 'block'"
        [class.skeleton--circle]="variant() === 'circle'"
        [style.inline-size]="width()"
        [style.block-size]="height()"
      ></span>
    }

    @if (label() !== null) {
      <span class="u-visually-hidden" role="status">{{ announcement() }}</span>
    }
  `,
})
export class Skeleton {
  readonly variant = input<SkeletonVariant>('text');

  /** Number of text lines. Ignored by the other variants. */
  readonly lines = input(3);

  /** Any CSS length. Leave unset to fill the container. */
  readonly width = input<string | null>(null);
  readonly height = input<string | null>(null);

  /**
   * Announces the placeholder through a visually hidden live region. Pass an
   * empty string for the standard "loading" wording, or your own for something
   * more specific. Left unset the skeleton stays silent.
   */
  readonly label = input<string | null>(null);

  private readonly i18n = inject(I18nService);

  protected readonly lineIndices = computed(() =>
    Array.from({ length: Math.max(1, this.lines()) }, (_, index) => index),
  );

  protected readonly announcement = computed(() => this.label() || this.i18n.t('a11y.loading'));

  /** The last line stops short, which is what makes a block read as prose. */
  protected lineWidth(isLast: boolean): string {
    return this.width() ?? (isLast ? '60%' : '100%');
  }
}
