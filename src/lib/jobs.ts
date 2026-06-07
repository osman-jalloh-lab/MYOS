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
