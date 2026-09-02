import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Icon } from '../icon/icon';

let nextFieldId = 0;

/** Stable, collision free ids for label and description wiring. */
export function nextControlId(prefix: string): string {
  nextFieldId += 1;
  return `${prefix}-${nextFieldId}`;
}

export function hintIdFor(controlId: string): string {
  return `${controlId}-hint`;
}

export function errorIdFor(controlId: string): string {
  return `${controlId}-error`;
}

/**
 * Joins the ids a control should point at through `aria-describedby`. Returns
 * null rather than an empty string so the attribute is omitted entirely when
 * there is nothing to describe.
 */
export function describedByFor(
  controlId: string,
  hint: string | null,
  error: string | null,
): string | null {
  const parts: string[] = [];
  if (hint && !error) {
    parts.push(hintIdFor(controlId));
  }
  if (error) {
    parts.push(errorIdFor(controlId));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Label, hint and error scaffolding shared by every form control.
 *
 * Keeping this in one place is what makes the accessible wiring consistent: the
 * label always points at the control, the hint and the error are always
 * reachable through `aria-describedby`, and an error is always carried by an
 * icon and words as well as by colour.
 */
@Component({
  selector: 'app-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './field.scss',
  host: {
    class: 'field',
    '[class.field--invalid]': '!!error()',
    '[class.field--disabled]': 'disabled()',
  },
  template: `
    <label class="field__label" [attr.for]="controlId()">
      <span class="field__label-text">{{ label() }}</span>
      @if (required()) {
        <span class="field__required" aria-hidden="true">*</span>
        <span class="u-visually-hidden">{{ i18n.t('a11y.requiredField') }}</span>
      } @else if (showOptional()) {
        <span class="field__optional">{{ i18n.t('common.optional') }}</span>
      }
    </label>

    <div class="field__control">
      <ng-content />
    </div>

    @if (hint(); as hintText) {
      @if (!error()) {
        <p class="field__hint" [id]="hintId()">{{ hintText }}</p>
      }
    }

    @if (error(); as message) {
      <p class="field__error" [id]="errorId()">
        <app-icon name="alert-circle" size="sm" />
        <span>{{ message }}</span>
      </p>
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
  readonly controlId = input.required<string>();
  readonly hint = input<string | null>(null);

  /** Already localised message. Mapping validators to copy belongs to the form. */
  readonly error = input<string | null>(null);

  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  /** Marks optional fields explicitly, which helps on long forms. */
  readonly showOptional = input(false, { transform: booleanAttribute });

  protected readonly i18n = inject(I18nService);

  protected readonly hintId = computed(() => hintIdFor(this.controlId()));
  protected readonly errorId = computed(() => errorIdFor(this.controlId()));
}
