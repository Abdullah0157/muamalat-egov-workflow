import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { all, el, maybeEl, text, withDirection } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { DataTable, DataTableCellDirective, DataTableColumn } from './data-table';

interface Row {
  readonly reference: string;
  readonly service: string;
  readonly days: number;
}

const ROWS: readonly Row[] = [
  { reference: 'REQ-10', service: 'Housing transfer', days: 3 },
  { reference: 'REQ-2', service: 'Civil record', days: 12 },
  { reference: 'REQ-7', service: 'Building permit', days: 1 },
];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { id: 'reference', header: 'Reference', primary: true, sortable: true },
  { id: 'service', header: 'Service', sortable: true, hideBelow: 'lg' },
  { id: 'days', header: 'Days open', numeric: true, sortable: true, align: 'end' },
];

@Component({
  imports: [DataTable, DataTableCellDirective],
  template: `
    <app-data-table
      [rows]="rows()"
      [columns]="columns()"
      [caption]="caption()"
      [loading]="loading()"
      [pageSize]="pageSize()"
      [rowLink]="rowLink()"
      (rowClick)="clicked = $event"
    >
      <ng-template appDataTableCell="reference" [appDataTableCellFor]="rows()" let-row>
        <span class="cell-reference">{{ row.reference }}</span>
      </ng-template>
      <ng-template appDataTableCell="service" [appDataTableCellFor]="rows()" let-row>
        {{ row.service }}
      </ng-template>
      <ng-template appDataTableCell="days" [appDataTableCellFor]="rows()" let-row>
        {{ row.days }}
      </ng-template>

      <p dataTableEmpty class="empty-slot">No rows to show</p>
    </app-data-table>
  `,
})
class Host {
  readonly rows = signal<readonly Row[]>(ROWS);
  readonly columns = signal<readonly DataTableColumn<Row>[]>(COLUMNS);
  readonly caption = signal('Your requests');
  readonly loading = signal(false);
  readonly pageSize = signal(10);
  readonly rowLink = signal<((row: Row) => unknown[] | string | null) | null>(null);
  clicked: Row | null = null;
}

function references(fixture: ComponentFixture<Host>): string[] {
  return all(fixture, '.cell-reference').map((node) => node.textContent?.trim() ?? '');
}

function sortHeader(fixture: ComponentFixture<Host>, index: number): HTMLButtonElement {
  return all<HTMLButtonElement>(fixture, '.data-table__sort')[index];
}

async function click(fixture: ComponentFixture<Host>, element: HTMLElement): Promise<void> {
  element.click();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('DataTable', () => {
  // The i18n service remembers the chosen language in local storage, and that
  // store is shared by every spec in the run. Clearing it on both sides keeps a
  // language switch here from deciding what language another file starts in.
  beforeEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));

  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders a real table with a caption and scoped headers', () => {
    expect(el(fixture, 'table').tagName).toBe('TABLE');
    expect(text(fixture, 'caption')).toBe('Your requests');
    expect(all(fixture, 'thead th[scope="col"]').length).toBe(3);
    expect(all(fixture, 'tbody th[scope="row"]').length).toBe(3);
  });

  it('renders each cell through the template registered for its column', () => {
    expect(references(fixture)).toEqual(['REQ-10', 'REQ-2', 'REQ-7']);
    expect(text(fixture, 'tbody tr td')).toBe('Housing transfer');
  });

  it('carries the column header on every cell so the card view can label it', () => {
    const cells = all(fixture, 'tbody tr:first-child td, tbody tr:first-child th');
    expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Reference',
      'Service',
      'Days open',
    ]);
  });

  it('marks a sortable header as unsorted and names it with its state', () => {
    expect(all(fixture, 'thead th')[0].getAttribute('aria-sort')).toBe('none');
    expect(sortHeader(fixture, 0).getAttribute('aria-label')).toBe('Sort by Reference, not sorted');
  });

  it('cycles ascending, descending, then back to the natural order', async () => {
    await click(fixture, sortHeader(fixture, 0));

    expect(references(fixture)).toEqual(['REQ-2', 'REQ-7', 'REQ-10']);
    expect(all(fixture, 'thead th')[0].getAttribute('aria-sort')).toBe('ascending');
    expect(sortHeader(fixture, 0).getAttribute('aria-label')).toBe(
      'Sort by Reference, sorted ascending',
    );

    await click(fixture, sortHeader(fixture, 0));

    expect(references(fixture)).toEqual(['REQ-10', 'REQ-7', 'REQ-2']);
    expect(all(fixture, 'thead th')[0].getAttribute('aria-sort')).toBe('descending');

    await click(fixture, sortHeader(fixture, 0));

    expect(references(fixture)).toEqual(['REQ-10', 'REQ-2', 'REQ-7']);
    expect(all(fixture, 'thead th')[0].getAttribute('aria-sort')).toBe('none');
  });

  it('sorts a numeric column by number rather than by text', async () => {
    await click(fixture, sortHeader(fixture, 2));

    expect(references(fixture)).toEqual(['REQ-7', 'REQ-10', 'REQ-2']);
  });

  it('shows the sort state with a glyph as well as with colour', async () => {
    expect(all(fixture, '.data-table__sort-icon').length).toBe(3);
    const unsorted = el(fixture, '.data-table__sort-icon svg').innerHTML;

    await click(fixture, sortHeader(fixture, 0));

    // The sorted column draws a different glyph, so the direction survives a
    // greyscale screen.
    expect(el(fixture, '.data-table__sort-icon svg').innerHTML).not.toBe(unsorted);
  });

  it('hides pagination while everything fits on one page', () => {
    expect(maybeEl(fixture, '.data-table__pagination')).toBeNull();
  });

  it('paginates once there are more rows than fit, and reports the range', async () => {
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(references(fixture).length).toBe(2);
    expect(text(fixture, '.data-table__status')).toBe('1 to 2 of 3');

    await click(fixture, all<HTMLButtonElement>(fixture, '.data-table__page-button')[2]);

    expect(references(fixture)).toEqual(['REQ-7']);
    expect(text(fixture, '.data-table__status')).toBe('3 to 3 of 3');
  });

  it('labels the pager buttons and disables them at the ends', async () => {
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    await fixture.whenStable();

    const buttons = all<HTMLButtonElement>(fixture, '.data-table__page-button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'First page',
      'Previous page',
      'Next page',
      'Last page',
    ]);
    expect(buttons[0].disabled).toBeTrue();
    expect(buttons[3].disabled).toBeFalse();
  });

  it('returns to the first page when the sort changes', async () => {
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    await fixture.whenStable();

    await click(fixture, all<HTMLButtonElement>(fixture, '.data-table__page-button')[3]);
    expect(text(fixture, '.data-table__status')).toBe('3 to 3 of 3');

    await click(fixture, sortHeader(fixture, 0));

    expect(text(fixture, '.data-table__status')).toBe('1 to 2 of 3');
  });

  it('offers ten, twenty five and fifty rows per page beside the size it was given', async () => {
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    await fixture.whenStable();

    const select = el<HTMLSelectElement>(fixture, '.data-table__page-size-select');
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      '2',
      '10',
      '25',
      '50',
    ]);
    expect(el<HTMLLabelElement>(fixture, '.data-table__page-size-label').getAttribute('for')).toBe(
      select.id,
    );
  });

  it('renders the projected empty slot only when there are no rows', async () => {
    expect(el(fixture, '.data-table__empty').hasAttribute('hidden')).toBeTrue();

    fixture.componentInstance.rows.set([]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, '.data-table__empty').hasAttribute('hidden')).toBeFalse();
    expect(text(fixture, '.empty-slot')).toBe('No rows to show');
  });

  it('shows its own skeleton rows and announces that it is loading', async () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(all(fixture, '.data-table__skeleton').length).toBeGreaterThan(0);
    expect(references(fixture).length).toBe(0);
    expect(text(fixture, '[role="status"]')).toBe('Loading rows');
    expect(el(fixture, 'table').getAttribute('aria-busy')).toBe('true');
  });

  it('turns the identifying cell into a link when one is supplied', async () => {
    expect(maybeEl(fixture, '.data-table__link')).toBeNull();

    fixture.componentInstance.rowLink.set((row) => ['/requests', row.reference]);
    fixture.detectChanges();
    await fixture.whenStable();

    const link = el<HTMLAnchorElement>(fixture, 'th .data-table__link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/requests/REQ-10');
  });

  it('emits the row that was clicked', async () => {
    el<HTMLTableRowElement>(fixture, 'tbody tr').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.clicked?.reference).toBe('REQ-10');
  });

  it('keeps its structure and its header names in a right to left page', async () => {
    await withDirection('rtl', async () => {
      // Nothing in the table is positioned with a physical direction, so the
      // same DOM serves both. What has to hold is that the header still names
      // the column and its sort state, and the row headers survive.
      expect(sortHeader(fixture, 0).getAttribute('aria-label')).toContain('Reference');
      expect(all(fixture, 'tbody th[scope="row"]').length).toBe(3);
    });
  });
});
