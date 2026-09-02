import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { setupI18n, testProviders } from '../../testing/i18n';
import { all, el, text } from '../../testing/dom';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  imports: [ConfirmDialog],
  template: `
    <app-confirm-dialog
      [(open)]="open"
      [title]="title()"
      [description]="description()"
      [confirmLabel]="confirmLabel()"
      [cancelLabel]="cancelLabel()"
      [tone]="tone()"
      (confirmed)="confirmations = confirmations + 1"
      (cancelled)="cancellations = cancellations + 1"
    />
  `,
})
class Host {
  readonly open = signal(false);
  readonly title = signal('Delete state "Review"?');
  readonly description = signal<string | null>('The transitions connected to it go with it.');
  readonly confirmLabel = signal<string | null>(null);
  readonly cancelLabel = signal<string | null>(null);
  readonly tone = signal<'default' | 'danger'>('default');
  confirmations = 0;
  cancellations = 0;
}

describe('ConfirmDialog', () => {
  let fixture: ComponentFixture<Host>;

  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function openDialog(): Promise<void> {
    fixture.componentInstance.open.set(true);
    await settle();
  }

  function footerButtons(): HTMLButtonElement[] {
    return all<HTMLButtonElement>(fixture, '.dialog__footer button');
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

  it('asks the question in the dialog title', async () => {
    await openDialog();
    expect(text(fixture, '.dialog__title')).toBe('Delete state "Review"?');
    expect(text(fixture, '.dialog__description')).toContain('transitions');
  });

  it('falls back to the shared confirm and cancel wording', async () => {
    await openDialog();

    const [cancel, confirm] = footerButtons();
    expect(cancel.textContent?.trim()).toBe('Cancel');
    expect(confirm.textContent?.trim()).toBe('Confirm');
  });

  it('prefers a caller supplied label that names the action', async () => {
    fixture.componentInstance.confirmLabel.set('Delete state');
    fixture.componentInstance.cancelLabel.set('Keep editing');
    await openDialog();

    const [cancel, confirm] = footerButtons();
    expect(cancel.textContent?.trim()).toBe('Keep editing');
    expect(confirm.textContent?.trim()).toBe('Delete state');
  });

  it('confirms and closes', async () => {
    await openDialog();

    footerButtons()[1].click();
    await settle();

    expect(fixture.componentInstance.confirmations).toBe(1);
    expect(fixture.componentInstance.cancellations).toBe(0);
    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('cancels and closes', async () => {
    await openDialog();

    footerButtons()[0].click();
    await settle();

    expect(fixture.componentInstance.cancellations).toBe(1);
    expect(fixture.componentInstance.confirmations).toBe(0);
  });

  it('treats Escape as a cancellation rather than a silent close', async () => {
    await openDialog();

    el<HTMLDialogElement>(fixture, 'dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle();

    expect(fixture.componentInstance.cancellations).toBe(1);
    expect(fixture.componentInstance.confirmations).toBe(0);
  });

  it('does not carry a cancellation over to the next time it opens', async () => {
    await openDialog();
    footerButtons()[0].click();
    await settle();

    await openDialog();
    footerButtons()[1].click();
    await settle();

    expect(fixture.componentInstance.confirmations).toBe(1);
    expect(fixture.componentInstance.cancellations).toBe(1);
  });

  it('marks the destructive confirm button as dangerous', async () => {
    fixture.componentInstance.tone.set('danger');
    await openDialog();

    expect(footerButtons()[1].classList).toContain('btn--danger');
  });

  it('opens a destructive confirmation with focus on the safe answer', async () => {
    fixture.componentInstance.tone.set('danger');
    await openDialog();

    expect(document.activeElement).toBe(footerButtons()[0]);
  });
});
