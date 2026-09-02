/**
 * The vocabulary the new request wizard and its four steps share.
 *
 * Kept in its own file so a step component can build the same element id the
 * page will later look for, without the two importing each other.
 */

/** The four steps, in order. Each value is a message key. */
export const WIZARD_STEP_KEYS: readonly string[] = [
  'citizen.wizard.stepService',
  'citizen.wizard.stepDetails',
  'citizen.wizard.stepDocuments',
  'citizen.wizard.stepReview',
];

export const WIZARD_STEP_SERVICE = 0;
export const WIZARD_STEP_DETAILS = 1;
export const WIZARD_STEP_DOCUMENTS = 2;
export const WIZARD_STEP_REVIEW = 3;

/**
 * The id of the block that wraps one answer.
 *
 * The validation summary links to this, and moving focus to a problem means
 * finding this element and focusing the first control inside it. The wizard
 * passes its own instance prefix so two wizards on one page could not collide.
 */
export function fieldAnchorId(prefix: string, name: string): string {
  return `${prefix}-field-${name}`;
}

/** One entry in the validation summary: what is wrong, and where to fix it. */
export interface WizardProblem {
  /** Element id produced by `fieldAnchorId`. */
  readonly anchor: string;

  /** Already localised. */
  readonly message: string;
}

/**
 * A file the browser refused on the citizen's behalf.
 *
 * Held rather than thrown away so the message can name the file and say what
 * was wrong with it, which "invalid file" does not.
 */
export interface DocumentRejection {
  readonly kind: 'size' | 'type';
  readonly fileName: string;
  readonly sizeKb: number;
}

/** Lower case extensions, shown as "PDF, JPG, PNG". */
export function formatAcceptedFormats(formats: readonly string[]): string {
  return formats.map((format) => format.toUpperCase()).join(', ');
}

/** The `accept` attribute for a file input, ".pdf,.jpg,.png". */
export function acceptAttributeFor(formats: readonly string[]): string {
  return formats.map((format) => `.${format}`).join(',');
}
