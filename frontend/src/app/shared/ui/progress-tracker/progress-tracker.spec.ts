import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { I18nService } from '../../../core/i18n/i18n.service';
import { LANGUAGE_STORAGE_KEY } from '../../../core/i18n/i18n.types';
import { all, el, maybeEl, text } from '../../testing/dom';
import { setupI18n, testProviders } from '../../testing/i18n';
import { ProgressStep, ProgressTracker } from './progress-tracker';

const STEPS: readonly ProgressStep[] = [
  { id: 'submission', label: 'Submission', state: 'complete', meta: '17 Feb 2026' },
  { id: 'review', label: 'Review', state: 'current', description: 'An officer checks the file.' },
  { id: 'approval', label: 'Approval', state: 'upcoming' },
  { id: 'completion', label: 'Completion', state: 'upcoming' },
];

@Component({
  imports: [ProgressTracker],
  template: `<app-progress-tracker [steps]="steps()" />`,
})
class Host {
  readonly steps = signal<readonly ProgressStep[]>(STEPS);
}

function stepNames(fixture: ComponentFixture<Host>): string[] {
  return all(fixture, 'li .u-visually-hidden').map((node) => node.textContent?.trim() ?? '');
}

describe('ProgressTracker', () => {
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

  it('renders an ordered list with one item per step', () => {
    expect(el(fixture, 'ol').tagName).toBe('OL');
    expect(all(fixture, 'li').length).toBe(4);
    expect(text(fixture, '.progress__label')).toBe('Submission');
  });

  it('describes overall progress on the list itself', () => {
    expect(el(fixture, 'ol').getAttribute('aria-label')).toBe('Step 2 of 4');
  });

  it('names each step with its number, its label and its state', () => {
    expect(stepNames(fixture)).toEqual([
      'Step 1 of 4, Submission, completed',
      'Step 2 of 4, Review, current step',
      'Step 3 of 4, Approval, not started',
      'Step 4 of 4, Completion, not started',
    ]);
  });

  it('marks only the step in play with aria-current', () => {
    expect(all(fixture, 'li').map((item) => item.getAttribute('aria-current'))).toEqual([
      null,
      'step',
      null,
      null,
    ]);
  });

  it('draws a check on a completed step and nothing on an upcoming one', () => {
    const items = all(fixture, 'li');
    expect(items[0].querySelector('.progress__marker app-icon')).not.toBeNull();
    expect(items[2].querySelector('.progress__marker app-icon')).toBeNull();
  });

  it('hides the visible label from assistive technology so it is not read twice', () => {
    expect(el(fixture, '.progress__label').getAttribute('aria-hidden')).toBe('true');
    expect(text(fixture, '.progress__meta')).toBe('17 Feb 2026');
    expect(text(fixture, '.progress__description')).toBe('An officer checks the file.');
  });

  it('treats a blocked step as the step in play and says so in words', async () => {
    fixture.componentInstance.steps.set([
      { id: 'submission', label: 'Submission', state: 'complete' },
      { id: 'review', label: 'Review', state: 'blocked' },
      { id: 'approval', label: 'Approval', state: 'upcoming' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'ol').getAttribute('aria-label')).toBe('Step 2 of 3');
    expect(stepNames(fixture)[1]).toBe('Step 2 of 3, Review, waiting for information from you');
    expect(all(fixture, 'li')[1].classList).toContain('progress__step--blocked');
    // A warning marker still carries a glyph rather than only a colour.
    expect(all(fixture, 'li')[1].querySelector('.progress__marker app-icon')).not.toBeNull();
  });

  it('reports the last completed step when nothing is in play', async () => {
    fixture.componentInstance.steps.set(
      STEPS.map((step) => ({ ...step, state: 'complete' as const })),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'ol').getAttribute('aria-label')).toBe('Step 4 of 4');
    expect(maybeEl(fixture, '[aria-current]')).toBeNull();
  });

  it('reads its step counts from the Arabic catalogue', async () => {
    await i18n.setLanguage('ar');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el(fixture, 'ol').getAttribute('aria-label')).toBe('الخطوة 2 من 4');
    expect(stepNames(fixture)[1]).toContain('الخطوة الحالية');
  });
});
