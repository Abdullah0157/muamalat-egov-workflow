import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { I18nService } from '../core/i18n/i18n.service';
import { User } from '../core/models/domain';
import { Badge } from '../shared/ui/badge/badge';
import { Button } from '../shared/ui/button/button';
import { Icon } from '../shared/ui/icon/icon';
import { NavSection } from './nav-model';

/**
 * The navigation rail.
 *
 * Split out of the shell because it is a self contained unit with its own
 * concerns: which sections a role can see, which link is current, and who is
 * signed in. Where the rail sits, and whether it is a permanent column or an off
 * canvas panel, stays with the shell, which owns the page layout.
 */
@Component({
  selector: 'app-primary-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon, Badge, Button],
  styleUrl: './primary-nav.scss',
  template: `
    <nav id="primary-navigation" class="nav" [attr.aria-label]="i18n.t('nav.primary')">
      <div class="nav__scroll">
        @for (section of sections(); track section.labelKey) {
          <div class="nav__section">
            <h2 class="nav__heading u-overline">{{ i18n.t(section.labelKey) }}</h2>
            <ul class="nav__list">
              @for (item of section.items; track item.link) {
                <li>
                  <a
                    class="nav__link"
                    [routerLink]="item.link"
                    routerLinkActive="nav__link--active"
                    [routerLinkActiveOptions]="{ exact: item.exact }"
                    #active="routerLinkActive"
                    [attr.aria-current]="active.isActive ? 'page' : null"
                  >
                    <app-icon [name]="item.icon" size="md" />
                    <span>{{ i18n.t(item.labelKey) }}</span>
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </div>

      @if (user(); as account) {
        <div class="nav__account">
          <p class="nav__account-label u-overline">{{ i18n.t('auth.signedInAs') }}</p>
          <p class="nav__account-name">{{ i18n.pick(account.name) }}</p>
          <app-badge tone="brand" size="sm" icon="user">
            {{ i18n.t('roles.' + account.role) }}
          </app-badge>
          <app-button
            class="nav__signout"
            variant="ghost"
            size="sm"
            icon="sign-out"
            block
            (pressed)="signOut.emit()"
          >
            {{ i18n.t('common.signOut') }}
          </app-button>
        </div>
      }
    </nav>
  `,
})
export class PrimaryNav {
  readonly sections = input.required<readonly NavSection[]>();
  readonly user = input.required<User | null>();

  readonly signOut = output<void>();

  protected readonly i18n = inject(I18nService);
}
