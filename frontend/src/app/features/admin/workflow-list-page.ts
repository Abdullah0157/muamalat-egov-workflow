import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';

import { DataGateway } from '../../core/data/data-gateway';
import { findDepartment } from '../../core/data/service-catalogue';
import { publishedVersion } from '../../core/data/workflow-definitions';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  LocalizedText,
  WorkflowDefinition,
  WorkflowVersion,
  WorkflowVersionStatus,
} from '../../core/models/domain';
import { Badge, BadgeTone } from '../../shared/ui/badge/badge';
import { Card } from '../../shared/ui/card/card';
import {
  DataTable,
  DataTableCellDirective,
  DataTableColumn,
} from '../../shared/ui/data-table/data-table';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorState } from '../../shared/ui/error-state/error-state';
import { IconName } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { SkeletonTable } from '../../shared/ui/skeleton/skeleton-table';

/** One definition with the two figures an administrator judges it by. */
interface WorkflowRow {
  readonly definition: WorkflowDefinition;
  /**
   * Kept as the bilingual record rather than as a picked string: rows survive a
   * language switch without being reloaded, so anything picked at load time
   * would still be in the previous language afterwards.
   */
  readonly department: LocalizedText | null;
  /** Highest numbered version, whatever its status. */
  readonly latest: WorkflowVersion;
  /** Live cases on the version new requests are filed against. */
  readonly runningCases: number;
}

/** Every status needs its own glyph: archived and draft share a tone. */
const STATUS_ICON: Readonly<Record<WorkflowVersionStatus, IconName>> = {
  draft: 'edit',
  published: 'check-circle',
  archived: 'folder',
};

/**
 * The register of workflow definitions.
 *
 * The two columns that matter are the latest version and how many cases are
 * running on the published one, because together they answer the only question
 * an administrator opens this screen with: is there a draft in flight, and how
 * much is riding on what is live right now.
 */
@Component({
  selector: 'app-workflow-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Badge,
    Card,
    DataTable,
    DataTableCellDirective,
    EmptyState,
    ErrorState,
    PageHeader,
    SkeletonTable,
  ],
  styleUrl: './workflow-list-page.scss',
  host: { class: 'page' },
  template: `
    <app-page-header [heading]="i18n.t('admin.title')" [description]="i18n.t('admin.subtitle')" />

    <div class="u-stack-lg">
      @if (rows.isLoading()) {
        <app-card flush>
          <app-skeleton-table [rows]="3" [columns]="6" label="" />
        </app-card>
      } @else if (rows.error()) {
        <app-error-state
          [title]="i18n.t('errors.loadWorkflowsTitle')"
          [description]="i18n.t('errors.loadWorkflowsDescription')"
          (retry)="rows.reload()"
        />
      } @else if (rows.value().length === 0) {
        <app-empty-state
          icon="workflow"
          [title]="i18n.t('empty.noWorkflowsTitle')"
          [description]="i18n.t('empty.noWorkflowsDescription')"
        />
      } @else {
        <app-card flush>
          <app-data-table
            [rows]="rows.value()"
            [columns]="columns()"
            [caption]="i18n.t('admin.definitionsCaption')"
            [rowLink]="rowLink"
          >
            <ng-template appDataTableCell="name" [appDataTableCellFor]="rows.value()" let-row>
              {{ i18n.pick(row.definition.name) }}
            </ng-template>

            <ng-template appDataTableCell="key" [appDataTableCellFor]="rows.value()" let-row>
              <span class="u-reference">{{ row.definition.key }}</span>
            </ng-template>

            <ng-template appDataTableCell="department" [appDataTableCellFor]="rows.value()" let-row>
              {{ i18n.pick(row.department) }}
            </ng-template>

            <ng-template appDataTableCell="versions" [appDataTableCellFor]="rows.value()" let-row>
              {{ i18n.formatNumber(row.definition.versions.length) }}
            </ng-template>

            <ng-template appDataTableCell="latest" [appDataTableCellFor]="rows.value()" let-row>
              <span class="workflows__version">
                <span class="u-numeric">
                  {{ i18n.t('admin.designerSubtitle', { version: i18n.formatNumber(row.latest.version) }) }}
                </span>
                <app-badge
                  size="sm"
                  [tone]="statusTone(row.latest.status)"
                  [icon]="statusIcon(row.latest.status)"
                >
                  {{ i18n.t('admin.versionStatus.' + row.latest.status) }}
                </app-badge>
              </span>
            </ng-template>

            <ng-template appDataTableCell="running" [appDataTableCellFor]="rows.value()" let-row>
              {{ i18n.formatNumber(row.runningCases) }}
            </ng-template>
          </app-data-table>
        </app-card>
      }
    </div>
  `,
})
export class WorkflowListPage {
  protected readonly i18n = inject(I18nService);
  private readonly gateway = inject(DataGateway);

  /**
   * One resource rather than two. The running case count belongs to the row it
   * annotates, so loading it separately would give the table a second loading
   * state, a second error state and a window where a definition shows a figure
   * of zero that is not true yet.
   */
  protected readonly rows = resource({
    loader: async () => {
      const definitions = await this.gateway.listWorkflows();
      return Promise.all(definitions.map((definition) => this.toRow(definition)));
    },
    defaultValue: [] as WorkflowRow[],
  });

  protected readonly columns = computed<readonly DataTableColumn<WorkflowRow>[]>(() => [
    {
      id: 'name',
      header: this.i18n.t('admin.definitionName'),
      primary: true,
      sortable: true,
      sortValue: (row) => this.i18n.pick(row.definition.name),
    },
    {
      id: 'key',
      header: this.i18n.t('admin.definitionKey'),
      hideBelow: 'lg',
    },
    {
      id: 'department',
      header: this.i18n.t('common.department'),
      hideBelow: 'md',
      sortable: true,
      sortValue: (row) => this.i18n.pick(row.department),
    },
    {
      id: 'versions',
      header: this.i18n.t('admin.versions'),
      numeric: true,
      width: '6rem',
      sortValue: (row) => row.definition.versions.length,
    },
    {
      id: 'latest',
      header: this.i18n.t('admin.latestVersion'),
      width: '13rem',
      sortValue: (row) => row.latest.version,
    },
    {
      // Closest existing header for the running case figure. See the report:
      // `admin.runningCasesColumn` does not exist in the catalogue.
      id: 'running',
      header: this.i18n.t('supervisor.kpiOpen'),
      numeric: true,
      sortable: true,
      width: '8rem',
      sortValue: (row) => row.runningCases,
    },
  ]);

  /** Stable reference: the table takes this as an input, not as a call. */
  protected readonly rowLink = (row: WorkflowRow): unknown[] => [
    '/admin',
    'workflows',
    row.definition.id,
  ];

  protected statusTone(status: WorkflowVersionStatus): BadgeTone {
    return status === 'published' ? 'success' : 'neutral';
  }

  protected statusIcon(status: WorkflowVersionStatus): IconName {
    return STATUS_ICON[status];
  }

  private async toRow(definition: WorkflowDefinition): Promise<WorkflowRow> {
    const live = publishedVersion(definition);
    return {
      definition,
      department: findDepartment(definition.departmentId)?.name ?? null,
      latest: definition.versions.reduce(
        (highest, candidate) => (candidate.version > highest.version ? candidate : highest),
        definition.versions[0],
      ),
      runningCases: await this.gateway.countRunningCases(definition.key, live.version),
    };
  }
}
