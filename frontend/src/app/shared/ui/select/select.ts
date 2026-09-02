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
import { Icon } from '../icon/icon';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** A titled run of options, rendered as an `<optgroup>`. */
export interface SelectOptionGroup {
  readonly label: string;
  readonly options: readonly SelectOption[];
}

/**
 * Single choice from a known list.
 *
 * This wraps the native `<select>` rather than building a listbox. A government
 * system is used on old desktops, on phones and with assistive technology it was
 * never tested against, and the native control is the only one that is correct
 * everywhere: it gets the platform picker on touch, type ahead on desktop, and
 * screen reader support for free. The only thing taken from it is the arrow,
 * which is replaced so the control matches the rest of the form.
 */
@Component({
  selector: 'app-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Field, Icon],
  styleUrl: './select.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Select),
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
      <div class="select">
        <select
          class="select__control"
          [id]="controlId"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-required]="required() ? 'true' : null"
          [disabled]="isDisabled()"
          (change)="handleChange($event)"
          (blur)="handleBlur()"
        >
          @if (placeholder(); as prompt) {
            <option value="" disabled [selected]="value() === ''">{{ prompt }}</option>
          }

          @for (option of options(); track option.value) {
            <option
              [value]="option.value"
              [disabled]="!!option.disabled"
              [selected]="option.value === value()"
            >
              {{ option.label }}
            </option>
          }

          @for (group of groups(); track group.label) {
            <optgroup [label]="group.label">
              @for (option of group.options; track option.value) {
                <option
                  [value]="option.value"
                  [disabled]="!!option.disabled"
                  [selected]="option.value === value()"
                >
                  {{ option.label }}
                </option>
              }
            </optgroup>
          }
        </select>

        <app-icon name="chevron-down" size="md" class="select__arrow" />
      </div>
    </app-field>
  `,
})
export class Select implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly options = input<readonly SelectOption[]>([]);

  /**
   * Grouped options, rendered after the flat `options` list. A control normally
   * uses one or the other; both are accepted so a "recent" run can sit above the
   * grouped remainder without a second component.
   */
  readonly groups = input<readonly SelectOptionGroup[]>([]);

  /**
   * Empty first option, disabled so it cannot be chosen back after a real
   * selection. Leave it unset on a control that always has a sensible default.
   */
  readonly placeholder = input<string | null>(null);

  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  readonly showOptional = input(false, { transform: booleanAttribute });

  readonly valueChange = output<string>();
  readonly blurred = output<void>();

  protected readonly controlId = nextControlId('select');
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

  protected handleChange(event: Event): void {
    const next = (event.target as HTMLSelectElement).value;
    this.value.set(next);
    this.onChange(next);
    this.valueChange.emit(next);
  }

  protected handleBlur(): void {
    this.onTouched();
    this.blurred.emit();
  }
}
