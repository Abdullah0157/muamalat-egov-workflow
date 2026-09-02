import { Injectable, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

/** A single optional follow up, for example "view the request". */
export interface ToastAction {
  /** Already localised. */
  readonly label: string;
  readonly run: () => void;
}

export interface ToastInput {
  readonly tone: ToastTone;
  /** Already localised. One line, the outcome rather than the mechanism. */
  readonly title: string;
  readonly description?: string;
  /** Zero means the toast stays until it is dismissed. */
  readonly durationMs?: number;
  readonly action?: ToastAction;
}

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description: string | null;
  readonly durationMs: number;
  readonly action: ToastAction | null;
}

/** Long enough to read two lines, short enough not to become furniture. */
export const TOAST_DEFAULT_DURATION_MS = 6000;

/** More than four stacked messages is a log, and nobody reads a log. */
export const TOAST_VISIBLE_LIMIT = 4;

interface ToastTimer {
  handle: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  resumedAt: number;
}

/**
 * The queue behind the toast stack.
 *
 * Errors do not expire. An error a user missed because they were reading
 * something else is worse than a message that sits there until it is dismissed,
 * so `error()` produces a toast with no timer and callers have to opt back in
 * by passing a duration.
 *
 * Toasts confirm work that has already happened. Anything a user must act on
 * belongs in the page, not here.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly queue = signal<readonly Toast[]>([]);

  /** The visible stack, oldest first. */
  readonly toasts = this.queue.asReadonly();

  private readonly timers = new Map<string, ToastTimer>();
  private sequence = 0;
  private paused = false;

  /** Returns the id, so a caller can dismiss a toast it raised itself. */
  show(input: ToastInput): string {
    this.sequence += 1;
    const toast: Toast = {
      id: `toast-${this.sequence}`,
      tone: input.tone,
      title: input.title,
      description: input.description ?? null,
      durationMs: input.durationMs ?? (input.tone === 'danger' ? 0 : TOAST_DEFAULT_DURATION_MS),
      action: input.action ?? null,
    };

    this.queue.update((current) => {
      const next = [...current, toast];
      // Oldest out first: the newest message is the one describing what the user
      // just did.
      for (const dropped of next.slice(0, Math.max(0, next.length - TOAST_VISIBLE_LIMIT))) {
        this.clearTimer(dropped.id);
      }
      return next.slice(-TOAST_VISIBLE_LIMIT);
    });

    if (toast.durationMs > 0) {
      this.timers.set(toast.id, { handle: null, remainingMs: toast.durationMs, resumedAt: 0 });
      if (!this.paused) {
        this.startTimer(toast.id);
      }
    }
    return toast.id;
  }

  success(title: string, description?: string): string {
    return this.show({ tone: 'success', title, description });
  }

  /** Raised as a danger toast, which does not expire on its own. */
  error(title: string, description?: string): string {
    return this.show({ tone: 'danger', title, description });
  }

  info(title: string, description?: string): string {
    return this.show({ tone: 'info', title, description });
  }

  warning(title: string, description?: string): string {
    return this.show({ tone: 'warning', title, description });
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this.queue.update((current) => current.filter((toast) => toast.id !== id));
  }

  /**
   * Freezes every countdown. Pointing at or tabbing into the stack means the
   * user is reading it, and a message that vanishes mid sentence is a defect.
   */
  pause(): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    const now = Date.now();
    for (const timer of this.timers.values()) {
      if (timer.handle === null) {
        continue;
      }
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.remainingMs = Math.max(0, timer.remainingMs - (now - timer.resumedAt));
    }
  }

  /** Restarts each countdown from what was left of it, not from the top. */
  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    for (const id of [...this.timers.keys()]) {
      this.startTimer(id);
    }
  }

  private startTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle !== null) {
      return;
    }
    timer.resumedAt = Date.now();
    timer.handle = setTimeout(() => this.dismiss(id), timer.remainingMs);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer?.handle !== null && timer?.handle !== undefined) {
      clearTimeout(timer.handle);
    }
    this.timers.delete(id);
  }
}
