import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Icon, IconName } from '../icon/icon';

export type ProgressStepState = 'complete' | 'current' | 'upcoming' | 'blocked';

export interface ProgressStep {
  readonly id: string;

  /** Already localised, usually a `stage.*` message. */
  readonly label: string;

  readonly description?: string | null;
  readonly state: ProgressStepState;

  /** Supporting line, for example the date the step completed. */
  readonly meta?: string | null;
}

/**
 * Where a request has reached.
 *
 * This is the one component a citizen looks at first, so it is built to be
 * readable without interpretation: every step says its number, its name and its
 * state in words, the marker is a distinct glyph per state rather than a
 * differently coloured dot, and the step being worked on carries
 * `aria-current="step"`.
 *
 * `blocked` is the "more information needed" loop. It is a warning rather than
 * an error because nothing has gone wrong: the file is open and waiting on the
 * applicant.
 */
@Component({
  selector: 'app-progress-tracker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './progress-tracker.scss',
  host: {
    class: 'progress-tracker',
  },
  template: `
    <ol class="progress__list" [attr.aria-label]="overallLabel()">
      @for (step of steps(); track step.id; let index = $index) {
        <li
          class="progress__step"
          [class.progress__step--complete]="step.state === 'complete'"
          [class.progress__step--current]="step.state === 'current'"
          [class.progress__step--upcoming]="step.state === 'upcoming'"
          [class.progress__step--blocked]="step.state === 'blocked'"
          [attr.aria-current]="step.state === 'current' ? 'step' : null"
        >
          <span class="progress__marker" aria-hidden="true">
            @if (markerIcon(step); as glyph) {
              <app-icon [name]="glyph" size="sm" />
            }
          </span>

          <span class="progress__text">
            <!--
              The full sentence is what a screen reader reads: number, name and
              state. The visible label is hidden from it so the name is not
              announced twice, while the date below stays readable.
            -->
            <span class="u-visually-hidden">{{ stepLabel(step, index) }}</span>
            <span class="progress__label" aria-hidden="true">{{ step.label }}</span>

            @if (step.description) {
              <span class="progress__description">{{ step.description }}</span>
            }

            @if (step.meta) {
              <span class="progress__meta">{{ step.meta }}</span>
            }
          </span>
        </li>
      }
    </ol>
  `,
})
export class ProgressTracker {
  readonly steps = input<readonly ProgressStep[]>([]);

  protected readonly i18n = inject(I18nService);

  /**
   * The step in play. A blocked step counts as the one in play because that is
   * where the file actually is, and when nothing is in play the count of
   * finished steps is the honest answer.
   */
  private readonly activeIndex = computed(() => {
    const steps = this.steps();
    const active = steps.findIndex(
      (step) => step.state === 'current' || step.state === 'blocked',
    );
    if (active >= 0) {
      return active + 1;
    }
    const completed = steps.filter((step) => step.state === 'complete').length;
    return Math.min(Math.max(completed, 1), Math.max(steps.length, 1));
  });

  protected readonly overallLabel = computed(() =>
    this.i18n.t('common.step', {
      current: this.i18n.formatNumber(this.activeIndex()),
      total: this.i18n.formatNumber(this.steps().length),
    }),
  );

  /** Nothing is drawn for current and upcoming: those markers are CSS shapes. */
  protected markerIcon(step: ProgressStep): IconName | null {
    switch (step.state) {
      case 'complete':
        return 'check';
      case 'blocked':
        return 'alert-triangle';
      default:
        return null;
    }
  }

  protected stepLabel(step: ProgressStep, index: number): string {
    const position = this.i18n.t('a11y.progressStep', {
      current: this.i18n.formatNumber(index + 1),
      total: this.i18n.formatNumber(this.steps().length),
      label: step.label,
    });
    return `${position}${this.i18n.t('common.listSeparator')}${this.stateLabel(step.state)}`;
  }

  /**
   * The state in words, so it never rests on the marker colour.
   */
  private stateLabel(state: ProgressStepState): string {
    switch (state) {
      case 'complete':
        return this.i18n.t('a11y.stepComplete');
      case 'current':
        return this.i18n.t('a11y.stepCurrent');
      case 'blocked':
        return this.i18n.t('a11y.stepBlocked');
      case 'upcoming':
        return this.i18n.t('a11y.stepUpcoming');
    }
  }
}
