import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../testing/i18n';
import { el, maybeEl, text } from '../../testing/dom';
import { Dialog } from './dialog';

@Component({
  imports: [Dialog],
  template: `
    <button type="button" class="probe-opener" (click)="open.set(true)">Open</button>

    <app-dialog
      [(open)]="open"
      [title]="title()"
      [description]="description()"
      [dismissible]="dismissible()"
      [size]="size()"
      (closed)="closes = closes + 1"
    >
      <p class="probe-body">The request will move to the approval stage.</p>
      @if (withAutofocus()) {
        <input class="probe-autofocus" dialogAutofocus />
      }
      <button dialogFooter type="button" class="probe-confirm">Confirm</button>
    </app-dialog>
  `,
})
class Host {
  readonly open = signal(false);
  readonly title = signal('Apply "Approve"?');
  readonly description = signal<string | null>('This records the action against your name.');
  readonly dismissible = signal(true);
  readonly size = signal<'sm' | 'md' | 'lg'>('md');
  readonly withAutofocus = signal(false);
  closes = 0;
}

describe('Dialog', () => {
  let fixture: ComponentFixture<Host>;

  /** The platform fires `close` from a queued task, so a microtask flush is not enough. */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function openDialog(): Promise<void> {
    fixture.componentInstance.open.set(true);
    await settle();
  }

  function dialogEl(): HTMLDialogElement {
    return el<HTMLDialogElement>(fixture, 'dialog');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('stays closed until asked to open', () => {
    expect(dialogEl().open).toBeFalse();
  });

  it('opens as a real modal in the top layer', async () => {
    await openDialog();

    expect(dialogEl().open).toBeTrue();
    expect(dialogEl().matches(':modal')).toBeTrue();
  });

  it('names and describes itself through the elements it renders', async () => {
    await openDialog();

    const dialog = dialogEl();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const titleId = dialog.getAttribute('aria-labelledby');
    const descriptionId = dialog.getAttribute('aria-describedby');
    expect(text(fixture, `#${titleId}`)).toBe('Apply "Approve"?');
    expect(text(fixture, `#${descriptionId}`)).toContain('records the action');
  });

  it('omits aria-describedby when there is no description', async () => {
    fixture.componentInstance.description.set(null);
    await openDialog();

    expect(dialogEl().hasAttribute('aria-describedby')).toBeFalse();
    expect(maybeEl(fixture, '.dialog__description')).toBeNull();
  });

  it('moves focus into the dialog on open', async () => {
    await openDialog();

    expect(dialogEl().contains(document.activeElement)).toBeTrue();
  });

  it('prefers the element marked dialogAutofocus', async () => {
    fixture.componentInstance.withAutofocus.set(true);
    await openDialog();

    expect(document.activeElement).toBe(el(fixture, '.probe-autofocus'));
  });

  it('returns focus to the control that opened it', async () => {
    const opener = el<HTMLButtonElement>(fixture, '.probe-opener');
    opener.focus();
    opener.click();
    await settle();
    expect(dialogEl().open).toBeTrue();

    fixture.componentInstance.open.set(false);
    await settle();

    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape and reports it', async () => {
    await openDialog();

    // Escape reaches a native dialog as a `cancel` event. Synthetic key events
    // are untrusted and the platform ignores them, so the spec drives `cancel`.
    dialogEl().dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle();

    expect(dialogEl().open).toBeFalse();
    expect(fixture.componentInstance.open()).toBeFalse();
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('closes on a backdrop click when dismissible', async () => {
    await openDialog();

    dialogEl().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('ignores a backdrop click when it is not dismissible', async () => {
    fixture.componentInstance.dismissible.set(false);
    await openDialog();

    dialogEl().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(fixture.componentInstance.open()).toBeTrue();
    expect(maybeEl(fixture, '.dialog__close')).toBeNull();
  });

  it('does not treat a click inside the panel as a backdrop click', async () => {
    await openDialog();

    el(fixture, '.probe-body').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(fixture.componentInstance.open()).toBeTrue();
  });

  it('closes from its own close button, which carries a translated name', async () => {
    await openDialog();

    const close = el<HTMLButtonElement>(fixture, '.dialog__close button');
    expect(close.getAttribute('aria-label')).toBe('Close dialog');

    close.click();
    await settle();

    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('projects the footer actions into the footer', async () => {
    await openDialog();

    expect(maybeEl(fixture, '.dialog__footer .probe-confirm')).not.toBeNull();
    expect(maybeEl(fixture, '.dialog__body .probe-body')).not.toBeNull();
  });

  it('applies the size class', async () => {
    fixture.componentInstance.size.set('lg');
    await openDialog();

    expect(dialogEl().classList).toContain('dialog--lg');
  });
});
