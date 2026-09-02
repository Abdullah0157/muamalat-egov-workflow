import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';

import { slaStateFor } from '../../core/data/sla';
import { I18nService } from '../../core/i18n/i18n.service';
import { ServiceRequest } from '../../core/models/domain';
import { Badge } from '../../shared/ui/badge/badge';
import {
  DataTable,
  DataTableCellDirective,
  DataTableColumn,
} from '../../shared/ui/data-table/data-table';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import {
  requestStatusPresentation,
  slaPresentation,
} from '../../shared/ui/status/status-presentation';
import { serviceFor } from '../shared/request-presentation';

/**
 * The citizen's list of requests, as a table.
 *
 * Extracted from the page because the three tabs (open, closed, everything) are
 * the same table over three slices of the same records, and three copies of the
 * column definitions would drift apart the first time a column changed.
 *
 * The empty state projected here is always the "nothing matches this tab" one.
 * Having no requests at all is a different situation with different copy and a
 * different action, and the page handles that before it renders any tabs.
 */
@Component({
  selector: 'app-citizen-request-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, DataTable, DataTableCellDirective, EmptyState],
  styleUrl: './request-table.scss',
  host: {
    class: 'citizen-request-table',
  },
  template: `
    <app-data-table
      [rows]="rows()"
      [columns]="columns()"
      [caption]="caption()"
      [loading]="loading()"
      [rowLink]="rowLink"
    >
      <ng-template appDataTableCell="reference" [appDataTableCellFor]="rows()" let-row>
        <span class="u-reference">{{ row.reference }}</span>
      </ng-template>

      <ng-template appDataTableCell="service" [appDataTableCellFor]="rows()" let-row>
        {{ serviceName(row) }}
      </ng-template>

      <ng-template appDataTableCell="submitted" [appDataTableCellFor]="rows()" let-row>
        <time [attr.datetime]="filedAt(row)">{{ i18n.formatDate(filedAt(row)) }}</time>
      </ng-template>

      <ng-template appDataTableCell="status" [appDataTableCellFor]="rows()" let-row>
        <app-badge
          size="sm"
          [tone]="statusOf(row).tone"
          [icon]="statusOf(row).icon"
        >
          {{ i18n.t(statusOf(row).labelKey) }}
        </app-badge>
      </ng-template>

      <ng-template appDataTableCell="sla" [appDataTableCellFor]="rows()" let-row>
        <span class="citizen-request-table__sla">
          <app-badge size="sm" [tone]="slaOf(row).tone" [icon]="slaOf(row).icon">
            {{ i18n.t(slaOf(row).labelKey) }}
          </app-badge>
          @if (slaCounter(row); as counter) {
            <span class="citizen-request-table__counter">{{ counter }}</span>
          }
        </span>
      </ng-template>

      <app-empty-state
        dataTableEmpty
        icon="filter"
        [title]="i18n.t('empty.noFilteredRequestsTitle')"
        [description]="i18n.t('empty.noFilteredRequestsDescription')"
      />
    </app-data-table>
  `,
})
export class CitizenRequestTable {
  readonly rows = input<readonly ServiceRequest[]>([]);

  /** Names the table for a screen reader. Already localised. */
  readonly caption = input.required<string>();

  readonly loading = input(false, { transform: booleanAttribute });

  protected readonly i18n = inject(I18nService);

  /**
   * One instant for the whole table, so every service level chip in it is
   * measured against the same moment. Recomputing per row would let two rows
   * disagree by a millisecond, which is a difference nobody can act on.
   */
  private readonly now = new Date();

  protected readonly columns = computed<readonly DataTableColumn<ServiceRequest>[]>(() => [
    {
      id: 'reference',
      header: this.i18n.t('common.reference'),
      primary: true,
      sortable: true,
      width: '10rem',
    },
    { id: 'service', header: this.i18n.t('common.service') },
    {
      id: 'submitted',
      header: this.i18n.t('common.submitted'),
      sortable: true,
      width: '9rem',
      // Sorted on the instant rather than on the rendered date, which would
      // collate "1 Mar" before "1 Feb" and is meaningless in Arabic digits.
      sortValue: (row) => new Date(this.filedAt(row)).getTime(),
    },
    { id: 'status', header: this.i18n.t('common.status'), width: '12rem' },
    { id: 'sla', header: this.i18n.t('common.sla'), width: '11rem', hideBelow: 'lg' },
  ]);

  /** The row identifier is a real link, so a request opens like any other page. */
  protected readonly rowLink = (row: ServiceRequest): unknown[] => ['/citizen', row.reference];

  protected serviceName(row: ServiceRequest): string {
    const service = serviceFor(row);
    return service ? this.i18n.pick(service.name) : this.i18n.t('common.notAvailable');
  }

  /** Falls back to creation for a draft, which has been filed with nobody yet. */
  protected filedAt(row: ServiceRequest): string {
    return row.submittedAt ?? row.createdAt;
  }

  protected statusOf(row: ServiceRequest) {
    return requestStatusPresentation(row.status);
  }

  protected slaOf(row: ServiceRequest) {
    return slaPresentation(slaStateFor(row, this.now).status);
  }

  /**
   * "2 d 6 h left" beside the chip. A citizen wants the number, not only the
   * word; the word is what keeps the number readable without the colour.
   */
  protected slaCounter(row: ServiceRequest): string | null {
    const state = slaStateFor(row, this.now);
    if (state.remainingMs === null || state.status === 'notApplicable') {
      return null;
    }
    const time = this.i18n.formatDuration(state.remainingMs);
    return state.remainingMs < 0
      ? this.i18n.t('sla.overdue', { time })
      : this.i18n.t('sla.remaining', { time });
  }
}
