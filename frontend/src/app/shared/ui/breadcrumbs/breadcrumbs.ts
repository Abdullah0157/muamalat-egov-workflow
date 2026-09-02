import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Icon } from '../icon/icon';

export interface BreadcrumbItem {
  /** Already localised. */
  readonly label: string;
  /** Anything `routerLink` accepts. Omit it for a step that is not navigable. */
  readonly link?: string | unknown[];
}

/**
 * The trail back out of a record.
 *
 * The last crumb is the page you are on, so it is text with `aria-current`
 * rather than a link to where you already are. Separators are `chevron-next`
 * icons, which mirror themselves in Arabic, and they are hidden from assistive
 * technology because the list already conveys the nesting.
 *
 * On a narrow screen the middle of the trail collapses to an ellipsis, keeping
 * the root and the last two steps. That is done in CSS rather than by measuring
 * the viewport, so there is no resize listener and no layout shift after the
 * first paint.
 */
@Component({
  selector: 'app-breadcrumbs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  styleUrl: './breadcrumbs.scss',
  host: {
    class: 'breadcrumbs',
  },
  template: `
    <nav [attr.aria-label]="i18n.t('a11y.breadcrumb')">
      <ol class="breadcrumbs__list">
        @for (item of items(); track $index) {
          @if ($index === 1 && collapses()) {
            <li class="breadcrumbs__ellipsis" aria-hidden="true">
              <span class="breadcrumbs__crumb">&hellip;</span>
              <app-icon name="chevron-next" size="sm" class="breadcrumbs__separator" />
            </li>
          }

          <li class="breadcrumbs__item" [class.breadcrumbs__item--collapsible]="collapsible($index)">
            @if (!$last && item.link) {
              <a class="breadcrumbs__crumb breadcrumbs__link" [routerLink]="item.link">{{ item.label }}</a>
            } @else {
              <span class="breadcrumbs__crumb" [attr.aria-current]="$last ? 'page' : null">
                {{ item.label }}
              </span>
            }

            @if (!$last) {
              <app-icon name="chevron-next" size="sm" class="breadcrumbs__separator" />
            }
          </li>
        }
      </ol>
    </nav>
  `,
})
export class Breadcrumbs {
  readonly items = input.required<readonly BreadcrumbItem[]>();

  protected readonly i18n = inject(I18nService);

  /** Below four steps there is nothing worth hiding. */
  protected readonly collapses = computed(() => this.items().length > 3);

  protected collapsible(index: number): boolean {
    return this.collapses() && index >= 1 && index <= this.items().length - 3;
  }
}
