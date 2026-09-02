import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Field, describedByFor, nextControlId } from '../field/field';

/**
 * Multi line text input.
 *
 * The same shape as `TextField`, with two additions that matter on a form where
 * an officer writes a reason for a decision: it can grow with its content so the
 * whole comment stays visible, and it can show how much of a length limit is
 * left. The counter is only made a live region near the limit, because
 * announcing every keystroke would drown out the text being typed.
 */
@Component({
  selector: 'app-textarea',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field],
  styleUrl: './textarea.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Textarea),
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
      <textarea
        #control
        class="textarea__control"
        [class.textarea__control--auto-grow]="autoGrow()"
        [id]="controlId"
        [attr.rows]="rows()"
        [attr.placeholder]="placeholder()"
        [attr.maxlength]="maxLength()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-required]="required() ? 'true' : null"
        [value]="value()"
        [disabled]="isDisabled()"
        [readOnly]="readOnly()"
        (input)="handleInput($event)"
        (blur)="handleBlur()"
      ></textarea>

      @if (maxLength() !== null) {
        <p
          class="textarea__counter"
          [class.textarea__counter--near-limit]="nearLimit()"
          [id]="counterId"
          [attr.aria-live]="nearLimit() ? 'polite' : null"
        >
          {{ counterText() }}
        </p>
      }
    </app-field>
  `,
})
export class Textarea implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly rows = input(4);
  readonly maxLength = input<number | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly readOnly = input(false, { transform: booleanAttribute });
  readonly showOptional = input(false, { transform: booleanAttribute });

  /**
   * Grows with the content up to the maximum set in the stylesheet, after which
   * the box scrolls. Stops a long justification from being written through a
   * three line window.
   */
  readonly autoGrow = input(false, { transform: booleanAttribute });

  readonly valueChange = output<string>();
  readonly blurred = output<void>();

  protected readonly i18n = inject(I18nService);

  protected readonly controlId = nextControlId('textarea');
  protected readonly counterId = `${this.controlId}-counter`;
  protected readonly value = signal('');
  protected readonly isDisabled = signal(false);

  private readonly control = viewChild<ElementRef<HTMLTextAreaElement>>('control');

  /**
   * The counter is a description of the control, so it is joined onto whatever
   * the shared helper produced for the hint and the error rather than replacing
   * it. That way the limit is read out when the field takes focus.
   */
  protected readonly describedBy = computed(() => {
    const base = describedByFor(this.controlId, this.hint(), this.error());
    if (this.maxLength() === null) {
      return base;
    }
    return base ? `${base} ${this.counterId}` : this.counterId;
  });

  /**
   * Read as a sentence rather than as "12 / 100", because a bare fraction next
   * to a text box is ambiguous when it is announced out of context, and the
   * word order is not the same in both languages.
   */
  protected readonly counterText = computed(() => {
    const limit = this.maxLength();
    if (limit === null) {
      return '';
    }
    return this.i18n.t('common.characterCount', {
      used: this.i18n.formatNumber(this.value().length),
      max: this.i18n.formatNumber(limit),
    });
  });

  /**
   * Within a tenth of the limit, or the last twenty characters, whichever is
   * further out. Below that threshold the counter is informational only and
   * stays out of the announcement queue.
   */
  protected readonly nearLimit = computed(() => {
    const limit = this.maxLength();
    if (limit === null) {
      return false;
    }
    return limit - this.value().length <= Math.max(20, Math.round(limit * 0.1));
  });

  constructor() {
    // Height follows the value rather than only the keystroke, so a value
    // written by a form (an edited draft, a restored answer) sizes correctly on
    // the first paint.
    effect(() => {
      this.value();
      if (this.autoGrow()) {
        this.resize();
      }
    });
  }

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
    const next = (event.target as HTMLTextAreaElement).value;
    this.value.set(next);
    this.onChange(next);
    this.valueChange.emit(next);
  }

  protected handleBlur(): void {
    this.onTouched();
    this.blurred.emit();
  }

  /**
   * Measured rather than calculated from a line count, because the height also
   * depends on wrapping, on the Arabic line height and on the user's font size.
   * The ceiling lives in the stylesheet as a `max-block-size`.
   */
  private resize(): void {
    const element = this.control()?.nativeElement;
    if (!element) {
      return;
    }
    element.style.blockSize = 'auto';
    element.style.blockSize = `${element.scrollHeight}px`;
  }
}
