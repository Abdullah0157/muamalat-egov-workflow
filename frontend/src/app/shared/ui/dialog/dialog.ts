import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { nextControlId } from '../field/field';
import { IconButton } from '../icon-button/icon-button';

export type DialogSize = 'sm' | 'md' | 'lg';

/** Enough to find the control a caller meant when they marked its wrapper. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/**
 * Modal dialog.
 *
 * Built on the native `<dialog>` opened with `showModal()`, which is the only
 * way to get a real top layer, a genuinely inert background and platform
 * Escape handling. The browser also traps Tab inside the dialog, so there is no
 * hand written focus trap here to drift out of date with the platform.
 *
 * What the platform does not do is give focus back afterwards, so this
 * component remembers the element that opened it and returns focus there on
 * close. Losing your place in a long queue because a confirmation closed is a
 * real defect, not a nicety.
 *
 * Every exit, the close button, Escape and a backdrop click, funnels through
 * `requestClose()`, which is the single place a future "are you sure" gate
 * would go.
 *
 * Slots:
 *   default         body, scrolls independently of the header and footer
 *   [dialogFooter]  actions
 *
 * Put `dialogAutofocus` on the control that should receive focus on open, for
 * example the comment box on a transition dialog. Without it the platform
 * focuses the first focusable element.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton],
  styleUrl: './dialog.scss',
  template: `
    <dialog
      #dialogEl
      class="dialog"
      role="dialog"
      aria-modal="true"
      [class.dialog--sm]="size() === 'sm'"
      [class.dialog--md]="size() === 'md'"
      [class.dialog--lg]="size() === 'lg'"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="description() ? descriptionId : null"
      (cancel)="handleCancel($event)"
      (close)="handleClose()"
      (click)="handleBackdropClick($event)"
    >
      <div class="dialog__panel">
        <header class="dialog__header">
          <div class="dialog__heading">
            <h2 class="dialog__title" [id]="titleId">{{ title() }}</h2>
            @if (description(); as text) {
              <p class="dialog__description" [id]="descriptionId">{{ text }}</p>
            }
          </div>

          @if (dismissible()) {
            <app-icon-button
              class="dialog__close"
              icon="close"
              size="sm"
              [label]="i18n.t('a11y.closeDialog')"
              (pressed)="requestClose()"
            />
          }
        </header>

        <div class="dialog__body"><ng-content /></div>

        <footer class="dialog__footer"><ng-content select="[dialogFooter]" /></footer>
      </div>
    </dialog>
  `,
})
export class Dialog {
  /** Two-way, so a caller can both open the dialog and be told it closed. */
  readonly open = model(false);

  /** Already localised. Required: an unnamed dialog cannot be announced. */
  readonly title = input.required<string>();

  readonly description = input<string | null>(null);
  readonly size = input<DialogSize>('md');

  /**
   * Whether the backdrop and the close button offer a way out. Escape always
   * closes regardless: a modal a keyboard user cannot leave is a trap, and a
   * dialog that must not be abandoned should ask the question again rather than
   * refuse to close.
   */
  readonly dismissible = input(true, { transform: booleanAttribute });

  readonly closed = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialogEl');

  protected readonly titleId = nextControlId('dialog-title');
  protected readonly descriptionId = nextControlId('dialog-description');

  /** The control that opened the dialog. Focus returns here when it closes. */
  private opener: HTMLElement | null = null;

  /**
   * Mirrors the element's state. The platform fires `close` from a queued task,
   * so this is what lets a close be settled straight away and still be safe when
   * that event turns up afterwards.
   */
  private presented = false;

  constructor() {
    // After render, not during: opening reads the projected content to find the
    // autofocus target, and that content only exists once the view holding it
    // has been rendered.
    afterRenderEffect(() => {
      const element = this.dialogRef().nativeElement;
      if (this.open()) {
        this.present(element);
      } else if (this.presented) {
        this.requestClose();
      }
    });
  }

  /** The single exit. The close button, Escape and the backdrop all land here. */
  protected requestClose(): void {
    const element = this.dialogRef().nativeElement;
    if (element.open) {
      element.close();
    }
    this.finishClose();
  }

  protected handleCancel(event: Event): void {
    // Escape arrives as `cancel`. The default action would close the dialog
    // behind our back, so it is taken over here to keep one exit path.
    event.preventDefault();
    this.requestClose();
  }

  protected handleClose(): void {
    // Also covers a close the platform performed itself, for example a form
    // submitted with method="dialog". Settling twice is a no-op.
    this.finishClose();
  }

  protected handleBackdropClick(event: MouseEvent): void {
    // The panel fills the dialog box exactly, so the dialog element is only the
    // event target when the click landed on the backdrop itself.
    if (this.dismissible() && event.target === this.dialogRef().nativeElement) {
      this.requestClose();
    }
  }

  private present(element: HTMLDialogElement): void {
    if (this.presented) {
      return;
    }
    const active = this.document.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
    element.showModal();
    this.presented = true;

    // `showModal()` focuses the first focusable descendant. Override that only
    // when the caller has named a better starting point. The marker is usually
    // put on a component host, which is not focusable itself, so fall through
    // to the first real control inside it.
    const marked = element.querySelector<HTMLElement>('[dialogAutofocus]');
    if (marked) {
      const target = marked.tabIndex >= 0 ? marked : marked.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }
  }

  private finishClose(): void {
    if (!this.presented) {
      return;
    }
    this.presented = false;
    this.open.set(false);
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) {
      opener.focus();
    }
    this.closed.emit();
  }
}
