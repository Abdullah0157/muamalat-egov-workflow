import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { nextControlId } from '../field/field';
import { IconButton } from '../icon-button/icon-button';

export type DrawerSide = 'inline-end' | 'inline-start';
export type DrawerSize = 'sm' | 'md' | 'lg';

/**
 * Anything that is focusable by default. The `tabIndex` check below removes the
 * ones that are only reachable programmatically, which is cheaper and more
 * accurate than trying to express that in the selector.
 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex], audio[controls], video[controls], [contenteditable]';

/**
 * Side panel for secondary work: filters, a record preview, a comment thread.
 *
 * Anchored to the inline end edge, so it opens from the right in English and
 * from the left in Arabic without a mirrored stylesheet. Unlike `Dialog` this
 * is an ordinary positioned element rather than a native `<dialog>`, because a
 * drawer needs to slide and a top layer element cannot be transitioned in and
 * out without fighting the platform over when it is allowed to disappear. The
 * cost is that the focus trap is ours to maintain, which is what
 * `handleKeydown` below is.
 *
 * Slots:
 *   default         body, scrolls independently
 *   [drawerFooter]  actions pinned to the block end
 */
@Component({
  selector: 'app-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconButton],
  styleUrl: './drawer.scss',
  template: `
    <div
      class="drawer__scrim"
      [class.drawer__scrim--open]="open()"
      aria-hidden="true"
      (click)="requestClose()"
    ></div>

    <aside
      #panel
      class="drawer__panel"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      [class.drawer__panel--open]="open()"
      [class.drawer__panel--start]="side() === 'inline-start'"
      [class.drawer__panel--sm]="size() === 'sm'"
      [class.drawer__panel--lg]="size() === 'lg'"
      [attr.aria-labelledby]="titleId"
      [attr.inert]="open() ? null : ''"
      (keydown)="handleKeydown($event)"
    >
      <header class="drawer__header">
        <h2 class="drawer__title" [id]="titleId">{{ title() }}</h2>
        <app-icon-button
          class="drawer__close"
          icon="close"
          size="sm"
          [label]="i18n.t('a11y.closeDrawer')"
          (pressed)="requestClose()"
        />
      </header>

      <div class="drawer__body"><ng-content /></div>

      <footer class="drawer__footer"><ng-content select="[drawerFooter]" /></footer>
    </aside>
  `,
})
export class Drawer {
  readonly open = model(false);

  /** Already localised. Required: an unnamed panel cannot be announced. */
  readonly title = input.required<string>();

  /**
   * Which edge the panel is attached to. Both values are logical, so neither
   * one names a physical side.
   */
  readonly side = input<DrawerSide>('inline-end');

  readonly size = input<DrawerSize>('md');

  readonly closed = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private readonly panelRef = viewChild.required<ElementRef<HTMLElement>>('panel');

  protected readonly titleId = nextControlId('drawer-title');

  private opener: HTMLElement | null = null;
  private wasOpen = false;

  constructor() {
    // One place watches the flag, so a panel closed by the page and a panel
    // closed by the user hand focus back and report themselves the same way.
    //
    // After render, not during: a hidden or inert element cannot take focus, and
    // both of those come off the panel through bindings in this same pass.
    afterRenderEffect(() => {
      const panel = this.panelRef().nativeElement;
      const open = this.open();
      if (open) {
        this.captureFocus(panel);
      } else if (this.wasOpen) {
        this.releaseFocus();
        this.closed.emit();
      }
      this.wasOpen = open;
    });
  }

  protected requestClose(): void {
    this.open.set(false);
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    // The panel is not in the top layer, so nothing stops Tab from walking out
    // into the page behind the scrim. Wrapping the ends keeps it in.
    const stops = this.focusableStops();
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = this.document.activeElement;

    if (event.shiftKey && (active === first || active === this.panelRef().nativeElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private captureFocus(panel: HTMLElement): void {
    if (panel.contains(this.document.activeElement)) {
      return;
    }
    const active = this.document.activeElement;
    this.opener = active instanceof HTMLElement ? active : null;
    (this.focusableStops()[0] ?? panel).focus();
  }

  private releaseFocus(): void {
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) {
      opener.focus();
    }
  }

  private focusableStops(): HTMLElement[] {
    const candidates = this.panelRef().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE);
    return Array.from(candidates).filter(
      (element) => element.tabIndex >= 0 && !element.hasAttribute('disabled') && !element.hidden,
    );
  }
}
