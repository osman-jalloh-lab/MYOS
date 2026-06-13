// Job Application Tracker — closed-loop detection, logging, and verification.
// Separate from JobListing (Athena's interest list) and JobLead (job-scout pipeline).
// This is the source of truth for applications Osman has actually submitted.
//
// Data class: PERSONAL — cloud LLM calls are safe, no raw PII (SSNs, passwords).
// NEVER submits applications or sends emails. Read + write to own DB only.
import crypto from "crypto";
import { prisma } from "./db";
import { callModel } from "./modelRouter";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppStatus =
  | "Applied"
  | "Needs Reply"
  | "Interview"
  | "Waiting"
  | "Rejected"
  | "Offer"
  | "Unknown";

export type AppSource =
  | "Gmail"
  | "Manual Entry"
  | "Handshake"
  | "Indeed"
  | "LinkedIn"
  | "Company Website"
  | "Other";

export type JobEmailType =
  | "Application Confirmation"
  | "Job Lead"
  | "Needs Reply"
  | "Interview Request"
  | "Rejection"
  | "General Job Email";

export interface TrackedAppInput {
  companyName: string;
  jobTitle: string;
  applicationDate?: Date;
  source?: AppSource;
  status?: AppStatus;
  contactName?: string;
  contactEmail?: string;
  emailSubject?: string;
  jobUrl?: string;
  location?: string;
  notes?: string;
  nextFollowUpDate?: Date;
  gmailMessageId?: string;
}

export interface TrackedApp {
  id: string;
  userId: string;
  fingerprint: string;
  companyName: string;
  jobTitle: string;
  applicationDate: string;
  source: string;
  status: string;
  contactName: string | null;
  contactEmail: string | null;
  emailSubject: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  nextFollowUpDate: string | null;
  lastUpdatedAt: string;
  createdAt: string;
}

export interface BackfillResult {
  totalEmailsScanned: number;
  jobEmailsFound: number;
  newApplicationsLogged: number;
  existingRecordsUpdated: number;
  needsUserReview: string[];
  errors: string[];
}

// ── Normalizers ───────────────────────────────────────────────────────────────

export function normalizeStatus(raw: string): AppStatus {
  const s = raw.toLowerCase().trim();
  if (/needs.?reply|need to reply|reply needed|respond|follow.?up needed/.test(s)) return "Needs Reply";
  if (/interview|phone screen|video call|onsite|on.?site|assessment/.test(s)) return "Interview";
  if (/waiting|in review|under review|being considered/.test(s)) return "Waiting";
  if (/rejected|rejection|not selected|not moving forward|decided not|unfortunately/.test(s)) return "Rejected";
  if (/offer|accepted|hired/.test(s)) return "Offer";
  if (/applied|submitted|sent|application/.test(s)) return "Applied";
  return "Unknown";
}

export function normalizeSource(raw: string): AppSource {
  const s = raw.toLowerCase().trim();
  if (/linkedin/.test(s)) return "LinkedIn";
  if (/indeed/.test(s)) return "Indeed";
  if (/handshake/.test(s)) return "Handshake";
  if (/gmail|email|e-mail|mail/.test(s)) return "Gmail";
  if (/company.*site|company.*website|careers|direct/.test(s)) return "Company Website";
  if (/manual|myself|directly/.test(s)) return "Manual Entry";
  if (!raw) return "Manual Entry";
  return "Other";
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function fingerprintApp(companyName: string, jobTitle: string): string {
  const raw = `${companyName.toLowerCase().trim()}|${jobTitle.toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Row → View ────────────────────────────────────────────────────────────────

function toView(row: {
  id: string;
  userId: string;
  fingerprint: string;
  companyName: string;
  jobTitle: string;
  applicationDate: Date;
  source: string;
  status: string;
  contactName: string | null;
  contactEmail: string | null;
  emailSubject: string | null;
  jobUrl: string | null;
  location: string | null;
  notes: string | null;
  nextFollowUpDate: Date | null;
  lastUpdatedAt: Date;
  createdAt: Date;
}): TrackedApp {
  return {
    id: row.id,
    userId: row.userId,
    fingerprint: row.fingerprint,
    companyName: row.companyName,
    jobTitle: row.jobTitle,
    applicationDate: row.applicationDate.toISOString(),
    source: row.source,
    status: row.status,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    emailSubject: row.emailSubject,
    jobUrl: row.jobUrl,
    location: row.location,
    notes: row.notes,
    nextFollowUpDate: row.nextFollowUpDate?.toISOString() ?? null,
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Core write: upsert + verify ───────────────────────────────────────────────

/**
 * Upsert a tracked application. If fingerprint exists, update fields that
 * have changed (status escalates, notes append). Returns { app, isNew, verified }.
 * "verified" is a post-write read-back — if false, return error to caller.
 */
export async function upsertApplication(
  userId: string,
  input: TrackedAppInput
): Promise<{ app: TrackedApp; isNew: boolean; verified: boolean }> {
  if (!input.companyName || !input.jobTitle) {
    throw new Error("companyName and jobTitle are required");
  }

  const fingerprint = fingerprintApp(input.companyName, input.jobTitle);
  const existing = await prisma.trackedApplication.findFirst({
    where: { userId, fingerprint },
  });

  let row;
  const isNew = !existing;

  if (existing) {
    // Status escalation: only upgrade to a more actionable status, never silently downgrade.
    const STATUS_RANK: Record<AppStatus, number> = {
      Unknown: 0, Applied: 1, Waiting: 2, "Needs Reply": 3, Interview: 4, Rejected: 5, Offer: 6,
    };
    const newStatusRank = STATUS_RANK[input.status ?? "Unknown"] ?? 0;
    const existingRank = STATUS_RANK[existing.status as AppStatus] ?? 0;
    const resolvedStatus = newStatusRank > existingRank ? input.status : existing.status;

    // Notes append (not overwrite) so history is preserved.
    const appendedNotes =
      input.notes && input.notes !== existing.notes
        ? existing.notes
          ? `${existing.notes}\n${input.notes}`
          : input.notes
        : existing.notes;

    row = await prisma.trackedApplication.update({
      where: { id: existing.id },
      data: {
        status: resolvedStatus as string,
        contactName: input.contactName ?? existing.contactName,
        contactEmail: input.contactEmail ?? existing.contactEmail,
        emailSubject: input.emailSubject ?? existing.emailSubject,
        jobUrl: input.jobUrl ?? existing.jobUrl,
        location: input.location ?? existing.location,
        notes: appendedNotes,
        nextFollowUpDate: input.nextFollowUpDate ?? existing.nextFollowUpDate,
        source: input.source && input.source !== "Other" ? input.source : existing.source,
        gmailMessageId: input.gmailMessageId ?? existing.gmailMessageId,
      },
    });
  } else {
    row = await prisma.trackedApplication.create({
      data: {
        userId,
        fingerprint,
        companyName: input.companyName,
        jobTitle: input.jobTitle,
        applicationDate: input.applicationDate ?? new Date(),
        source: input.source ?? "Other",
        status: input.status ?? "Unknown",
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        emailSubject: input.emailSubject ?? null,
        jobUrl: input.jobUrl ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        nextFollowUpDate: input.nextFollowUpDate ?? null,
        gmailMessageId: input.gmailMessageId ?? null,
      },
    });
  }

  // Verification read-back — confirms write landed.
  const verified = !!(await prisma.trackedApplication.findFirst({
    where: { id: row.id, userId },
    select: { id: true },
  }));

  return { app: toView(row), isNew, verified };
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listApplications(
  userId: string,
  options?: { status?: AppStatus; limit?: number }
): Promise<TrackedApp[]> {
  const rows = await prisma.trackedApplication.findMany({
    where: {
      userId,
      ...(options?.status ? { status: options.status } : {}),
    },
    orderBy: { lastUpdatedAt: "desc" },
    take: options?.limit ?? 50,
  });
  return rows.map(toView);
}

export async function getApplication(userId: string, id: string): Promise<TrackedApp | null> {
  const row = await prisma.trackedApplication.findFirst({ where: { id, userId } });
  return row ? toView(row) : null;
}

export async function applicationSummary(userId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  urgent: TrackedApp[];
  recent: TrackedApp[];
}> {
  const rows = await prisma.trackedApplication.findMany({
    where: { userId },
    orderBy: { lastUpdatedAt: "desc" },
  });
  const views = rows.map(toView);
  const byStatus: Record<string, number> = {};
  for (const r of views) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const urgent = views.filter((r) => r.status === "Needs Reply" || r.status === "Interview").slice(0, 5);
  return { total: views.length, byStatus, urgent, recent: views.slice(0, 8) };
}

// ── Status update ─────────────────────────────────────────────────────────────

export async function updateApplicationStatus(
  userId: string,
  id: string,
  status: AppStatus,
  notes?: string
): Promise<{ app: TrackedApp; verified: boolean }> {
  const row = await prisma.trackedApplication.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Application not found");

  const appendedNotes =
    notes && notes !== row.notes
      ? row.notes ? `${row.notes}\n${notes}` : notes
      : row.notes;

  const updated = await prisma.trackedApplication.update({
    where: { id },
    data: { status, notes: appendedNotes },
  });

  const verified = !!(await prisma.trackedApplication.findFirst({
    where: { id, userId, status },
    select: { id: true },
  }));

  return { app: toView(updated), verified };
}

// ── Email classification (no LLM — fast heuristic) ────────────────────────────

export function classifyJobEmail(subject: string, snippet: string, body?: string): JobEmailType {
  const text = `${subject} ${snippet} ${body ?? ""}`.toLowerCase();

  if (/interview|schedule.*call|schedule.*time|available.*time|availability|phone screen|video interview|onsite interview|technical screen/.test(text)) return "Interview Request";
  if (/still interested|are you still interested|checking in on your interest|follow.?ing up on your application|still open to/.test(text)) return "Needs Reply";
  if (/unfortunately|not moving forward|not selected|not the right fit|we.*decided|chosen another candidate|other candidates|not be moving|not be proceeding|regret to inform|position has been filled/.test(text)) return "Rejection";
  if (/thank you for applying|application received|we received your application|we have received|your application (has been|was) (received|submitted)|we confirm|confirming your application/.test(text)) return "Application Confirmation";
  if (/recruiter|hiring (team|manager)|next steps|opportunity|position|open role|I am reaching out/.test(text)) return "Job Lead";
  return "General Job Email";
}

/** Priority level inferred from email type */
export function emailPriority(type: JobEmailType): "high" | "medium" | "low" {
  if (type === "Interview Request" || type === "Needs Reply") return "high";
  if (type === "Application Confirmation" || type === "Rejection") return "medium";
  return "low";
}

/** Map email type → tracker status */
function emailTypeToStatus(type: JobEmailType, existing?: string): AppStatus {
  switch (type) {
    case "Interview Request": return "Interview";
    case "Needs Reply": return "Needs Reply";
    case "Rejection": return "Rejected";
    case "Application Confirmation": return "Applied";
    case "Job Lead": return (existing as AppStatus) ?? "Applied";
    default: return (existing as AppStatus) ?? "Applied";
  }
}

// ── LLM extraction from email ─────────────────────────────────────────────────

export interface ExtractedApp {
  companyName: string;
  jobTitle: string;
  contactName?: string;
  contactEmail?: string;
  status: AppStatus;
  source: AppSource;
  jobUrl?: string;
  location?: string;
  notes?: string;
}

export async function extractAppFromEmail(
  userId: string,
  subject: string,
  from: string,
  snippet: string,
  body?: string
): Promise<ExtractedApp | null> {
  const emailType = classifyJobEmail(subject, snippet, body);

  const { text } = await callModel({
    userId,
    taskType: "job-tracker",
    dataClass: "PERSONAL",
    systemPrompt: `You extract job application data from emails. Return ONLY a JSON object with these fields (omit any field you cannot find):
{
  "companyName": "string — company/employer name",
  "jobTitle": "string — job title or role",
  "contactName": "string — recruiter or sender name",
  "contactEmail": "string — recruiter email",
  "jobUrl": "string — job posting URL if present",
  "location": "string — job location"
}
If you cannot identify a company or job title, return null.
Never include SSNs, passwords, or sensitive PII.`,
    userPrompt: `Email from: ${from}
Subject: ${subject}
Snippet: ${snippet}
${body ? `Body (first 2000 chars):\n${body.slice(0, 2000)}` : ""}`,
  });

  try {
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<ExtractedApp>;
    if (!parsed.companyName || !parsed.jobTitle) return null;

    const sourceFromEmail = from.toLowerCase();
    const inferredSource: AppSource = sourceFromEmail.includes("linkedin")
      ? "LinkedIn"
      : sourceFromEmail.includes("indeed")
      ? "Indeed"
      : sourceFromEmail.includes("handshake")
      ? "Handshake"
      : "Gmail";

    return {
      companyName: parsed.companyName,
      jobTitle: parsed.jobTitle,
      contactName: parsed.contactName,
      contactEmail: parsed.contactEmail,
      jobUrl: parsed.jobUrl,
      location: parsed.location,
      status: emailTypeToStatus(emailType),
      source: inferredSource,
      notes: emailType !== "Application Confirmation" ? `Detected: ${emailType}` : undefined,
    };
  } catch {
    return null;
  }
}

// ── Manual entry parser (structured field format) ─────────────────────────────

/**
 * Parses manual "Log this job application" commands.
 * Handles:
 *   Company: Fairville Construction
 *   Role: IT Support Intern
 *   Source: Email
 *   Contact: Anna
 *   Status: Needs Reply
 *   Notes: Asked if I am still interested.
 */
export function parseManualEntry(text: string): Partial<TrackedAppInput> {
  const field = (names: string[]): string => {
    for (const name of names) {
      const m = text.match(new RegExp(`(?:^|\\n)${name}[:\\s]+(.+?)(?=\\n[A-Z]|$)`, "im"));
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return "";
  };

  const rawStatus = field(["status"]);
  const rawSource = field(["source", "found via", "via", "platform"]);
  const rawFollowUp = field(["next follow.?up", "follow.?up date", "follow up"]);

  let nextFollowUpDate: Date | undefined;
  if (rawFollowUp) {
    const d = new Date(rawFollowUp);
    if (!isNaN(d.getTime())) nextFollowUpDate = d;
  }

  return {
    companyName: field(["company", "employer", "organization", "firm"]),
    jobTitle: field(["role", "title", "position", "job title", "job"]),
    contactName: field(["contact", "recruiter", "hiring manager", "hr"]),
    contactEmail: field(["contact email", "recruiter email", "email"]),
    source: rawSource ? normalizeSource(rawSource) : "Manual Entry",
    status: rawStatus ? normalizeStatus(rawStatus) : "Applied",
    notes: field(["notes", "note", "context"]),
    jobUrl: field(["url", "link", "job url", "job link"]),
    location: field(["location", "city"]),
    nextFollowUpDate,
  };
}

// ── Follow-up task creation ───────────────────────────────────────────────────

export async function createFollowUpTask(
  userId: string,
  app: TrackedApp,
  emailType: JobEmailType = "Application Confirmation"
): Promise<void> {
  const daysOut = emailType === "Interview Request" ? 1 : emailType === "Needs Reply" ? 0 : 7;
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + daysOut);

  const titleMap: Record<JobEmailType, string> = {
    "Interview Request": `Prepare for interview — ${app.jobTitle} at ${app.companyName}`,
    "Needs Reply": `Reply to ${app.companyName} re: ${app.jobTitle}`,
    "Application Confirmation": `Follow up with ${app.companyName} — ${app.jobTitle}`,
    "Rejection": `Note rejection — ${app.jobTitle} at ${app.companyName}`,
    "Job Lead": `Research ${app.companyName} — ${app.jobTitle}`,
    "General Job Email": `Check status — ${app.jobTitle} at ${app.companyName}`,
  };

  await prisma.task.create({
    data: {
      userId,
      title: titleMap[emailType] ?? `Follow up — ${app.jobTitle} at ${app.companyName}`,
      source: "app-tracker",
      sourceRef: app.id,
      dueAt,
      status: "open",
      priority: emailPriority(emailType) === "high" ? "high" : "medium",
      assignedAgent: "athena",
    },
  });
}

// ── Gmail detection phrases ───────────────────────────────────────────────────

// Broad enough to catch most job-related emails. Client-side classification
// filters down to actionable ones. Kept as a constant for easy update.
export const JOB_EMAIL_PHRASES = [
  "thank you for applying",
  "application received",
  "your application",
  "we received your application",
  "still interested",
  "are you still interested",
  "next steps",
  "interview",
  "availability",
  "recruiter",
  "hiring team",
  "position",
  "opportunity",
];

// ── Backfill (90-day Gmail sweep) ─────────────────────────────────────────────

export async function backfillFromGmail(userId: string): Promise<BackfillResult> {
  const { fetchApplicationEmails } = await import("./gmail");

  const result: BackfillResult = {
    totalEmailsScanned: 0,
    jobEmailsFound: 0,
    newApplicationsLogged: 0,
    existingRecordsUpdated: 0,
    needsUserReview: [],
    errors: [],
  };

  let emails: Awaited<ReturnType<typeof fetchApplicationEmails>> = [];
  try {
    emails = await fetchApplicationEmails(userId, 90);
  } catch (err) {
    result.errors.push(`Gmail fetch failed: ${String(err)}`);
    return result;
  }

  result.totalEmailsScanned = emails.length;

  for (const email of emails) {
    const emailType = classifyJobEmail(email.subject, email.snippet, email.body);
    if (emailType === "General Job Email") continue; // skip noise
    result.jobEmailsFound++;

    let extracted: ExtractedApp | null = null;
    try {
      extracted = await extractAppFromEmail(userId, email.subject, email.from, email.snippet, email.body);
    } catch (err) {
      result.errors.push(`Extraction failed for "${email.subject}": ${String(err)}`);
      continue;
    }

    if (!extracted) {
      result.needsUserReview.push(`${email.subject} — from ${email.from} (could not extract company/title)`);
      continue;
    }

    try {
      const { isNew } = await upsertApplication(userId, {
        ...extracted,
        emailSubject: email.subject,
        applicationDate: new Date(email.receivedAt),
        gmailMessageId: email.id,
        notes: extracted.notes
          ? `${extracted.notes} | Email: ${email.subject.slice(0, 80)}`
          : `Email: ${email.subject.slice(0, 80)}`,
      });

      // Create follow-up task for urgent email types
      if (emailType === "Interview Request" || emailType === "Needs Reply") {
        const app = (await prisma.trackedApplication.findFirst({
          where: { userId, fingerprint: fingerprintApp(extracted.companyName, extracted.jobTitle) },
        }))!;
        await createFollowUpTask(userId, toView(app), emailType).catch(() => {});
      }

      if (isNew) result.newApplicationsLogged++;
      else result.existingRecordsUpdated++;
    } catch (err) {
      result.errors.push(`Upsert failed for ${extracted.companyName}/${extracted.jobTitle}: ${String(err)}`);
    }
  }

  // Log the run for the audit trail
  await prisma.agentRun.create({
    data: {
      agentName: "athena",
      inputSummary: `app-tracker backfill: ${result.totalEmailsScanned} emails → ${result.jobEmailsFound} job emails → ${result.newApplicationsLogged} new, ${result.existingRecordsUpdated} updated`,
      outputSummary: `${result.newApplicationsLogged} new applications logged. ${result.needsUserReview.length} need review.${result.errors.length > 0 ? ` ${result.errors.length} errors.` : ""}`,
      status: result.errors.length > 0 ? "partial" : "completed",
    },
  });

  return result;
}

// ── Daily sweep (last 2 days, used by cron) ───────────────────────────────────

export interface SweepResult {
  emailsScanned: number;
  newLogged: number;
  updated: number;
  urgent: Array<{ company: string; role: string; status: string; emailType: string }>;
  errors: string[];
}

export async function sweepGmailApplications(userId: string): Promise<SweepResult> {
  const { fetchApplicationEmails } = await import("./gmail");

  const result: SweepResult = {
    emailsScanned: 0,
    newLogged: 0,
    updated: 0,
    urgent: [],
    errors: [],
  };

  let emails: Awaited<ReturnType<typeof fetchApplicationEmails>> = [];
  try {
    emails = await fetchApplicationEmails(userId, 2); // last 2 days
  } catch (err) {
    result.errors.push(`Gmail fetch: ${String(err)}`);
    return result;
  }

  result.emailsScanned = emails.length;

  for (const email of emails) {
    const emailType = classifyJobEmail(email.subject, email.snippet, email.body);
    if (emailType === "General Job Email") continue;

    let extracted: ExtractedApp | null = null;
    try {
      extracted = await extractAppFromEmail(userId, email.subject, email.from, email.snippet, email.body);
    } catch {
      continue;
    }

    if (!extracted) continue;

    try {
      const { app, isNew } = await upsertApplication(userId, {
        ...extracted,
        emailSubject: email.subject,
        applicationDate: new Date(email.receivedAt),
        gmailMessageId: email.id,
        notes: extracted.notes
          ? `${extracted.notes} | Email: ${email.subject.slice(0, 80)}`
          : `Email: ${email.subject.slice(0, 80)}`,
      });

      if (isNew) result.newLogged++;
      else result.updated++;

      if (emailType === "Interview Request" || emailType === "Needs Reply") {
        result.urgent.push({
          company: app.companyName,
          role: app.jobTitle,
          status: app.status,
          emailType,
        });
        await createFollowUpTask(userId, app, emailType).catch(() => {});
      }
    } catch (err) {
      result.errors.push(`${extracted.companyName}: ${String(err)}`);
    }
  }

  return result;
}
