import { ComponentFixture } from '@angular/core/testing';

/** Query helper that fails loudly rather than returning null into an expect. */
export function el<T extends Element>(fixture: ComponentFixture<unknown>, selector: string): T {
  const found = fixture.nativeElement.querySelector(selector) as T | null;
  if (!found) {
    throw new Error(`Expected to find "${selector}" in the rendered output.`);
  }
  return found;
}

export function maybeEl<T extends Element>(
  fixture: ComponentFixture<unknown>,
  selector: string,
): T | null {
  return fixture.nativeElement.querySelector(selector) as T | null;
}

export function all<T extends Element>(
  fixture: ComponentFixture<unknown>,
  selector: string,
): T[] {
  return Array.from(fixture.nativeElement.querySelectorAll(selector)) as T[];
}

export function text(fixture: ComponentFixture<unknown>, selector: string): string {
  return el(fixture, selector).textContent?.trim() ?? '';
}

/**
 * Runs a block with the document in a given writing direction and restores the
 * previous value afterwards, so an RTL assertion cannot leak into later specs.
 */
export async function withDirection(
  direction: 'ltr' | 'rtl',
  block: () => void | Promise<void>,
): Promise<void> {
  const root = document.documentElement;
  const previousDir = root.getAttribute('dir');
  const previousLang = root.getAttribute('lang');
  root.setAttribute('dir', direction);
  root.setAttribute('lang', direction === 'rtl' ? 'ar' : 'en');
  try {
    await block();
  } finally {
    restoreAttribute(root, 'dir', previousDir);
    restoreAttribute(root, 'lang', previousLang);
  }
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}
