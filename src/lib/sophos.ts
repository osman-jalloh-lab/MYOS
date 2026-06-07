// Capability-scouting data layer for Sophos. Every connector here is read-only
// signal — Sophos never installs, configures, or applies anything; it only
// produces digests for Osman to act on himself (see skill-brief in @/agents/sophos).

const RELEASE_NOTES_URL = "https://docs.anthropic.com/en/release-notes/overview";

/**
 * release-watch — scrapes Anthropic/Claude release notes via Firecrawl and
 * returns the page as markdown for skill-brief to summarize. Returns null on
 * any failure (no Firecrawl key, network issue, etc.) — a missing source
 * shouldn't crash the digest, just shrink it.
 */
export async function fetchReleaseNotes(): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: RELEASE_NOTES_URL, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { markdown?: string } };
    return data.data?.markdown?.slice(0, 6000) ?? null;
  } catch {
    return null;
  }
}

export interface ScoutedRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  updatedAt: string;
}

interface GithubSearchItem {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
}

/**
 * repo-scout — searches public GitHub repos for capability/tooling keywords
 * (agent frameworks, skill registries, MCP servers — Osman's AI/GRC direction).
 * Uses the same unauthenticated public search API Athena's github-scout calls,
 * but with capability-oriented queries — different purpose, owned independently
 * by Sophos, not a reach into Athena's tool (see CLAUDE.md no-overlap note).
 */
export async function repoScout(query: string, max = 6): Promise<ScoutedRepo[]> {
  const params = new URLSearchParams({ q: query, sort: "updated", order: "desc", per_page: String(max) });
  const res = await fetch(`https://api.github.com/search/repositories?${params}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "hermes-os-sophos" },
  });
  if (!res.ok) throw new Error(`GitHub search ${res.status}`);

  const data = (await res.json()) as { items?: GithubSearchItem[] };
  return (data.items ?? []).map((item) => ({
    name: item.name,
    fullName: item.full_name,
    url: item.html_url,
    description: item.description,
    stars: item.stargazers_count,
    language: item.language,
    updatedAt: item.updated_at,
  }));
}

export interface ScoutedVideo {
  title: string;
  channel: string;
  url: string;
  publishedAt: string;
  description: string;
}

interface YoutubeSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description: string;
  };
}

/**
 * video-digest — searches YouTube for recent videos on a topic via the YouTube
 * Data API v3. Returns [] (not an error) when YOUTUBE_API_KEY is unset, so a
 * missing key shrinks the digest rather than failing the whole run.
 */
export async function videoDigest(query: string, max = 5): Promise<ScoutedVideo[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    order: "date",
    maxResults: String(max),
    key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) throw new Error(`YouTube search ${res.status}`);

  const data = (await res.json()) as { items?: YoutubeSearchItem[] };
  return (data.items ?? [])
    .filter((item) => item.id.videoId)
    .map((item) => ({
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      publishedAt: item.snippet.publishedAt,
      description: item.snippet.description,
    }));
}
