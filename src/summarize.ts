import { tokenize, contentWords } from "./tokens.js";

export interface SummaryOptions {
  keepRatio: number;
  maxSummarySentences: number;
  minSentenceChars: number;
}

export interface ScoredSentence {
  index: number;
  text: string;
  score: number;
}

export function splitSentences(content: string, minSentenceChars: number): string[] {
  const trimmed = content.trim();
  if (trimmed === "") return [];
  const raw = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= minSentenceChars);
  if (raw.length > 0) return raw;
  return trimmed.length >= minSentenceChars ? [trimmed] : [];
}

export function summarizeCluster(
  contents: readonly string[],
  options: SummaryOptions,
): string {
  const sentences: string[] = [];
  for (const content of contents) {
    sentences.push(...splitSentences(content, options.minSentenceChars));
  }
  if (sentences.length === 0) return "";
  if (sentences.length === 1) return sentences[0] as string;
  const tf = new Map<string, number>();
  for (const sentence of sentences) {
    for (const word of contentWords(tokenize(sentence))) {
      tf.set(word, (tf.get(word) ?? 0) + 1);
    }
  }
  const scored: ScoredSentence[] = sentences.map((text, index) => {
    const words = contentWords(tokenize(text));
    let sum = 0;
    for (const word of words) sum += tf.get(word) ?? 0;
    const score = words.length === 0 ? 0 : sum / Math.sqrt(words.length);
    return { index, text, score };
  });
  const keep = Math.max(
    1,
    Math.min(
      options.maxSummarySentences,
      Math.ceil(sentences.length * options.keepRatio),
    ),
  );
  const selected = [...scored]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, keep)
    .sort((a, b) => a.index - b.index);
  return selected.map((s) => s.text).join(" ");
}
