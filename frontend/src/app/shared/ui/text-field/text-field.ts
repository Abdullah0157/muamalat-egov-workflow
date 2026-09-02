import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { Field, describedByFor, nextControlId } from '../field/field';
import { Icon, IconName } from '../icon/icon';

export type TextFieldType = 'text' | 'email' | 'tel' | 'number' | 'search' | 'password' | 'url';

/**
 * Single line text input.
 *
 * Works with reactive forms through `ControlValueAccessor`, and can also be
 * driven directly by binding `value` and listening to `valueChange` on screens
 * that do not need a form.
 */
@Component({
  selector: 'app-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field, Icon],
  styleUrl: './text-field.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TextField),
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
      <div class="text-field" [class.text-field--with-icon]="!!icon()">
        @if (icon(); as leading) {
          <app-icon [name]="leading" size="md" class="text-field__icon" />
        }
        <input
          class="text-field__input"
          [id]="controlId"
          [attr.type]="type()"
          [attr.inputmode]="inputMode()"
          [attr.placeholder]="placeholder()"
          [attr.autocomplete]="autocomplete()"
          [attr.maxlength]="maxLength()"
          [attr.dir]="textDirection()"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-required]="required() ? 'true' : null"
          [value]="value()"
          [disabled]="isDisabled()"
          [readOnly]="readOnly()"
          (input)="handleInput($event)"
          (blur)="handleBlur()"
        />
      </div>
    </app-field>
  `,
})
export class TextField implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly type = input<TextFieldType>('text');
  readonly required = input(false, { transform: booleanAttribute });
  readonly readOnly = input(false, { transform: booleanAttribute });
  readonly showOptional = input(false, { transform: booleanAttribute });
  readonly autocomplete = input<string | null>(null);
  readonly inputMode = input<string | null>(null);
  readonly maxLength = input<number | null>(null);
  readonly icon = input<IconName | null>(null);

  /**
   * Forces the text direction of the input contents. Reference numbers, civil
   * IDs, emails and phone numbers stay left to right even inside an Arabic
   * page, because they are identifiers rather than prose.
   */
  readonly textDirection = input<'ltr' | 'rtl' | 'auto' | null>(null);

  readonly valueChange = output<string>();
  readonly blurred = output<void>();

  protected readonly controlId = nextControlId('text-field');
  protected readonly value = signal('');
  protected readonly isDisabled = signal(false);

  protected readonly describedBy = computed(() =>
    describedByFor(this.controlId, this.hint(), this.error()),
  );

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | number | null): void {
    this.value.set(value === null || value === undefined ? '' : String(value));
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
