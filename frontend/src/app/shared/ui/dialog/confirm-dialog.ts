import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Button } from '../button/button';
import { Dialog } from './dialog';

export type ConfirmTone = 'default' | 'danger';

/**
 * The question asked before something irreversible or something that moves a
 * case to a new stage.
 *
 * Backing out counts as cancelling however it happens, so Escape, the backdrop
 * and the close button all raise `cancelled` rather than closing silently. A
 * caller that only listens for `confirmed` still behaves correctly, and one
 * that needs to release a lock or re-enable a row has a single event to use.
 *
 * A destructive confirmation opens with focus on "cancel". The safe answer
 * should be the one an accidental Enter chooses.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dialog],
  template: `
    <app-dialog
      size="sm"
      [(open)]="open"
      [title]="title()"
      [description]="description()"
      (closed)="handleClosed()"
    >
      <ng-content />

      <app-button
        dialogFooter
        variant="secondary"
        [attr.dialogAutofocus]="tone() === 'danger' ? '' : null"
        (pressed)="settle('cancelled')"
      >
        {{ resolvedCancelLabel() }}
      </app-button>

      <app-button
        dialogFooter
        [variant]="tone() === 'danger' ? 'danger' : 'primary'"
        (pressed)="settle('confirmed')"
      >
        {{ resolvedConfirmLabel() }}
      </app-button>
    </app-dialog>
  `,
})
export class ConfirmDialog {
  readonly open = model(false);

  /** Already localised. Phrase it as the question, not as "Confirm". */
  readonly title = input.required<string>();

  readonly description = input<string | null>(null);

  /** Already localised. Name the action ("Delete state"), never "OK". */
  readonly confirmLabel = input<string | null>(null);
  readonly cancelLabel = input<string | null>(null);

  readonly tone = input<ConfirmTone>('default');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);

  protected readonly resolvedConfirmLabel = computed(
    () => this.confirmLabel() ?? this.i18n.t('common.confirm'),
  );
  protected readonly resolvedCancelLabel = computed(
    () => this.cancelLabel() ?? this.i18n.t('common.cancel'),
  );

  /** Set by the buttons; anything else that closes the dialog means "no". */
  private outcome: 'confirmed' | 'cancelled' = 'cancelled';

  protected settle(outcome: 'confirmed' | 'cancelled'): void {
    this.outcome = outcome;
    this.open.set(false);
  }

  protected handleClosed(): void {
    if (this.outcome === 'confirmed') {
      this.confirmed.emit();
    } else {
      this.cancelled.emit();
    }
    this.outcome = 'cancelled';
  }
}
