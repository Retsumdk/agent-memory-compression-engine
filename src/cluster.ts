import { shingles, jaccard, tokenize } from "./tokens.js";
import { simhash64, hammingDistance } from "./simhash.js";

export interface ClusteringOptions {
  similarityThreshold: number;
  shingleSize: number;
  exactDupHamming: number;
  minShinglesForHammingShortcut: number;
}

export interface ClusterableEntry {
  id: string;
  content: string;
}

export class DisjointSet {
  private readonly parent = new Map<number, number>();

  find(x: number): number {
    let root = x;
    for (;;) {
      const parent = this.parent.get(root);
      if (parent === undefined) break;
      root = parent;
    }
    let current = x;
    while (current !== root) {
      const next = this.parent.get(current) as number;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const low = Math.min(rootA, rootB);
    const high = Math.max(rootA, rootB);
    this.parent.set(high, low);
  }
}

export function clusterEntries<T extends ClusterableEntry>(
  entries: readonly T[],
  options: ClusteringOptions,
): T[][] {
  const count = entries.length;
  if (count === 0) return [];
  const dsu = new DisjointSet();
  const shingleSets: Array<Set<string>> = [];
  const hashes: bigint[] = [];
  for (const entry of entries) {
    const tokens = tokenize(entry.content);
    const shingleList = shingles(tokens, options.shingleSize);
    shingleSets.push(new Set(shingleList));
    hashes.push(simhash64(shingleList));
  }
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const setA = shingleSets[i] as Set<string>;
      const setB = shingleSets[j] as Set<string>;
      let linked = jaccard(setA, setB) >= options.similarityThreshold;
      if (!linked && options.exactDupHamming >= 0) {
        const canShortcut =
          setA.size >= options.minShinglesForHammingShortcut &&
          setB.size >= options.minShinglesForHammingShortcut;
        if (canShortcut) {
          linked =
            hammingDistance(hashes[i] as bigint, hashes[j] as bigint) <=
            options.exactDupHamming;
        }
      }
      if (linked) dsu.union(i, j);
    }
  }
  const groups = new Map<number, T[]>();
  for (let i = 0; i < count; i++) {
    const root = dsu.find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(entries[i] as T);
    else groups.set(root, [entries[i] as T]);
  }
  return [...groups.values()];
}
