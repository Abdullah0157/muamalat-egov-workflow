import { Injectable, signal } from '@angular/core';

export type SimulatedLatency = 'none' | 'fast' | 'slow';

const LATENCY_MS: Readonly<Record<SimulatedLatency, number>> = {
  none: 0,
  fast: 300,
  slow: 1500,
};

/**
 * Switches that exist only because this build has no back end.
 *
 * Loading, empty and error states are part of the product, not an afterthought,
 * so there has to be a way to reach them during review. The gateway reads these
 * and nothing else does; when a real API replaces the mock, this service and
 * the panel that drives it are deleted together.
 */
@Injectable({ providedIn: 'root' })
export class DemoSettingsService {
  private readonly latencySignal = signal<SimulatedLatency>('fast');
  private readonly failNextSignal = signal(false);
  private readonly emptySignal = signal(false);

  readonly latency = this.latencySignal.asReadonly();
  readonly failNext = this.failNextSignal.asReadonly();
  readonly emptyData = this.emptySignal.asReadonly();

  setLatency(latency: SimulatedLatency): void {
    this.latencySignal.set(latency);
  }

  setFailNext(fail: boolean): void {
    this.failNextSignal.set(fail);
  }

  setEmptyData(empty: boolean): void {
    this.emptySignal.set(empty);
  }

  reset(): void {
    this.latencySignal.set('fast');
    this.failNextSignal.set(false);
    this.emptySignal.set(false);
  }

  /** Delay for the next call, in milliseconds. */
  latencyMs(): number {
    return LATENCY_MS[this.latencySignal()];
  }

  /**
   * Consumes the one-shot failure flag. Reading it clears it, so the retry
   * button in the error state genuinely recovers, which is the behaviour worth
   * demonstrating.
   */
  consumeFailure(): boolean {
    if (!this.failNextSignal()) {
      return false;
    }
    this.failNextSignal.set(false);
    return true;
  }
}
