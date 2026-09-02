/**
 * Deterministic pseudo random source.
 *
 * The sample data has to be identical on every load: a dashboard that shows a
 * different average processing time each time it is opened is worse than no
 * dashboard, and specs that assert on derived figures need a fixed corpus.
 * Mulberry32 is small, fast and good enough for generating plausible records.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform pick. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty list');
    }
    return items[this.int(0, items.length - 1)];
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * Weighted pick. Weights do not need to sum to one; they are normalised.
   * Used so the generated corpus has a realistic mix rather than a flat spread.
   */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let threshold = this.next() * total;
    for (const [value, weight] of entries) {
      threshold -= weight;
      if (threshold <= 0) {
        return value;
      }
    }
    return entries[entries.length - 1][0];
  }
}
