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
import { Icon } from '../icon/icon';
import { describedByFor, errorIdFor, hintIdFor, nextControlId } from '../field/field';

/**
 * A single true or false answer: a declaration, a consent, a filter toggle.
 *
 * This is the one form control that does not use `app-field`, because a
 * checkbox reads as "box, then statement" on one line and a label stacked above
 * an empty box is a different, worse control. Everything else is shared: the
 * same id helpers, the same hint and error ids, the same `aria-describedby`
 * wiring, so a checkbox in a form behaves like every other field in it.
 *
 * The box is the real `<input>` with its own appearance removed, so focus,
 * activation and the platform's own state reporting are untouched. The check and
 * the dash are drawn glyphs rather than a colour change, so the state survives a
 * greyscale print and a low contrast screen.
 */
@Component({
  selector: 'app-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './checkbox.scss',
  host: {
    class: 'checkbox',
    '[class.checkbox--invalid]': '!!error()',
    '[class.checkbox--disabled]': 'isDisabled()',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Checkbox),
      multi: true,
    },
  ],
  template: `
    <span class="checkbox__control">
      <input
        #control
        type="checkbox"
        class="checkbox__input"
        [id]="controlId"
        [checked]="checked()"
        [disabled]="isDisabled()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-required]="required() ? 'true' : null"
        (change)="handleChange($event)"
        (blur)="handleBlur()"
      />
      @if (glyph(); as name) {
        <app-icon [name]="name" size="sm" class="checkbox__glyph" />
      }
    </span>

    <label class="checkbox__label" [attr.for]="controlId">
      <span>{{ label() }}</span>
      @if (required()) {
        <span class="checkbox__required" aria-hidden="true">*</span>
        <span class="u-visually-hidden">{{ i18n.t('a11y.requiredField') }}</span>
      }
    </label>

    @if (hint(); as hintText) {
      @if (!error()) {
        <p class="checkbox__hint" [id]="hintId">{{ hintText }}</p>
      }
    }

    @if (error(); as message) {
      <p class="checkbox__error" [id]="errorId">
        <app-icon name="alert-circle" size="sm" />
        <span>{{ message }}</span>
      </p>
    }
  `,
})
export class Checkbox implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  /**
   * The "some of the below are ticked" state, used by a filter group header.
   * Indeterminate is a DOM property with no attribute, so it is applied to the
   * element rather than bound in the template; the browser then reports the
   * mixed state itself and no `aria-checked` is needed.
   */
  readonly indeterminate = input(false, { transform: booleanAttribute });

  readonly checkedChange = output<boolean>();
  readonly blurred = output<void>();

  protected readonly i18n = inject(I18nService);

  protected readonly controlId = nextControlId('checkbox');
  protected readonly hintId = hintIdFor(this.controlId);
  protected readonly errorId = errorIdFor(this.controlId);

  protected readonly checked = signal(false);
  private readonly disabledByForm = signal(false);

  private readonly control = viewChild<ElementRef<HTMLInputElement>>('control');

  protected readonly isDisabled = computed(() => this.disabled() || this.disabledByForm());

  protected readonly describedBy = computed(() =>
    describedByFor(this.controlId, this.hint(), this.error()),
  );

  /** Nothing is drawn in the unchecked box: an empty box already says empty. */
  protected readonly glyph = computed(() => {
    if (this.indeterminate()) {
      return 'minus' as const;
    }
    return this.checked() ? ('check' as const) : null;
  });

  constructor() {
    effect(() => {
      const element = this.control()?.nativeElement;
      if (element) {
        element.indeterminate = this.indeterminate();
      }
    });
  }

  private onChange: (value: boolean) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: boolean | null): void {
    this.checked.set(value === true);
  }

  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledByForm.set(isDisabled);
  }

  protected handleChange(event: Event): void {
    const next = (event.target as HTMLInputElement).checked;
    this.checked.set(next);
    this.onChange(next);
    this.checkedChange.emit(next);
  }

  protected handleBlur(): void {
    this.onTouched();
    this.blurred.emit();
  }
}
