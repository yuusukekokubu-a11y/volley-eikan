// 種つき乱数。同じ種なら同じラリーになる。

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** 0以上1未満 */
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 平均0・標準偏差1の正規乱数 */
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** 重みつきで1つ選ぶ。重みがすべて0なら undefined */
  weighted<T>(items: readonly { item: T; w: number }[]): T | undefined {
    const total = items.reduce((s, i) => s + Math.max(0, i.w), 0);
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const i of items) {
      r -= Math.max(0, i.w);
      if (r < 0) return i.item;
    }
    return items[items.length - 1].item;
  }
}
