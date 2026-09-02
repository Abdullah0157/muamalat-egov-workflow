import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { all, el, maybeEl, text, withDirection } from '../../testing/dom';
import { TabPanel, Tabs } from './tabs';

@Component({
  imports: [TabPanel, Tabs],
  template: `
    <app-tabs [(selectedIndex)]="selected" ariaLabel="Request sections">
      <app-tab-panel label="Details" icon="file">
        <p class="probe-details">What you submitted</p>
      </app-tab-panel>
      <app-tab-panel label="Documents" badge="3">
        <p class="probe-documents">Your documents</p>
      </app-tab-panel>
      <app-tab-panel label="History" [disabled]="historyDisabled()">
        <p class="probe-history">Activity</p>
      </app-tab-panel>
    </app-tabs>
  `,
})
class Host {
  readonly selected = signal(0);
  readonly historyDisabled = signal(false);
}

describe('Tabs', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function tabs(): HTMLButtonElement[] {
    return all<HTMLButtonElement>(fixture, '[role="tab"]');
  }

  function press(key: string): void {
    el(fixture, '[role="tablist"]').dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('renders one tab per panel, labelled by the panel', () => {
    const labels = all(fixture, '.tabs__label').map((node) => node.textContent?.trim());
    expect(labels).toEqual(['Details', 'Documents', 'History']);
    expect(text(fixture, '[role="tab"] app-badge')).toBe('3');
    expect(all(fixture, '[role="tab"] app-badge').length).toBe(1);
  });

  it('wires each tab to its panel in both directions', async () => {
    const [first] = tabs();
    const panelId = first.getAttribute('aria-controls');
    const panel = el(fixture, `#${panelId}`);

    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(first.id);
  });

  it('names the strip', () => {
    expect(el(fixture, '[role="tablist"]').getAttribute('aria-label')).toBe('Request sections');
  });

  it('keeps only the selected panel content in the DOM', async () => {
    expect(maybeEl(fixture, '.probe-details')).not.toBeNull();
    expect(maybeEl(fixture, '.probe-documents')).toBeNull();

    fixture.componentInstance.selected.set(1);
    await settle();

    expect(maybeEl(fixture, '.probe-details')).toBeNull();
    expect(text(fixture, '.probe-documents')).toBe('Your documents');
  });

  it('marks the selected tab and gives the selected panel a tab stop', async () => {
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');

    const panelId = tabs()[0].getAttribute('aria-controls');
    expect(el(fixture, `#${panelId}`).getAttribute('tabindex')).toBe('0');
  });

  it('uses a roving tab stop so the strip is one stop in the page order', () => {
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('selects on click', async () => {
    tabs()[1].click();
    await settle();

    expect(fixture.componentInstance.selected()).toBe(1);
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
  });

  it('moves forward and backward with the arrow keys', async () => {
    press('ArrowRight');
    await settle();
    expect(fixture.componentInstance.selected()).toBe(1);
    expect(document.activeElement).toBe(tabs()[1]);

    press('ArrowLeft');
    await settle();
    expect(fixture.componentInstance.selected()).toBe(0);
  });

  it('wraps around the ends', async () => {
    press('ArrowLeft');
    await settle();

    expect(fixture.componentInstance.selected()).toBe(2);
  });

  it('jumps to the first and last tab with Home and End', async () => {
    press('End');
    await settle();
    expect(fixture.componentInstance.selected()).toBe(2);

    press('Home');
    await settle();
    expect(fixture.componentInstance.selected()).toBe(0);
  });

  it('steps over a disabled tab rather than landing on it', async () => {
    fixture.componentInstance.historyDisabled.set(true);
    fixture.componentInstance.selected.set(1);
    await settle();

    expect(tabs()[2].disabled).toBeTrue();

    press('ArrowRight');
    await settle();

    expect(fixture.componentInstance.selected()).toBe(0);
  });

  it('does not select a disabled tab that is clicked', async () => {
    fixture.componentInstance.historyDisabled.set(true);
    await settle();

    tabs()[2].click();
    await settle();

    expect(fixture.componentInstance.selected()).toBe(0);
  });

  it('follows the writing direction, so ArrowLeft moves forward in Arabic', async () => {
    await withDirection('rtl', async () => {
      await settle();

      press('ArrowLeft');
      await settle();
      expect(fixture.componentInstance.selected()).toBe(1);

      press('ArrowRight');
      await settle();
      expect(fixture.componentInstance.selected()).toBe(0);
    });
  });
});
