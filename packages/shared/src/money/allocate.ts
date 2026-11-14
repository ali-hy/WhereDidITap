// F-302: largest-remainder allocation.
import { Money } from "./money.js";

export function allocate(m: Money, weights: readonly bigint[]): Money[] {
  if (weights.some((w) => typeof w !== "bigint")) {
    throw new TypeError("Weights must be bigints");
  }
  if (weights.length === 0 || weights.some((w) => w < 0n)) {
    throw new RangeError("Invalid allocation weights");
  }
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n) {
    throw new RangeError("Allocation weights sum to zero");
  }
  const negative = m.minor < 0n;
  const abs = negative ? -m.minor : m.minor;
  const count = BigInt(weights.length);
  const shares = weights.map((w) => (abs * w) / total);
  const leftover = abs - shares.reduce((a, b) => a + b, 0n);
  // Largest remainder first; a tie goes to the lower index (the index is part of the sort key).
  const order = weights
    .map((w, index) => ({ index, key: ((abs * w) % total) * count + (count - 1n - BigInt(index)) }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  const bumped = new Set(
    order.filter((_, rank) => BigInt(rank) < leftover).map((entry) => entry.index),
  );
  return shares.map((share, index) => {
    const part = share + (bumped.has(index) ? 1n : 0n);
    return Money.of(negative ? -part : part, m.currency);
  });
}
