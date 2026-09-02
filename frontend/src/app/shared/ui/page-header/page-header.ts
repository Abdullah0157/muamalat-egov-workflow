import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A breadcrumb entry, kept here so a caller can type its trail without pulling
 * in the breadcrumbs component. The trail itself is projected rather than taken
 * as an input: the header should not care whether the caller renders
 * `app-breadcrumbs`, a back link, or nothing at all.
 */
export interface PageHeaderBreadcrumb {
  readonly label: string;
  readonly link?: string | unknown[];
}

/**
 * The top of every screen.
 *
 * One `<h1>` per page lives here, which is what makes "skip to main content"
 * followed by a heading jump work across the whole product. Actions sit at the
 * trailing edge on a wide screen and drop under the heading on a narrow one,
 * rather than being squeezed or hidden.
 *
 * Slots:
 *   [pageHeaderBreadcrumbs] the trail, above the heading
 *   [pageHeaderMeta]        chips and metadata under the heading
 *   [pageHeaderActions]     controls at the trailing edge
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './page-header.scss',
  host: {
    class: 'page-header',
  },
  template: `
    <div class="page-header__breadcrumbs">
      <ng-content select="[pageHeaderBreadcrumbs]" />
    </div>

    <div class="page-header__bar">
      <div class="page-header__heading">
        <h1 class="page-header__title">{{ heading() }}</h1>
        @if (description(); as summary) {
          <p class="page-header__description">{{ summary }}</p>
        }
        <div class="page-header__meta">
          <ng-content select="[pageHeaderMeta]" />
        </div>
      </div>

      <div class="page-header__actions">
        <ng-content select="[pageHeaderActions]" />
      </div>
    </div>
  `,
})
export class PageHeader {
  readonly heading = input.required<string>();

  /** One or two lines saying what this screen is for. Optional, never padding. */
  readonly description = input<string | null>(null);
}
