// Career data layer for Athena. Athena finds, ranks, and drafts — it never
// submits an application or messages a recruiter (that's an "apply_to_job"
// approval-queue action per master-spec section 3, gated like every other write).
import { prisma } from "./db";

export type JobStatus = "interested" | "applied" | "interview" | "offer" | "rejected" | "archived";
export type JobSource = "manual" | "github-scout" | "job-scout";

export interface JobListingInput {
  title: string;
  company: string;
  url?: string;
  source?: JobSource;
  notes?: string;
  postedAt?: Date;
}

/** job-search — lists tracked roles, most recent first. */
export async function jobSearch(userId: string, status?: JobStatus) {
  return prisma.jobListing.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function addJobListing(userId: string, input: JobListingInput) {
  return prisma.jobListing.create({
    data: {
      userId,
      title: input.title,
      company: input.company,
      url: input.url,
      source: input.source ?? "manual",
      notes: input.notes,
      postedAt: input.postedAt,
    },
  });
}

/** app-tracker — moves a tracked role through the pipeline (interested -> applied -> ...). */
export async function updateJobStatus(userId: string, id: string, status: JobStatus) {
  const listing = await prisma.jobListing.findFirst({ where: { id, userId } });
  if (!listing) throw new Error("Job listing not found");
  return prisma.jobListing.update({ where: { id }, data: { status } });
}

export async function setFitScore(userId: string, id: string, fitScore: number) {
  const listing = await prisma.jobListing.findFirst({ where: { id, userId } });
  if (!listing) throw new Error("Job listing not found");
  return prisma.jobListing.update({ where: { id }, data: { fitScore } });
}

export interface AppTrackerSummary {
  total: number;
  byStatus: Record<JobStatus, number>;
  recent: Awaited<ReturnType<typeof jobSearch>>;
}

/** app-tracker — pipeline counts plus the most recent activity. */
export async function appTracker(userId: string): Promise<AppTrackerSummary> {
  const listings = await jobSearch(userId);
  const byStatus: Record<JobStatus, number> = {
    interested: 0,
    applied: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    archived: 0,
  };
  for (const l of listings) {
    byStatus[l.status as JobStatus] = (byStatus[l.status as JobStatus] ?? 0) + 1;
  }
  return { total: listings.length, byStatus, recent: listings.slice(0, 8) };
}

export interface GithubRepo {
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

// ── Live job-board search (JSearch via RapidAPI + Firecrawl) ─────────────────
// Both are read-only signal sources for Athena's job-search tool — they never
// submit anything. Tracking a discovered posting (addJobListing, source
// "job-scout") is Athena's own domain write, not an apply_to_job action; the
// approval queue only gates SCOPE_BLOCKED actions like applying or messaging.

export interface JobBoardListing {
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string | null;
  postedAt: string | null;
  source: "jsearch";
}

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_apply_link: string | null;
  job_description: string | null;
  job_city: string | null;
  job_state: string | null;
  job_country: string | null;
  job_posted_at_datetime_utc: string | null;
}

/**
 * job-search (live) — queries JSearch (RapidAPI) for current postings matching
 * a free-text query, optionally narrowed by location. Free tier: 200 req/month,
 * so callers should keep query counts low and cache/track results rather than
 * re-querying the same terms repeatedly.
 */
export async function searchJobBoards(query: string, location?: string, max = 10): Promise<JobBoardListing[]> {
  const key = process.env.JSEARCH_API_KEY;
  if (!key) throw new Error("JSEARCH_API_KEY is not set — live job-board search is disabled.");

  const params = new URLSearchParams({
    query: location ? `${query} in ${location}` : query,
    page: "1",
    num_pages: "1",
  });
  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    },
  });
  if (!res.ok) throw new Error(`JSearch ${res.status}`);

  const data = (await res.json()) as { data?: JSearchJob[] };
  return (data.data ?? []).slice(0, max).map((job) => ({
    externalId: job.job_id,
    title: job.job_title,
    company: job.employer_name,
    location: [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") || null,
    url: job.job_apply_link ?? "",
    description: job.job_description,
    postedAt: job.job_posted_at_datetime_utc,
    source: "jsearch" as const,
  }));
}

/**
 * Enriches a thin posting URL into full page text via Firecrawl's scrape API —
 * useful when JSearch's description is truncated and fit-score needs the real
 * job description to produce a meaningful score. Returns null on any failure
 * (enrichment is a nice-to-have, never a blocker for tracking a posting).
 */
export async function scrapeJobPosting(url: string): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key || !url) return null;

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
    return data.data?.markdown?.slice(0, 6000) ?? null;
  } catch {
    return null;
  }
}

/**
 * github-scout — searches public GitHub repos for a keyword. Uses the
 * unauthenticated public search API (PUBLIC data class, fine for cloud).
 * Returns nothing but read-only signal — Athena never forks, stars, or writes.
 */
export async function githubScout(query: string, max = 8): Promise<GithubRepo[]> {
  const params = new URLSearchParams({
    q: query,
    sort: "updated",
    order: "desc",
    per_page: String(max),
  });
  const res = await fetch(`https://api.github.com/search/repositories?${params}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "hermes-os-athena" },
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
