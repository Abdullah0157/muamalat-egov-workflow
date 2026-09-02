import {
  Message,
  MessageCatalogue,
  MessageParams,
  PLURAL_CATEGORIES,
  PluralCategory,
  RawCatalogue,
} from './i18n.types';

const PLURAL_KEYS = new Set<string>(PLURAL_CATEGORIES);

/**
 * An object is treated as a plural message when every one of its keys is a CLDR
 * plural category. Anything else is a nesting level. This rule is what lets the
 * catalogues be authored as readable nested JSON while lookup stays a flat map.
 */
function isPluralMessage(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => PLURAL_KEYS.has(key));
}

/** Flattens authored JSON into a dotted-key map. */
export function flattenCatalogue(raw: RawCatalogue): MessageCatalogue {
  const flat = new Map<string, Message>();

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      flat.set(path, node);
      return;
    }
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const record = node as Record<string, unknown>;
    if (isPluralMessage(record)) {
      const forms: Partial<Record<PluralCategory, string>> = {};
      for (const category of PLURAL_CATEGORIES) {
        const form = record[category];
        if (typeof form === 'string') {
          forms[category] = form;
        }
      }
      flat.set(path, forms);
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(raw, '');
  return flat;
}

/**
 * Replaces `{name}` placeholders. An unmatched placeholder is left in place so
 * that a wiring mistake is visible during review rather than silently emitting
 * an empty string in front of a citizen.
 */
export function interpolate(template: string, params: MessageParams | undefined): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Shallow value equality, used to memoise the translate pipe. */
export function paramsEqual(a: MessageParams | undefined, b: MessageParams | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}
