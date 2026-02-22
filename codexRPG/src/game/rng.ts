// Lightweight seeded random number generator for deterministic dungeon runs.

export class RNG {
  private state: number;

  constructor(seed = Date.now()) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    // Keep result in [0, 1) as an unsigned 32-bit fraction.
    return this.state / 0x100000000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max < min) {
      return min;
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array.');
    }
    return items[Math.floor(this.next() * items.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
