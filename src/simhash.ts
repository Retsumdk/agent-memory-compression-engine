import { createHash } from "node:crypto";

export function hash64(text: string): bigint {
  const digest = createHash("sha256").update(text).digest();
  let value = 0n;
  for (let byte = 0; byte < 8; byte++) {
    value |= BigInt(digest[byte] as number) << BigInt(byte * 8);
  }
  return value;
}

export function simhash64(shingles: readonly string[]): bigint {
  const weights = new Array<number>(64).fill(0);
  for (const shingle of shingles) {
    const digest = createHash("sha256").update(shingle).digest();
    for (let bit = 0; bit < 64; bit++) {
      const byte = digest[Math.floor(bit / 8)] as number;
      const isOne = ((byte >> (bit % 8)) & 1) === 1;
      weights[bit] = (weights[bit] as number) + (isOne ? 1 : -1);
    }
  }
  let hash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if ((weights[bit] as number) >= 0) hash |= 1n << BigInt(bit);
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let distance = 0;
  while (x !== 0n) {
    if ((x & 1n) === 1n) distance++;
    x >>= 1n;
  }
  return distance;
}
