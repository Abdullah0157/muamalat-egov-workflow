import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

const STORAGE_KEY = 'muamalat.theme';

describe('ThemeService', () => {
  function create(): ThemeService {
    TestBed.configureTestingModule({});
    return TestBed.inject(ThemeService);
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  it('starts on the system preference with no attribute on the root element', () => {
    const theme = create();

    expect(theme.preference()).toBe('system');
    // No attribute is what lets the prefers-color-scheme block in the token
    // sheet apply.
    expect(document.documentElement.hasAttribute('data-theme')).toBeFalse();
  });

  it('stamps an explicit choice onto the root element', () => {
    const theme = create();

    theme.set('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(theme.resolved()).toBe('dark');

    theme.set('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(theme.resolved()).toBe('light');
  });

  /**
   * The point of the attribute override: a person who chooses light inside a
   * dark operating system, or dark inside a light one, gets what they asked for.
   */
  it('lets an explicit choice override the operating system in both directions', () => {
    const theme = create();

    theme.set('light');
    expect(theme.resolved()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    theme.set('dark');
    expect(theme.resolved()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('returns to the system preference by removing the attribute again', () => {
    const theme = create();
    theme.set('dark');

    theme.set('system');

    expect(document.documentElement.hasAttribute('data-theme')).toBeFalse();
    expect(theme.preference()).toBe('system');
  });

  it('remembers the choice for the next visit', () => {
    const first = create();
    first.set('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

    TestBed.resetTestingModule();
    const second = create();

    expect(second.preference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(STORAGE_KEY, 'sepia');

    expect(create().preference()).toBe('system');
  });

  it('resolves the system preference to a concrete theme', () => {
    const theme = create();
    const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    expect(theme.resolved()).toBe(systemIsDark ? 'dark' : 'light');
  });
});
