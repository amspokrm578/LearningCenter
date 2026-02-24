export interface Rng {
  next(): number; // [0, 1)
  int(minInclusive: number, maxInclusive: number): number;
  normal(mean?: number, stdDev?: number): number;
}

// Deterministic, fast PRNG suitable for simulations (not crypto).
// Reference: Mulberry32 variant.
export function createRng(seed: number): Rng {
  let t = seed >>> 0;

  const next = () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    const r = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    return r;
  };

  const int = (minInclusive: number, maxInclusive: number) => {
    if (!Number.isFinite(minInclusive) || !Number.isFinite(maxInclusive)) {
      throw new Error('Rng.int bounds must be finite numbers');
    }
    if (maxInclusive < minInclusive) {
      throw new Error('Rng.int max must be >= min');
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(next() * span);
  };

  // Box-Muller transform
  const normal = (mean = 0, stdDev = 1) => {
    const u1 = Math.max(next(), Number.EPSILON);
    const u2 = next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  };

  return { next, int, normal };
}

