import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../testing/i18n';
import { all, el, maybeEl, text } from '../../testing/dom';
import { SkeletonTable } from './skeleton-table';
import { Skeleton } from './skeleton';

@Component({
  imports: [Skeleton],
  template: `
    <app-skeleton
      [variant]="variant()"
      [lines]="lines()"
      [width]="width()"
      [height]="height()"
      [label]="label()"
    />
  `,
})
class Host {
  readonly variant = signal<'text' | 'heading' | 'block' | 'circle'>('text');
  readonly lines = signal(3);
  readonly width = signal<string | null>(null);
  readonly height = signal<string | null>(null);
  readonly label = signal<string | null>(null);
}

describe('Skeleton', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('renders one bar per requested line', () => {
    expect(all(fixture, '.skeleton--text').length).toBe(3);

    fixture.componentInstance.lines.set(1);
    fixture.detectChanges();
    expect(all(fixture, '.skeleton--text').length).toBe(1);
  });

  it('stops the last line short so a block reads as prose', () => {
    const bars = all<HTMLElement>(fixture, '.skeleton--text');
    expect(bars[0].style.inlineSize).toBe('100%');
    expect(bars[bars.length - 1].style.inlineSize).toBe('60%');
  });

  it('renders a single shape for the other variants', async () => {
    fixture.componentInstance.variant.set('circle');
    await settle();

    expect(all(fixture, '.skeleton').length).toBe(1);
    expect(el(fixture, '.skeleton').classList).toContain('skeleton--circle');
  });

  it('applies an explicit size', async () => {
    fixture.componentInstance.variant.set('block');
    fixture.componentInstance.width.set('12rem');
    fixture.componentInstance.height.set('3rem');
    await settle();

    const shape = el<HTMLElement>(fixture, '.skeleton');
    expect(shape.style.inlineSize).toBe('12rem');
    expect(shape.style.blockSize).toBe('3rem');
  });

  it('keeps the shapes out of the accessibility tree', () => {
    expect(el(fixture, '.skeleton__lines').getAttribute('aria-hidden')).toBe('true');
  });

  it('says nothing unless it is asked to', () => {
    expect(maybeEl(fixture, '[role="status"]')).toBeNull();
  });

  it('announces the standard loading wording when given an empty label', async () => {
    fixture.componentInstance.label.set('');
    await settle();

    const status = el(fixture, '[role="status"]');
    expect(status.classList).toContain('u-visually-hidden');
    expect(status.textContent?.trim()).toBe('Loading content');
  });

  it('prefers a caller supplied announcement', async () => {
    fixture.componentInstance.label.set('Loading rows');
    await settle();

    expect(text(fixture, '[role="status"]')).toBe('Loading rows');
  });
});

@Component({
  imports: [SkeletonTable],
  template: `<app-skeleton-table [rows]="rows()" [columns]="columns()" [label]="label()" />`,
})
class TableHost {
  readonly rows = signal(3);
  readonly columns = signal(4);
  readonly label = signal<string | null>(null);
}

describe('SkeletonTable', () => {
  let fixture: ComponentFixture<TableHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableHost],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(TableHost);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders a header band plus the requested rows', () => {
    expect(all(fixture, '.skeleton-table__row').length).toBe(4);
    expect(all(fixture, '.skeleton-table__row--header').length).toBe(1);
  });

  it('renders the requested number of cells per row', () => {
    const rows = all(fixture, '.skeleton-table__row');
    expect(rows[1].querySelectorAll('app-skeleton').length).toBe(4);
  });

  it('drives the column count from a custom property rather than a class per width', () => {
    expect(el<HTMLElement>(fixture, '.skeleton-table').style.getPropertyValue('--skeleton-columns')).toBe('4');
  });

  it('keeps the whole shape out of the accessibility tree', () => {
    expect(el(fixture, '.skeleton-table').getAttribute('aria-hidden')).toBe('true');
    expect(maybeEl(fixture, '[role="status"]')).toBeNull();
  });

  it('announces the rows wording when asked to speak for itself', async () => {
    fixture.componentInstance.label.set('');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text(fixture, '[role="status"]')).toBe('Loading rows');
  });
});
