import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * The standard panel.
 *
 * Structure comes from a single hairline border rather than a shadow, which is
 * what keeps a page full of these reading as one document instead of a pile of
 * floating tiles. Shadows are reserved for surfaces that genuinely float:
 * dialogs, drawers, menus and toasts.
 *
 * Slots:
 *   [cardTitle]    heading text
 *   [cardSubtitle] one line of supporting text
 *   [cardActions]  controls aligned to the trailing edge of the header
 *   default        body
 *   [cardFooter]   footer bar
 */
@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './card.scss',
  host: {
    class: 'card',
    '[class.card--flush]': 'flush()',
    '[class.card--sunken]': 'sunken()',
  },
  template: `
    @if (hasHeader()) {
      <header class="card__header">
        <div class="card__heading">
          <h2 class="card__title" [attr.id]="titleId()">
            <ng-content select="[cardTitle]" />
          </h2>
          <p class="card__subtitle">
            <ng-content select="[cardSubtitle]" />
          </p>
        </div>
        <div class="card__actions">
          <ng-content select="[cardActions]" />
        </div>
      </header>
    }

    <div class="card__body">
      <ng-content />
    </div>

    <div class="card__footer">
      <ng-content select="[cardFooter]" />
    </div>
  `,
})
export class Card {
  /**
   * Set when the card has a title. Kept explicit rather than detected from
   * projected content so the heading level and the border are predictable.
   */
  readonly hasHeader = input(true, { transform: booleanAttribute });

  /** Removes body padding, for cards whose content is a table or a canvas. */
  readonly flush = input(false, { transform: booleanAttribute });

  /** Uses the sunken surface, for a panel nested inside another panel. */
  readonly sunken = input(false, { transform: booleanAttribute });

  /** Point a `aria-labelledby` at this from a region that the card labels. */
  readonly titleId = input<string | null>(null);
}
