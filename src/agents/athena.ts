// Athena — career & jobs
// Owns ONLY these tools (this is what enforces no-overlap): "job-search","fit-score","skill-gap","github-scout","resume-tailor","ats-optimize","cover-letter","app-tracker"
// CAN: find/rank roles, tailor resumes (no em dashes, his rules), draft letters
// CANNOT: apply or message recruiters without approval — that always lands as
// an "apply_to_job" ApprovalAction (see SCOPE_BLOCKED in @/lib/approvals).

import { callModel } from "@/lib/modelRouter";
import {
  jobSearch,
  addJobListing,
  updateJobStatus,
  setFitScore,
  appTracker,
  githubScout as scoutRepos,
  type JobStatus,
  type JobListingInput,
  type AppTrackerSummary,
  type GithubRepo,
} from "@/lib/jobs";

export const athena = {
  name: "Athena",
  domain: "career & jobs",
  tools: [
    "job-search",
    "fit-score",
    "skill-gap",
    "github-scout",
    "resume-tailor",
    "ats-optimize",
    "cover-letter",
    "app-tracker",
  ] as const,
};

// Static profile facts Athena reasons from — keeps PRIVATE resume bodies out
// of prompts while still grounding fit/gap/tailor calls in real background.
// Mirrors context/about-osman.md "Who" section (PERSONAL data class — approved cloud OK).
const OSMAN_PROFILE = `Osman Jalloh — cybersecurity + HR compliance background.
Holds CompTIA Security+ (SY0-701) and CySA+ (CS0-003).
Current roles: Technical Support & Compliance Auditor, ACC Human Resources (I-9 / E-Verify / Workday);
CS Student Associate, UT System OCIO.
Heading toward a GRC (governance, risk, compliance) consulting career and a master's track.`;

const WRITING_RULES = `Writing rules (must follow exactly):
- No em dashes. Avoid "excited to apply", "great fit", "passionate about", "leverage", "utilize", "delve", "pivotal".
- Never mention CPT. Never mention Sierra Leone.
- Never title Osman above his actual level (Technical Support & Compliance Auditor / CS Student Associate).
- Keep resume content to one page worth of material; surface Security+ and CySA+ near the top.`;

// ── job-search ────────────────────────────────────────────────────────────────
// Pure DB read/write over the tracked-roles ledger — Osman (or an approved
// scout suggestion) logs postings here; Athena never calls a paid job-board API.

export async function jobSearchTool(userId: string, status?: JobStatus) {
  return jobSearch(userId, status);
}

export async function trackJob(userId: string, input: JobListingInput) {
  return addJobListing(userId, input);
}

// ── fit-score ─────────────────────────────────────────────────────────────────

export interface FitScoreResult {
  score: number;
  reasoning: string;
}

function parseScored(text: string): { score: number; body: string } {
  const match = text.match(/(?:score|fit)[:\s]*([0-9]{1,3})/i);
  const score = match ? Math.max(0, Math.min(100, parseInt(match[1], 10))) : 50;
  return { score, body: text.trim() };
}

/** Scores how well a job description matches Osman's real background (0-100). */
export async function fitScore(
  userId: string,
  params: { jobTitle: string; company: string; jobDescription: string; jobListingId?: string }
): Promise<FitScoreResult> {
  const { text } = await callModel({
    userId,
    taskType: "fit-score",
    dataClass: "PERSONAL",
    systemPrompt: `You are Athena, a career-fit analyst. Be honest and specific, not flattering. ${OSMAN_PROFILE}`,
    userPrompt: `Score this role's fit against the candidate's real background on a 0-100 scale.
Start your reply with "Score: <number>" then 2-3 sentences of plain reasoning (what matches, what's a stretch).

Role: ${params.jobTitle} at ${params.company}
Description: ${params.jobDescription.slice(0, 2000)}`,
  });

  const { score, body } = parseScored(text);
  if (params.jobListingId) {
    await setFitScore(userId, params.jobListingId, score);
  }
  return { score, reasoning: body };
}

// ── skill-gap ─────────────────────────────────────────────────────────────────

export interface SkillGapResult {
  missing: string[];
  notes: string;
}

/** Lists the skills/certs a role wants that aren't in Osman's current profile. */
export async function skillGap(
  userId: string,
  params: { jobTitle: string; jobDescription: string }
): Promise<SkillGapResult> {
  const { text } = await callModel({
    userId,
    taskType: "skill-gap",
    dataClass: "PERSONAL",
    systemPrompt: `You are Athena, a career analyst identifying real skill gaps. ${OSMAN_PROFILE}`,
    userPrompt: `List the skills, tools, or certifications this role wants that are NOT already covered
by the candidate's background (Security+, CySA+, GRC direction, HR compliance/I-9, IT support).
Reply as a short bullet list (max 6 items, one per line, no numbering), then one closing sentence of context.

Role: ${params.jobTitle}
Description: ${params.jobDescription.slice(0, 2000)}`,
  });

  const lines = text.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
  const missing = lines.filter((l) => l.length < 80).slice(0, 6);
  return { missing, notes: text.trim() };
}

// ── github-scout ──────────────────────────────────────────────────────────────
// Read-only public-repo search — surfaces relevant projects/communities for a
// search term. PUBLIC data, no auth, no writes (no stars/forks/follows).

export async function githubScout(query: string): Promise<GithubRepo[]> {
  return scoutRepos(query);
}

// ── resume-tailor ─────────────────────────────────────────────────────────────

/** Drafts resume bullet points tailored to a specific job description. */
export async function resumeTailor(
  userId: string,
  params: { jobTitle: string; jobDescription: string }
): Promise<string> {
  const { text } = await callModel({
    userId,
    taskType: "resume-tailor",
    dataClass: "PERSONAL",
    systemPrompt: `You are Athena, tailoring resume bullet points. ${OSMAN_PROFILE}\n\n${WRITING_RULES}`,
    userPrompt: `Draft 4-6 resume bullet points tailored to this role. Lead with Security+ / CySA+ and
compliance/audit experience where relevant. Use plain, concrete, metric-minded language.
Output only the bullet points, one per line, starting with "- ".

Target role: ${params.jobTitle}
Description: ${params.jobDescription.slice(0, 2000)}`,
  });
  return text.trim();
}

// ── ats-optimize ──────────────────────────────────────────────────────────────

/** Suggests keyword/phrasing adjustments to raise ATS match density. */
export async function atsOptimize(
  userId: string,
  params: { jobDescription: string; resumeDraft: string }
): Promise<string> {
  const { text } = await callModel({
    userId,
    taskType: "ats-optimize",
    dataClass: "PERSONAL",
    systemPrompt: `You are Athena, an ATS keyword-optimization reviewer. ${WRITING_RULES}`,
    userPrompt: `Compare the resume draft to the job description. List up to 6 ATS keywords/phrases from
the description that are missing or under-represented in the draft, and suggest where to naturally add
each one. Reply as a short bullet list, one suggestion per line.

Job description: ${params.jobDescription.slice(0, 1500)}

Resume draft:
${params.resumeDraft.slice(0, 1500)}`,
  });
  return text.trim();
}

// ── cover-letter ──────────────────────────────────────────────────────────────

/** Drafts a cover letter (hook-proof-honest-close, under 250 words). Returns text only — Athena never sends it. */
export async function coverLetter(
  userId: string,
  params: { jobTitle: string; company: string; jobDescription: string }
): Promise<string> {
  const { text } = await callModel({
    userId,
    taskType: "cover-letter",
    dataClass: "PERSONAL",
    systemPrompt: `You are Athena, drafting a cover letter. ${OSMAN_PROFILE}\n\n${WRITING_RULES}
Structure: hook (1-2 sentences on real relevant experience), proof (1-2 concrete examples), honest
(name one growth area or what excites the work itself, without flattery clichés), close (direct ask).
Hard limit: under 250 words. No greeting boilerplate beyond "Dear Hiring Team,". Sign as "Osman Jalloh".`,
    userPrompt: `Draft a cover letter for this role.

Role: ${params.jobTitle} at ${params.company}
Description: ${params.jobDescription.slice(0, 2000)}`,
  });
  return text.trim();
}

// ── app-tracker ───────────────────────────────────────────────────────────────

export async function appTrackerSummary(userId: string): Promise<AppTrackerSummary> {
  return appTracker(userId);
}

export async function moveJob(userId: string, id: string, status: JobStatus) {
  return updateJobStatus(userId, id, status);
}
