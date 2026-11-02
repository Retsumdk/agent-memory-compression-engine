const WORD_RE = /[a-z0-9]+/g;

export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at",
  "by", "for", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "to", "from", "up", "down",
  "in", "out", "on", "off", "over", "under", "again", "further", "once",
  "here", "there", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "can", "will", "just", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "having", "do", "does", "did",
  "doing", "it", "its", "this", "that", "these", "those", "i", "you", "he",
  "she", "we", "they", "them", "his", "her", "their", "of", "as", "because",
  "while", "until", "also", "am", "he", "hers", "him", "my", "ours", "who",
  "whom", "why", "what", "which", "how",
]);

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

export function contentWords(tokens: readonly string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t));
}

export function shingles(tokens: readonly string[], n: number): string[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError("shingle size must be an integer >= 1");
  }
  if (tokens.length === 0) return [];
  if (tokens.length < n) return [tokens.join(" ")];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function termFrequency(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

export function countTokens(text: string): number {
  return tokenize(text).length;
}
