// Job Scout pipeline — Athena's daily Gmail alert processor.
// Flow: fetch alert emails → parse jobs → dedupe → score → kit → draft queue → digest.
// HARD CONSTRAINT: never auto-sends any email. Every outbound action goes through
// the ApprovalAction queue (same gate as every other write in Hermes OS).
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { callModel } from "@/lib/modelRouter";
import { scrapeJobPosting } from "@/lib/jobs";
import { fetchJobAlertMessages } from "@/lib/gmail";
import { resumeTailor, coverLetter as draftCoverLetter } from "@/agents/athena";

// Minimum fit score (0-100) to trigger ApplicationKit build
const MIN_SCORE_FOR_KIT = 65;

// ATS keyword match score considered "high quality" (queue a draft)
const ATS_THRESHOLD = 75;

// Max emails to scan per run (cost control)
const MAX_EMAILS_PER_RUN = 20;

// Max job leads to extract per email
const MAX_LEADS_PER_EMAIL = 5;

// Common words that pollute ATS keyword matching
const STOP_WORDS = new Set([
  "and", "the", "for", "with", "this", "that", "have", "will", "from",
  "your", "you", "our", "their", "they", "what", "about", "which",
  "work", "team", "company", "role", "position", "experience",
  "required", "preferred", "ability", "skills", "knowledge", "strong",
  "excellent", "great", "good", "using", "including", "such", "other",
]);

export interface ParsedJob {
  company: string;
  title: string;
  location?: string;
  url?: string;
}

export interface PipelineResult {
  emailsScanned: number;
  leadsFound: number;
  leadsScored: number;
  kitsBuilt: number;
  draftsQueued: number;
  errors: string[];
  topLeads: Array<{ title: string; company: string; fitScore: number; url?: string }>;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function fingerprintLead(company: string, title: string, url?: string): string {
  const raw = `${company.toLowerCase().trim()}:${title.toLowerCase().trim()}:${(url ?? "").trim()}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Email → Jobs (LLM parse) ──────────────────────────────────────────────────

async function parseJobsFromEmail(
  userId: string,
  subject: string,
  body: string
): Promise<ParsedJob[]> {
  const { text } = await callModel({
    userId,
    taskType: "job-scout",
    dataClass: "PERSONAL",
    systemPrompt: `You parse job alert emails and extract individual job listings.
Return a JSON array only: [{"company":"","title":"","location":"","url":""}]
Extract at most ${MAX_LEADS_PER_EMAIL} jobs. Return [] if no jobs found.
Never include "location" or "url" keys with null — omit them instead.`,
    userPrompt: `Subject: ${subject}\n\n${body.slice(0, 3000)}`,
  });

  try {
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as ParsedJob[];
    return parsed.filter((j) => j.company && j.title);
  } catch {
    return [];
  }
}

// ── Fit scoring ───────────────────────────────────────────────────────────────

async function scoreJobLead(
  userId: string,
  lead: ParsedJob
): Promise<{ score: number; reason: string }> {
  const { text } = await callModel({
    userId,
    taskType: "job-scout",
    dataClass: "PERSONAL",
    systemPrompt: `You are Athena, a career-fit analyst. Be honest, not flattering.
Candidate: Osman Jalloh — Security+ (SY0-701), CySA+ (CS0-003), HR I-9/E-Verify compliance auditor at ACC, CS Student Associate at UT System OCIO. Targeting GRC consulting, not yet mid-level.`,
    userPrompt: `Score fit 0-100. Reply with exactly: "Score: <number>\n<1-2 sentences of plain reasoning>"
Role: ${lead.title} at ${lead.company}${lead.location ? ` in ${lead.location}` : ""}`,
  });

  const match = text.match(/(?:score)[:\s]*([0-9]{1,3})/i);
  const score = match ? Math.max(0, Math.min(100, parseInt(match[1], 10))) : 50;
  return { score, reason: text.trim() };
}

// ── ATS scorer (deterministic keyword match) ──────────────────────────────────

function scoreATS(
  jdText: string,
  resumeText: string
): { score: number; missing: string[] } {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9#+\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const jdTokens = tokenize(jdText);
  const resumeSet = new Set(tokenize(resumeText));

  // Dedupe JD keywords, keep only those that appear 2+ times (important terms)
  const freq = new Map<string, number>();
  for (const t of jdTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const keywords = [...freq.entries()]
    .filter(([, count]) => count >= 2)
    .map(([w]) => w);

  if (keywords.length === 0) {
    // Fall back: all unique JD tokens
    const all = [...new Set(jdTokens)];
    const matched = all.filter((k) => resumeSet.has(k));
    return {
      score: all.length > 0 ? Math.round((matched.length / all.length) * 100) : 0,
      missing: all.filter((k) => !resumeSet.has(k)).slice(0, 8),
    };
  }

  const matched = keywords.filter((k) => resumeSet.has(k));
  const score = Math.round((matched.length / keywords.length) * 100);
  const missing = keywords.filter((k) => !resumeSet.has(k)).slice(0, 8);
  return { score, missing };
}

// ── Hunter.io recruiter email lookup ─────────────────────────────────────────
// Free tier: 25 searches/month. Skipped silently when key is absent or quota hit.

async function findRecruiterEmail(company: string, url?: string): Promise<string | null> {
  const key = process.env.HUNTER_IO_API_KEY;
  if (!key) return null;

  // Best-effort domain extraction from the job URL
  let domain = "";
  if (url) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }
  }
  // Fall back to guessing company.com — low accuracy but free
  if (!domain || domain.includes("linkedin") || domain.includes("indeed") || domain.includes("ziprecruiter")) {
    domain = `${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
  }
  if (!domain) return null;

  try {
    const params = new URLSearchParams({ domain, api_key: key, limit: "1", type: "personal" });
    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { emails?: { value?: string }[] } };
    return data.data?.emails?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

// ── Kit builder ───────────────────────────────────────────────────────────────

async function buildKit(
  userId: string,
  jobLeadId: string,
  lead: ParsedJob,
  jdText: string
): Promise<{ atsScore: number; atsFeedback: string; draftsQueued: number }> {
  const [bullets, coverLetterText] = await Promise.all([
    resumeTailor(userId, { jobTitle: lead.title, jobDescription: jdText }),
    draftCoverLetter(userId, { jobTitle: lead.title, company: lead.company, jobDescription: jdText }),
  ]);

  const { score: atsScore, missing } = scoreATS(jdText, bullets);
  const atsFeedback = missing.length > 0 ? `Missing keywords: ${missing.join(", ")}` : "Good keyword coverage.";

  const recruiterEmail = await findRecruiterEmail(lead.company, lead.url);

  let draftsQueued = 0;
  let kitStatus: "ready" | "draft_queued" = "ready";

  if (atsScore >= ATS_THRESHOLD && recruiterEmail) {
    // Queue a Gmail draft approval — never auto-sends
    const { createApproval } = await import("@/lib/approvals");
    const subject = `Application — ${lead.title} at ${lead.company}`;
    const body = `${coverLetterText}\n\n---\nApplication materials generated by Hermes OS / Athena.\nThis draft was queued for your review — it has NOT been sent.`;
    await createApproval(userId, "draft_email", {
      to: recruiterEmail,
      subject,
      body,
      jobLeadId,
    });
    draftsQueued = 1;
    kitStatus = "draft_queued";
  }

  await prisma.applicationKit.create({
    data: {
      jobLeadId,
      resumeBullets: bullets,
      coverLetter: coverLetterText,
      recruiterEmail,
      atsScore,
      atsFeedback,
      status: kitStatus,
    },
  });

  return { atsScore, atsFeedback, draftsQueued };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runJobScoutPipeline(userId: string): Promise<PipelineResult> {
  const errors: string[] = [];
  let leadsFound = 0;
  let leadsScored = 0;
  let kitsBuilt = 0;
  let totalDraftsQueued = 0;
  const topLeads: PipelineResult["topLeads"] = [];

  // Fetch job alert emails
  let emails: Awaited<ReturnType<typeof fetchJobAlertMessages>> = [];
  try {
    emails = await fetchJobAlertMessages(userId, MAX_EMAILS_PER_RUN);
  } catch (err) {
    errors.push(`Gmail fetch failed: ${String(err)}`);
  }

  for (const email of emails.slice(0, MAX_EMAILS_PER_RUN)) {
    let jobs: ParsedJob[] = [];
    try {
      jobs = await parseJobsFromEmail(userId, email.subject, email.body);
    } catch (err) {
      errors.push(`Email parse failed (${email.id}): ${String(err)}`);
      continue;
    }

    for (const job of jobs) {
      const fingerprint = fingerprintLead(job.company, job.title, job.url);

      // Skip already-seen leads
      const exists = await prisma.jobLead.findFirst({ where: { userId, fingerprint } });
      if (exists) continue;

      leadsFound++;

      // Persist the lead
      let lead;
      try {
        lead = await prisma.jobLead.create({
          data: {
            userId,
            fingerprint,
            company: job.company,
            title: job.title,
            location: job.location,
            url: job.url,
            rawSnippet: email.snippet.slice(0, 500),
            source: "gmail-alert",
          },
        });
      } catch (err) {
        errors.push(`Lead create failed (${job.company}/${job.title}): ${String(err)}`);
        continue;
      }

      // Score the lead
      let fitScore = 50;
      let fitReason = "";
      try {
        const scored = await scoreJobLead(userId, job);
        fitScore = scored.score;
        fitReason = scored.reason;
        leadsScored++;
      } catch (err) {
        errors.push(`Score failed (${lead.id}): ${String(err)}`);
      }

      // Fetch full JD if score is above threshold
      let jdText = "";
      if (fitScore >= MIN_SCORE_FOR_KIT && job.url) {
        jdText = (await scrapeJobPosting(job.url)) ?? "";
      }

      await prisma.jobLead.update({
        where: { id: lead.id },
        data: {
          fitScore,
          fitReason,
          jdText: jdText || undefined,
          status: fitScore >= MIN_SCORE_FOR_KIT ? "scored" : "archived",
        },
      });

      if (fitScore >= MIN_SCORE_FOR_KIT) {
        topLeads.push({ title: job.title, company: job.company, fitScore, url: job.url });

        const jdForKit = jdText || `${job.title} at ${job.company}${job.location ? ` in ${job.location}` : ""}`;
        try {
          const { draftsQueued } = await buildKit(userId, lead.id, job, jdForKit);
          kitsBuilt++;
          totalDraftsQueued += draftsQueued;
          await prisma.jobLead.update({ where: { id: lead.id }, data: { status: "kit_ready" } });
        } catch (err) {
          errors.push(`Kit build failed (${lead.id}): ${String(err)}`);
        }
      }
    }
  }

  // Persist run record
  await prisma.jobScoutRun.create({
    data: {
      emailsScanned: emails.length,
      leadsFound,
      leadsScored,
      kitsBuilt,
      draftsQueued: totalDraftsQueued,
      digestSent: false,
      errors: errors.length > 0 ? JSON.stringify(errors) : undefined,
    },
  });

  // Also log to AgentRun for the existing audit trail
  await prisma.agentRun.create({
    data: {
      agentName: "athena",
      inputSummary: `job-scout-gmail: ${emails.length} alerts → ${leadsFound} new leads → ${leadsScored} scored → ${kitsBuilt} kits → ${totalDraftsQueued} drafts queued`,
      outputSummary: topLeads
        .sort((a, b) => b.fitScore - a.fitScore)
        .slice(0, 5)
        .map((l) => `${l.title} @ ${l.company}: ${l.fitScore}`)
        .join(" · ")
        .slice(0, 2000),
      status: errors.length > 0 ? "partial" : "completed",
    },
  });

  return {
    emailsScanned: emails.length,
    leadsFound,
    leadsScored,
    kitsBuilt,
    draftsQueued: totalDraftsQueued,
    errors,
    topLeads: topLeads.sort((a, b) => b.fitScore - a.fitScore),
  };
}
