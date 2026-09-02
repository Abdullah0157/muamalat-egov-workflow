import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Field, describedByFor, nextControlId } from '../field/field';

/**
 * Date entry.
 *
 * Built on `<input type="date">` on purpose. The platform picker is already
 * localised, already keyboard operable, already usable one handed on a phone,
 * and already understands the user's own date order; a hand rolled calendar
 * would be a worse copy of all four. The contents are pinned to `ltr` because a
 * date input renders a fixed field order rather than bidirectional text.
 *
 * The value is exchanged as an ISO `yyyy-mm-dd` string, which is what the input
 * itself uses and what the workflow service stores.
 */
@Component({
  selector: 'app-date-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field],
  styleUrl: './date-picker.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatePicker),
      multi: true,
    },
  ],
  template: `
    <app-field
      [label]="label()"
      [controlId]="controlId"
      [hint]="hint()"
      [error]="error()"
      [required]="required()"
      [disabled]="isDisabled()"
      [showOptional]="showOptional()"
    >
      <input
        type="date"
        dir="ltr"
        class="date-picker__input"
        [id]="controlId"
        [attr.min]="min()"
        [attr.max]="max()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-required]="required() ? 'true' : null"
        [value]="value()"
        [disabled]="isDisabled()"
        (input)="handleInput($event)"
        (blur)="handleBlur()"
      />

      @if (calendars(); as both) {
        <p class="date-picker__calendars">
          <span class="date-picker__calendar">
            <span class="date-picker__calendar-name">{{ i18n.t('common.gregorian') }}</span>
            <span>{{ both.gregorian }}</span>
          </span>
          @if (both.hijri) {
            <span class="date-picker__calendar">
              <span class="date-picker__calendar-name">{{ i18n.t('common.hijri') }}</span>
              <span>{{ both.hijri }}</span>
            </span>
          }
        </p>
      }
    </app-field>
  `,
})
export class DatePicker implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);

  /** ISO `yyyy-mm-dd` bounds, passed straight to the native input. */
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);

  readonly required = input(false, { transform: booleanAttribute });
  readonly showOptional = input(false, { transform: booleanAttribute });

  /**
   * Official Kuwaiti correspondence carries both calendars, so a date the user
   * has chosen is echoed back in Gregorian and Hijri. Turn it off for dates that
   * are not part of the record, a chart range for example.
   */
  readonly showHijri = input(true, { transform: booleanAttribute });

  readonly valueChange = output<string>();
  readonly blurred = output<void>();

  protected readonly i18n = inject(I18nService);

  protected readonly controlId = nextControlId('date-picker');
  protected readonly value = signal('');
  protected readonly isDisabled = signal(false);

  protected readonly describedBy = computed(() =>
    describedByFor(this.controlId, this.hint(), this.error()),
  );

  /**
   * Null until there is a date to show. `formatHijri` returns an empty string on
   * an engine without the Islamic calendar, and an empty label beside nothing is
   * worse than one calendar, so that line is dropped rather than left blank.
   */
  protected readonly calendars = computed(() => {
    if (!this.showHijri()) {
      return null;
    }
    const date = toLocalDate(this.value());
    if (!date) {
      return null;
    }
    return { gregorian: this.i18n.formatDate(date), hijri: this.i18n.formatHijri(date) };
  });

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }

  protected handleInput(event: Event): void {
    // Empty while the user is part way through typing a date, which is a real
    // value the form needs to see rather than something to swallow.
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
    this.valueChange.emit(next);
  }

  protected handleBlur(): void {
    this.onTouched();
    this.blurred.emit();
  }
}

/**
 * Reads `yyyy-mm-dd` as a local calendar day.
 *
 * `new Date('2026-03-01')` is midnight UTC, which formats as the previous day
 * anywhere west of Greenwich. A date on a government form is a calendar day, not
 * an instant, so the parts are used directly.
 */
function toLocalDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
