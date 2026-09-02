import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  booleanAttribute,
  computed,
  contentChildren,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { I18nService } from '../../../core/i18n/i18n.service';
import { nextControlId } from '../field/field';
import { Icon, IconName } from '../icon/icon';

/**
 * One column of a data table.
 *
 * `header` arrives already localised: the table has no opinion about where a
 * caller's copy comes from, and a column header is often assembled from a
 * domain label rather than a single message key.
 */
export interface DataTableColumn<T> {
  readonly id: string;
  readonly header: string;
  readonly sortable?: boolean;

  /** Logical, so it follows the writing direction rather than the screen. */
  readonly align?: 'start' | 'end';

  /** Any CSS length. Applied through the `<colgroup>` so cells cannot fight it. */
  readonly width?: string;

  /** Tabular figures and end alignment, for anything that lines up in a column. */
  readonly numeric?: boolean;

  /**
   * Progressive disclosure. A wide table drops its least important columns
   * before it starts scrolling sideways; the card view below `md` shows them
   * again, because a card has room for everything.
   */
  readonly hideBelow?: 'md' | 'lg';

  /** The one column that identifies a row. Becomes the card title and a `<th>`. */
  readonly primary?: boolean;

  /**
   * Sort key. Without one the column id is read off the row, which covers the
   * usual case where a column renders a single field. A column whose template
   * composes several fields, or which renders a formatted date, must supply this
   * so the order matches what a reader would expect rather than what the string
   * happens to collate to.
   */
  readonly sortValue?: (row: T) => string | number;
}

/** What a cell template receives. */
export interface DataTableCellContext<T> {
  readonly $implicit: T;
  readonly column: DataTableColumn<T>;
  readonly index: number;
}

export type DataTableSortDirection = 'asc' | 'desc';

export interface DataTableSort {
  readonly columnId: string;
  readonly direction: DataTableSortDirection;
}

/** A row plus the position it arrived in, which is the table's natural order. */
interface DataTableEntry<T> {
  readonly row: T;
  readonly index: number;
}

/**
 * One cell renderer per column, matched by column id.
 *
 * ```html
 * <app-data-table [rows]="requests()" [columns]="columns" [caption]="caption()">
 *   <ng-template appDataTableCell="reference" let-row>
 *     <span class="u-reference">{{ row.reference }}</span>
 *   </ng-template>
 *   <ng-template appDataTableCell="status" let-row>
 *     <app-badge [tone]="tone(row)">{{ label(row) }}</app-badge>
 *   </ng-template>
 * </app-data-table>
 * ```
 *
 * Matching by id was chosen over a single template that switches on the column
 * because it keeps each cell's markup next to the column it belongs to, and
 * because the call site above is the shortest thing that still lets a caller put
 * a badge, a link or a chart in a cell.
 *
 * `let-row` is untyped by default. Bind `appDataTableCellFor` to the same array
 * that was passed to `rows` and the template context becomes fully typed.
 */
@Directive({ selector: 'ng-template[appDataTableCell]' })
export class DataTableCellDirective<T = any> {
  readonly columnId = input.required<string>({ alias: 'appDataTableCell' });

  /** Type anchor only. Never read at runtime. */
  readonly rows = input<readonly T[]>([], { alias: 'appDataTableCellFor' });

  readonly template: TemplateRef<DataTableCellContext<T>> = inject(TemplateRef);

  static ngTemplateContextGuard<T>(
    _directive: DataTableCellDirective<T>,
    _context: unknown,
  ): _context is DataTableCellContext<T> {
    return true;
  }
}

/** Row counts offered by the rows per page control, before the current one. */
const PAGE_SIZES: readonly number[] = [10, 25, 50];

/** Enough skeleton rows to read as a table, few enough to stay honest. */
const SKELETON_ROWS = 6;

/**
 * The product's data table.
 *
 * A real `<table>`, because a case list is tabular data and every alternative
 * loses the row and column relationships that make it navigable. The header is a
 * `<th scope="col">`, the identifying cell of each row is a `<th scope="row">`,
 * the caption names the table for a screen reader, and sorting is announced
 * through `aria-sort` on the header rather than by the arrow alone.
 *
 * Below `md` the same markup becomes a list of cards through CSS: each cell
 * turns into a label and value pair taken from its column header, and the
 * primary column becomes the card title. There is no second template and no
 * breakpoint listener, so the two presentations cannot drift apart.
 */
@Component({
  selector: 'app-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, RouterLink],
  styleUrl: './data-table.scss',
  host: {
    class: 'data-table',
    '[class.data-table--sticky]': 'stickyHeader()',
  },
  template: `
    @if (loading()) {
      <p class="u-visually-hidden" role="status">{{ i18n.t('table.loadingRows') }}</p>
    }

    <div class="data-table__scroll">
      <table class="data-table__table" [attr.aria-busy]="loading() ? 'true' : null">
        <caption class="u-visually-hidden">{{ caption() }}</caption>

        <colgroup>
          @for (column of columns(); track column.id) {
            <col [style.inline-size]="column.width" />
          }
        </colgroup>

        <thead class="data-table__head">
          <tr>
            @for (column of columns(); track column.id) {
              <th
                scope="col"
                class="data-table__header"
                [class.data-table__cell--end]="isEndAligned(column)"
                [class.data-table__hide-md]="column.hideBelow === 'md'"
                [class.data-table__hide-lg]="column.hideBelow === 'lg'"
                [attr.aria-sort]="ariaSort(column)"
              >
                @if (column.sortable) {
                  <button
                    type="button"
                    class="data-table__sort"
                    [attr.aria-label]="sortLabel(column)"
                    (click)="toggleSort(column)"
                  >
                    <span>{{ column.header }}</span>
                    <app-icon [name]="sortIcon(column)" size="sm" class="data-table__sort-icon" />
                  </button>
                } @else {
                  <span>{{ column.header }}</span>
                }
              </th>
            }
          </tr>
        </thead>

        <tbody class="data-table__body">
          @if (loading()) {
            @for (placeholder of skeletonRows; track placeholder) {
              <tr class="data-table__row" aria-hidden="true">
                @for (column of columns(); track column.id) {
                  <td
                    class="data-table__cell"
                    [class.data-table__hide-md]="column.hideBelow === 'md'"
                    [class.data-table__hide-lg]="column.hideBelow === 'lg'"
                  >
                    <span class="data-table__skeleton"></span>
                  </td>
                }
              </tr>
            }
          } @else {
            @for (entry of pageRows(); track entry.index) {
              <tr
                class="data-table__row"
                [class.data-table__row--interactive]="interactive()"
                (click)="rowClick.emit(entry.row)"
              >
                @for (column of columns(); track column.id) {
                  @if (column.primary) {
                    <th
                      scope="row"
                      class="data-table__cell data-table__cell--primary"
                      [class.data-table__cell--end]="isEndAligned(column)"
                      [class.data-table__cell--numeric]="column.numeric"
                      [class.data-table__hide-md]="column.hideBelow === 'md'"
                      [class.data-table__hide-lg]="column.hideBelow === 'lg'"
                      [attr.data-label]="column.header"
                    >
                      @if (linkFor(entry.row); as link) {
                        <a class="data-table__link" [routerLink]="link">
                          <ng-container
                            [ngTemplateOutlet]="templateFor(column)"
                            [ngTemplateOutletContext]="cellContext(entry, column)"
                          />
                        </a>
                      } @else {
                        <ng-container
                          [ngTemplateOutlet]="templateFor(column)"
                          [ngTemplateOutletContext]="cellContext(entry, column)"
                        />
                      }
                    </th>
                  } @else {
                    <td
                      class="data-table__cell"
                      [class.data-table__cell--end]="isEndAligned(column)"
                      [class.data-table__cell--numeric]="column.numeric"
                      [class.data-table__hide-md]="column.hideBelow === 'md'"
                      [class.data-table__hide-lg]="column.hideBelow === 'lg'"
                      [attr.data-label]="column.header"
                    >
                      <ng-container
                        [ngTemplateOutlet]="templateFor(column)"
                        [ngTemplateOutletContext]="cellContext(entry, column)"
                      />
                    </td>
                  }
                }
              </tr>
            }
          }
        </tbody>
      </table>
    </div>

    <div class="data-table__empty" [hidden]="!isEmpty()">
      <ng-content select="[dataTableEmpty]" />
    </div>

    @if (showPagination()) {
      <div class="data-table__pagination">
        <div class="data-table__page-size">
          <label class="data-table__page-size-label" [attr.for]="pageSizeId">
            {{ i18n.t('table.rowsPerPage') }}
          </label>
          <select
            class="data-table__page-size-select"
            [id]="pageSizeId"
            (change)="changePageSize($event)"
          >
            @for (size of pageSizeOptions(); track size) {
              <option [value]="size" [selected]="size === activePageSize()">
                {{ i18n.formatNumber(size) }}
              </option>
            }
          </select>
        </div>

        <p class="data-table__status" role="status">{{ pageStatus() }}</p>

        <div class="data-table__pager">
          <button
            type="button"
            class="data-table__page-button"
            [attr.aria-label]="i18n.t('table.firstPage')"
            [disabled]="currentPage() === 1"
            (click)="goToPage(1)"
          >
            <app-icon name="chevron-first" size="md" />
          </button>
          <button
            type="button"
            class="data-table__page-button"
            [attr.aria-label]="i18n.t('table.previousPage')"
            [disabled]="currentPage() === 1"
            (click)="goToPage(currentPage() - 1)"
          >
            <app-icon name="chevron-prev" size="md" />
          </button>
          <button
            type="button"
            class="data-table__page-button"
            [attr.aria-label]="i18n.t('table.nextPage')"
            [disabled]="currentPage() === pageCount()"
            (click)="goToPage(currentPage() + 1)"
          >
            <app-icon name="chevron-next" size="md" />
          </button>
          <button
            type="button"
            class="data-table__page-button"
            [attr.aria-label]="i18n.t('table.lastPage')"
            [disabled]="currentPage() === pageCount()"
            (click)="goToPage(pageCount())"
          >
            <app-icon name="chevron-last" size="md" />
          </button>
        </div>
      </div>
    }
  `,
})
export class DataTable<T> {
  readonly rows = input<readonly T[]>([]);
  readonly columns = input<readonly DataTableColumn<T>[]>([]);

  /**
   * Names the table for a screen reader. Required, because a page with three
   * tables on it is unusable when they are all announced as "table".
   */
  readonly caption = input.required<string>();

  readonly loading = input(false, { transform: booleanAttribute });
  readonly pageSize = input(10);

  /** Keeps the column headers in view while a long list scrolls under them. */
  readonly stickyHeader = input(true, { transform: booleanAttribute });

  /**
   * Turns the identifying cell of each row into a real link. This is how a row
   * becomes openable: an anchor is reachable by keyboard, opens in a new tab on
   * a middle click and shows its target in the status bar, none of which a click
   * handler on the row gives you.
   */
  readonly rowLink = input<((row: T) => unknown[] | string | null) | null>(null);

  /**
   * Convenience for pointer users. Pair it with `rowLink`, never use it alone:
   * a row that only responds to a click cannot be reached from the keyboard.
   */
  readonly rowClick = output<T>();

  protected readonly i18n = inject(I18nService);

  protected readonly pageSizeId = nextControlId('rows-per-page');
  protected readonly skeletonRows = Array.from({ length: SKELETON_ROWS }, (_, index) => index);

  private readonly cellTemplates = contentChildren(DataTableCellDirective, { descendants: true });

  private readonly sort = signal<DataTableSort | null>(null);
  private readonly requestedPage = signal(1);

  /** Follows the input, and is writable so the rows per page control can move it. */
  protected readonly activePageSize = linkedSignal(() => this.pageSize());

  private readonly templatesById = computed(() => {
    const map = new Map<string, TemplateRef<DataTableCellContext<T>>>();
    for (const cell of this.cellTemplates()) {
      map.set(cell.columnId(), cell.template as TemplateRef<DataTableCellContext<T>>);
    }
    return map;
  });

  /**
   * Sorting is a pure function of the rows and the chosen column, so it survives
   * a re-render and a language switch without the table jumping. Ties fall back
   * to the order the caller supplied, which is what makes the result stable.
   */
  private readonly sortedRows = computed<readonly DataTableEntry<T>[]>(() => {
    const entries: DataTableEntry<T>[] = this.rows().map((row, index) => ({ row, index }));
    const sort = this.sort();
    if (!sort) {
      return entries;
    }
    const column = this.columns().find((candidate) => candidate.id === sort.columnId);
    if (!column) {
      return entries;
    }
    const factor = sort.direction === 'asc' ? 1 : -1;
    const locale = this.i18n.locale();
    return entries.sort((a, b) => {
      const result = compare(this.sortValueOf(a.row, column), this.sortValueOf(b.row, column), locale);
      return result === 0 ? a.index - b.index : result * factor;
    });
  });

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.sortedRows().length / this.activePageSize())),
  );

  /** Clamped rather than written back, so shrinking data cannot strand the view. */
  protected readonly currentPage = computed(() =>
    Math.min(Math.max(1, this.requestedPage()), this.pageCount()),
  );

  protected readonly pageRows = computed(() => {
    const size = this.activePageSize();
    const start = (this.currentPage() - 1) * size;
    return this.sortedRows().slice(start, start + size);
  });

  protected readonly isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  /** A single page needs no controls, and an empty bar is just noise. */
  protected readonly showPagination = computed(() => !this.loading() && this.pageCount() > 1);

  protected readonly interactive = computed(() => this.rowLink() !== null);

  /** Keeps an unusual page size that was passed in from disappearing from the list. */
  protected readonly pageSizeOptions = computed(() =>
    [...new Set([...PAGE_SIZES, this.activePageSize()])].sort((a, b) => a - b),
  );

  protected readonly pageStatus = computed(() => {
    const total = this.sortedRows().length;
    const size = this.activePageSize();
    const from = total === 0 ? 0 : (this.currentPage() - 1) * size + 1;
    return this.i18n.t('table.pageStatus', {
      from: this.i18n.formatNumber(from),
      to: this.i18n.formatNumber(Math.min(this.currentPage() * size, total)),
      total: this.i18n.formatNumber(total),
    });
  });

  protected templateFor(column: DataTableColumn<T>): TemplateRef<DataTableCellContext<T>> | null {
    return this.templatesById().get(column.id) ?? null;
  }

  protected cellContext(entry: DataTableEntry<T>, column: DataTableColumn<T>): DataTableCellContext<T> {
    return { $implicit: entry.row, column, index: entry.index };
  }

  protected linkFor(row: T): unknown[] | string | null {
    return this.rowLink()?.(row) ?? null;
  }

  protected isEndAligned(column: DataTableColumn<T>): boolean {
    return column.align === 'end' || column.numeric === true;
  }

  /** Only sortable headers carry the attribute; on the rest it would be a lie. */
  protected ariaSort(column: DataTableColumn<T>): 'ascending' | 'descending' | 'none' | null {
    if (!column.sortable) {
      return null;
    }
    const sort = this.sort();
    if (!sort || sort.columnId !== column.id) {
      return 'none';
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected sortIcon(column: DataTableColumn<T>): IconName {
    const sort = this.sort();
    if (!sort || sort.columnId !== column.id) {
      return 'sort';
    }
    return sort.direction === 'asc' ? 'arrow-up' : 'arrow-down';
  }

  /**
   * "Sort by reference, not sorted". The current state is part of the button's
   * name rather than only the arrow, so the header is understandable without
   * seeing it.
   */
  protected sortLabel(column: DataTableColumn<T>): string {
    const sort = this.sort();
    const state =
      !sort || sort.columnId !== column.id
        ? this.i18n.t('a11y.notSorted')
        : sort.direction === 'asc'
          ? this.i18n.t('a11y.sortedAscending')
          : this.i18n.t('a11y.sortedDescending');
    return `${this.i18n.t('a11y.sortBy', { column: column.header })}${this.i18n.t(
      'common.listSeparator',
    )}${state}`;
  }

  /** Ascending, then descending, then back to the order the caller supplied. */
  protected toggleSort(column: DataTableColumn<T>): void {
    const sort = this.sort();
    if (!sort || sort.columnId !== column.id) {
      this.sort.set({ columnId: column.id, direction: 'asc' });
    } else if (sort.direction === 'asc') {
      this.sort.set({ columnId: column.id, direction: 'desc' });
    } else {
      this.sort.set(null);
    }
    this.requestedPage.set(1);
  }

  protected changePageSize(event: Event): void {
    this.activePageSize.set(Number((event.target as HTMLSelectElement).value));
    this.requestedPage.set(1);
  }

  protected goToPage(page: number): void {
    this.requestedPage.set(Math.min(Math.max(1, page), this.pageCount()));
  }

  private sortValueOf(row: T, column: DataTableColumn<T>): string | number {
    if (column.sortValue) {
      return column.sortValue(row);
    }
    const raw = (row as unknown as Record<string, unknown>)[column.id];
    if (typeof raw === 'number') {
      return raw;
    }
    if (raw instanceof Date) {
      return raw.getTime();
    }
    return raw === null || raw === undefined ? '' : String(raw);
  }
}

/**
 * Numbers compare numerically, everything else through the active locale, so an
 * Arabic column sorts the way an Arabic reader expects rather than by code
 * point. `numeric` keeps "REQ-9" before "REQ-10".
 */
function compare(a: string | number, b: string | number, locale: string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  return String(a).localeCompare(String(b), locale, { numeric: true, sensitivity: 'base' });
}
