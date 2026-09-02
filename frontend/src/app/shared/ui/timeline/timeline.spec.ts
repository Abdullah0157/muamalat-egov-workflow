import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { I18nService } from '../../../core/i18n/i18n.service';
import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { all, el, maybeEl, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { Timeline, TimelineItem } from './timeline';

const ITEMS: readonly TimelineItem[] = [
  {
    id: 'h3',
    title: 'Document verified',
    description: 'Tenancy contract checked against the original.',
    meta: 'Noura Al Fahad, Officer',
    timestamp: '2026-02-18T09:30:00Z',
    icon: 'file-check',
    tone: 'success',
  },
  {
    id: 'h2',
    title: 'Request submitted',
    meta: 'Ahmad Al Sabah, Applicant',
    timestamp: '2026-02-17T12:00:00Z',
  },
];

@Component({
  imports: [Timeline],
  template: `<app-timeline [items]="items()" [dense]="dense()" />`,
})
class Host {
  readonly items = signal<readonly TimelineItem[]>(ITEMS);
  readonly dense = signal(false);
}

describe('Timeline', () => {
  // The i18n service remembers the chosen language in local storage, and that
  // store is shared by every spec in the run. Clearing it on both sides keeps a
  // language switch here from deciding what language another file starts in.
  beforeEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));

  let fixture: ComponentFixture<Host>;
  let i18n: I18nService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    i18n = await setupI18n();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('renders an ordered list named for assistive technology', () => {
    const list = el(fixture, 'ol');
    expect(list.tagName).toBe('OL');
    expect(list.getAttribute('aria-label')).toBe('Activity history');
    expect(all(fixture, 'li').length).toBe(2);
  });

  it('renders the title, the description and the actor for each entry', () => {
    expect(text(fixture, '.timeline__title')).toBe('Document verified');
    expect(text(fixture, '.timeline__description')).toContain('checked against the original');
    expect(text(fixture, '.timeline__meta')).toBe('Noura Al Fahad, Officer');
  });

  it('leaves out an absent description rather than rendering an empty line', () => {
    const second = all(fixture, 'li')[1];
    expect(second.querySelector('.timeline__description')).toBeNull();
    expect(second.querySelector('.timeline__meta')).not.toBeNull();
  });

  it('carries a machine readable timestamp beside the human one', () => {
    const time = el<HTMLTimeElement>(fixture, 'time');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe('2026-02-18T09:30:00Z');
    expect(time.textContent).toContain(i18n.formatDateTime('2026-02-18T09:30:00Z'));
    expect(text(fixture, '.timeline__relative').length).toBeGreaterThan(0);
  });

  it('keeps the marker out of the reading order because the title already says it', () => {
    expect(el(fixture, '.timeline__marker').getAttribute('aria-hidden')).toBe('true');
  });

  it('tones the marker without making the tone the only signal', () => {
    const markers = all(fixture, '.timeline__marker');
    expect(markers[0].classList).toContain('timeline__marker--success');
    // The entry that carried no tone stays neutral and still shows a glyph.
    expect(markers[1].classList).not.toContain('timeline__marker--success');
    expect(markers[1].querySelector('app-icon')).not.toBeNull();
  });

  it('applies the dense variant to the host', async () => {
    fixture.componentInstance.dense.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'app-timeline').classList).toContain('timeline--dense');
  });

  it('renders nothing but an empty list when there are no entries', async () => {
    fixture.componentInstance.items.set([]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(maybeEl(fixture, 'li')).toBeNull();
    expect(maybeEl(fixture, 'ol')).not.toBeNull();
  });

  it('reads its label from the Arabic catalogue in an Arabic page', async () => {
    await i18n.setLanguage('ar');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'ol').getAttribute('aria-label')).toBe('سجل النشاط');
  });
});
