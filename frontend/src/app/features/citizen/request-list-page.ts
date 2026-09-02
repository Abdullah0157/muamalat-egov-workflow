import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { DataGateway } from '../../core/data/data-gateway';
import { isClosed, isOpen } from '../../core/data/sla';
import { I18nService } from '../../core/i18n/i18n.service';
import { ServiceRequest } from '../../core/models/domain';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TabPanel, Tabs } from '../../shared/ui/tabs/tabs';
import { CitizenRequestTable } from './request-table';

/**
 * Everything a citizen has filed.
 *
 * This is the screen someone opens to answer one question: where has my request
 * got to. So the reference number leads each row, the stage and the deadline are
 * chips rather than prose, and the whole row is a link into the record.
 *
 * The three tabs are slices of one already loaded list rather than three
 * queries. A citizen has tens of requests, not thousands, and filtering in the
 * browser means switching tabs is instant and cannot fail halfway.
 */
@Component({
  selector: 'app-request-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Card,
    CitizenRequestTable,
    EmptyState,
    ErrorState,
    PageHeader,
    TabPanel,
    Tabs,
  ],
  styleUrl: './request-list-page.scss',
  host: { class: 'page' },
  template: `
    <app-page-header
      [heading]="i18n.t('citizen.title')"
      [description]="i18n.t('citizen.subtitle')"
    >
      <div pageHeaderActions>
        <app-button variant="primary" icon="plus" (pressed)="startNewRequest()">
          {{ i18n.t('citizen.newRequest') }}
        </app-button>
      </div>
    </app-page-header>

    <!--
      Ordered so the value branch is never evaluated while the resource is in
      its error state, where reading value() throws.
    -->
    @if (requests.isLoading()) {
      <app-card [hasHeader]="false" flush>
        <app-citizen-request-table loading [caption]="i18n.t('citizen.requestListCaption')" />
      </app-card>
    } @else if (requests.error()) {
      <app-error-state
        [title]="i18n.t('errors.loadRequestsTitle')"
        [description]="i18n.t('errors.loadRequestsDescription')"
        (retry)="reload()"
      />
    } @else if (requests.value().length === 0) {
      <app-empty-state
        icon="inbox"
        [title]="i18n.t('empty.noRequestsTitle')"
        [description]="i18n.t('empty.noRequestsDescription')"
      >
        <app-button emptyStateAction variant="primary" icon="plus" (pressed)="startNewRequest()">
          {{ i18n.t('empty.noRequestsAction') }}
        </app-button>
      </app-empty-state>
    } @else {
      <app-tabs [ariaLabel]="i18n.t('citizen.requestListCaption')">
        <app-tab-panel
          [label]="i18n.t('citizen.openRequests')"
          [badge]="i18n.formatNumber(openRequests().length)"
        >
          <app-card [hasHeader]="false" flush>
            <app-citizen-request-table
              [rows]="openRequests()"
              [caption]="captionFor('citizen.openRequests')"
            />
          </app-card>
        </app-tab-panel>

        <app-tab-panel
          [label]="i18n.t('citizen.closedRequests')"
          [badge]="i18n.formatNumber(closedRequests().length)"
        >
          <app-card [hasHeader]="false" flush>
            <app-citizen-request-table
              [rows]="closedRequests()"
              [caption]="captionFor('citizen.closedRequests')"
            />
          </app-card>
        </app-tab-panel>

        <app-tab-panel
          [label]="i18n.t('citizen.allRequests')"
          [badge]="i18n.formatNumber(requests.value().length)"
        >
          <app-card [hasHeader]="false" flush>
            <app-citizen-request-table
              [rows]="requests.value()"
              [caption]="captionFor('citizen.allRequests')"
            />
          </app-card>
        </app-tab-panel>
      </app-tabs>
    }
  `,
})
export class RequestListPage {
  protected readonly i18n = inject(I18nService);

  private readonly gateway = inject(DataGateway);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /**
   * Keyed on the signed in account, so switching account through the prototype
   * controls reloads the list rather than showing the previous person's files.
   */
  protected readonly requests = resource({
    params: () => ({ applicantId: this.auth.user()?.id ?? null }),
    loader: async ({ params }) =>
      params.applicantId ? this.gateway.listRequestsForApplicant(params.applicantId) : [],
    defaultValue: [] as readonly ServiceRequest[],
  });

  /**
   * Open and closed come from the shared service level rules rather than from a
   * status list written here, which is what keeps this tab agreeing with the
   * officer queue about what "open" means.
   */
  protected readonly openRequests = computed(() => this.requests.value().filter(isOpen));
  protected readonly closedRequests = computed(() => this.requests.value().filter(isClosed));

  protected reload(): void {
    this.requests.reload();
  }

  protected startNewRequest(): void {
    void this.router.navigate(['/citizen', 'new']);
  }

  /**
   * "Your requests, open". Each tab holds its own table, and a caption that read
   * the same on all three would announce three identical tables.
   */
  protected captionFor(tabKey: string): string {
    return `${this.i18n.t('citizen.requestListCaption')}, ${this.i18n.t(tabKey)}`;
  }
}
