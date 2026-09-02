import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { I18nService } from '../../core/i18n/i18n.service';

/**
 * Turns Angular validation errors into localised, specific messages.
 *
 * Kept out of the design system on purpose: a text field should not know what a
 * civil ID is. Forms call this and hand the result to the control's `error`
 * input, which means every message in the product is written once, in the
 * catalogue, in both languages.
 */
export function validationMessage(
  control: AbstractControl | null | undefined,
  fieldLabel: string,
  i18n: I18nService,
): string | null {
  if (!control || !control.errors || (!control.touched && !control.dirty)) {
    return null;
  }
  return messageFor(control.errors, fieldLabel, i18n);
}

/** Message lookup with no touched or dirty gate, for summary panels. */
export function messageFor(
  errors: ValidationErrors,
  fieldLabel: string,
  i18n: I18nService,
): string | null {
  const field = fieldLabel;

  if (errors['required'] !== undefined) {
    return i18n.t('validation.required', { field });
  }
  if (errors['email'] !== undefined) {
    return i18n.t('validation.email');
  }
  if (errors['civilId'] !== undefined) {
    return i18n.t('validation.civilId');
  }
  if (errors['kuwaitPhone'] !== undefined) {
    return i18n.t('validation.phone');
  }
  if (errors['minlength'] !== undefined) {
    const detail = errors['minlength'] as { requiredLength: number };
    return i18n.t('validation.minLength', {
      field,
      min: i18n.formatNumber(detail.requiredLength),
    });
  }
  if (errors['maxlength'] !== undefined) {
    const detail = errors['maxlength'] as { requiredLength: number };
    return i18n.t('validation.maxLength', {
      field,
      max: i18n.formatNumber(detail.requiredLength),
    });
  }
  if (errors['min'] !== undefined) {
    const detail = errors['min'] as { min: number };
    return i18n.t('validation.min', { field, min: i18n.formatNumber(detail.min) });
  }
  if (errors['max'] !== undefined) {
    const detail = errors['max'] as { max: number };
    return i18n.t('validation.max', { field, max: i18n.formatNumber(detail.max) });
  }
  if (errors['dateFuture'] !== undefined) {
    return i18n.t('validation.dateFuture', { field });
  }
  if (errors['datePast'] !== undefined) {
    return i18n.t('validation.datePast', { field });
  }
  if (errors['numeric'] !== undefined) {
    return i18n.t('validation.number', { field });
  }
  if (errors['pattern'] !== undefined) {
    return i18n.t('validation.pattern', { field });
  }
  if (errors['acknowledge'] !== undefined) {
    return i18n.t('validation.acknowledgeRequired');
  }
  return i18n.t('validation.pattern', { field });
}

// -----------------------------------------------------------------------------
// Domain validators
// -----------------------------------------------------------------------------

/**
 * Kuwaiti civil ID: twelve digits, first digit encodes the century of birth.
 * The check digit algorithm is deliberately not implemented here because a
 * front end that rejects a valid card is far worse than one that lets the
 * server do the authoritative check.
 */
export function civilIdValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').trim();
    if (!value) {
      return null;
    }
    return /^[123]\d{11}$/.test(value) ? null : { civilId: true };
  };
}

/** Kuwaiti mobile number: eight digits beginning 5, 6 or 9. */
export function kuwaitPhoneValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').replace(/[\s-]/g, '');
    if (!value) {
      return null;
    }
    return /^[569]\d{7}$/.test(value) ? null : { kuwaitPhone: true };
  };
}

export function pastDateValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { pattern: true };
    }
    return date.getTime() <= Date.now() ? null : { datePast: true };
  };
}

export function futureDateValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { pattern: true };
    }
    return date.getTime() >= Date.now() ? null : { dateFuture: true };
  };
}

/** Requires a checkbox to be ticked, used for the submission declaration. */
export function mustAcknowledge(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    control.value === true ? null : { acknowledge: true };
}
