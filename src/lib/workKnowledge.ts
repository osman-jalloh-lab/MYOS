// Work knowledge loader — the retrieval layer behind Themis (work agent).
// Reads every .md/.txt file in knowledge/work/, splits them into heading-led
// chunks, and returns the chunks most relevant to the question by plain
// keyword overlap. No embeddings, no external calls — cheap, private, and
// good enough while the corpus is small. Returns "" when the folder is
// absent so test/CI environments stay safe (same pattern as personalContext).
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const WORK_DIR = join(process.cwd(), "knowledge", "work");
const MAX_CONTEXT_CHARS = 6000;
const MAX_CHUNKS = 6;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "to", "of", "in", "on", "for", "with", "at", "by", "from", "as", "it",
  "this", "that", "what", "when", "how", "do", "does", "can", "i", "my",
  "me", "you", "your", "we", "our", "they", "their", "about", "have", "has",
]);

interface Chunk {
  file: string;
  heading: string;
  body: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function loadChunks(): Chunk[] {
  if (!existsSync(WORK_DIR)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(WORK_DIR).filter((f) => /\.(md|txt)$/i.test(f) && f.toLowerCase() !== "readme.md");
  } catch {
    return [];
  }

  const chunks: Chunk[] = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = readFileSync(join(WORK_DIR, file), "utf-8");
    } catch {
      continue;
    }
    // Split on markdown headings; the heading becomes the chunk's retrieval key.
    const parts = raw.split(/^(?=#{1,3}\s)/m);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      chunks.push({
        file,
        heading: headingMatch?.[1]?.trim() ?? file,
        body: trimmed.slice(0, 2400),
      });
    }
  }
  return chunks;
}

/** True when at least one knowledge file exists (drives the empty-state copy). */
export function hasWorkKnowledge(): boolean {
  if (!existsSync(WORK_DIR)) return false;
  try {
    return readdirSync(WORK_DIR).some((f) => /\.(md|txt)$/i.test(f) && f.toLowerCase() !== "readme.md");
  } catch {
    return false;
  }
}

/**
 * Returns the knowledge chunks most relevant to `query`, capped for prompt
 * budget. Falls back to the first chunks of every file when the query has no
 * scoring overlap (broad questions still get grounded material).
 */
export function retrieveWorkKnowledge(query: string): string {
  const chunks = loadChunks();
  if (chunks.length === 0) return "";

  const queryTokens = new Set(tokenize(query));
  const scored = chunks
    .map((c) => {
      const tokens = tokenize(`${c.heading} ${c.body}`);
      let score = 0;
      for (const t of tokens) if (queryTokens.has(t)) score += 1;
      // Heading hits weigh extra — headings are the retrieval index.
      for (const t of tokenize(c.heading)) if (queryTokens.has(t)) score += 3;
      return { chunk: c, score };
    })
    .sort((a, b) => b.score - a.score);

  const anyHit = scored.some((s) => s.score > 0);
  const picked = (anyHit ? scored.filter((s) => s.score > 0) : scored).slice(0, MAX_CHUNKS);

  let total = 0;
  const out: string[] = [];
  for (const { chunk } of picked) {
    const block = `[${chunk.file} › ${chunk.heading}]\n${chunk.body}`;
    if (total + block.length > MAX_CONTEXT_CHARS) break;
    out.push(block);
    total += block.length;
  }
  return out.join("\n\n");
}
