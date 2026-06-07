// Sophos — skills & capability scout (added 2026-06-07, Phase 8)
// Owns ONLY these tools (this is what enforces no-overlap): "release-watch","repo-scout","video-digest","skill-brief"
// CAN: watch Claude/Anthropic release notes, scout GitHub for capability/tooling
//      repos, surface relevant YouTube videos, and synthesize it all into a digest
// CANNOT: install, configure, apply, or propose any write — pure L0 read-only
//      watcher (the same autonomy tier as Argus). A digest is the entire output.

import { prisma } from "@/lib/db";
import { callModel } from "@/lib/modelRouter";
import { fetchReleaseNotes, repoScout, videoDigest, type ScoutedRepo, type ScoutedVideo } from "@/lib/sophos";

export const sophos = {
  name: "Sophos",
  domain: "skills & capability scouting",
  tools: ["release-watch", "repo-scout", "video-digest", "skill-brief"] as const,
};

// Topics Sophos scouts for — aligned with Osman's GRC/security/AI direction
// (mirrors the spirit of Athena's SCOUT_QUERIES, but capability-oriented:
// "what could help Osman build/learn" rather than "where could Osman work").
export const SCOUT_TOPICS = ["AI agent security tooling", "GRC compliance automation skills"];

// ── release-watch ─────────────────────────────────────────────────────────────

export async function releaseWatch(): Promise<string | null> {
  return fetchReleaseNotes();
}

// ── repo-scout ────────────────────────────────────────────────────────────────

export async function repoScoutTool(query: string): Promise<ScoutedRepo[]> {
  return repoScout(query);
}

// ── video-digest ──────────────────────────────────────────────────────────────

export async function videoDigestTool(query: string): Promise<ScoutedVideo[]> {
  return videoDigest(query);
}

// ── skill-brief ───────────────────────────────────────────────────────────────
// Synthesizes whatever release-watch/repo-scout/video-digest turned up into a
// short "here's what's new and might help you" digest via Groq (PUBLIC data —
// none of this touches Osman's personal accounts). Logged to model_usage like
// every other model call, and to AgentRun so it shows up on the dashboard.

export interface SkillBriefInput {
  releaseNotes: string | null;
  repos: ScoutedRepo[];
  videos: ScoutedVideo[];
}

export interface SkillBriefResult {
  text: string;
  hasFindings: boolean;
}

const SKILL_BRIEF_SYSTEM_PROMPT = `You are Sophos, Hermes OS's skills-and-capability scout.
Osman is heading toward a GRC (governance, risk, compliance) consulting career —
he holds Security+ and CySA+, works in HR compliance and IT, and is building an AI
agent system (Hermes OS) himself. Your job is to look at what's new in the AI/agent
and security-tooling space and tell him plainly which of it might actually help him —
not a press-release summary, a "here's what I'd look at first and why" from someone
who knows his direction. Be brief, concrete, and skip anything irrelevant to him.
No em dashes.`;

function buildBriefPrompt(input: SkillBriefInput): string {
  const sections = [
    input.releaseNotes
      ? `Recent Claude/Anthropic release notes (excerpt):\n${input.releaseNotes.slice(0, 3000)}`
      : "Release notes: unavailable this run.",
    input.repos.length
      ? `GitHub repos trending in capability/tooling search:\n${input.repos
          .map((r) => `- ${r.fullName} (${r.stars}★, ${r.language ?? "?"}) — ${r.description ?? "no description"}`)
          .join("\n")}`
      : "GitHub repos: nothing found this run.",
    input.videos.length
      ? `Recent relevant videos:\n${input.videos.map((v) => `- "${v.title}" — ${v.channel} (${v.url})`).join("\n")}`
      : "Videos: unavailable or nothing found this run (YOUTUBE_API_KEY may be unset).",
  ];
  return `${sections.join("\n\n")}\n\nWrite a short digest (4-7 sentences) telling Osman what's worth his attention from the above and why, grounded only in what's listed. If nothing here is genuinely useful to him, say so plainly instead of padding it out.`;
}

export async function skillBrief(userId: string, input: SkillBriefInput): Promise<SkillBriefResult> {
  const hasFindings = Boolean(input.releaseNotes) || input.repos.length > 0 || input.videos.length > 0;

  if (!hasFindings) {
    return { text: "No fresh signal this run, nothing worth flagging — release notes, repo search, and video search all came back empty.", hasFindings: false };
  }

  const result = await callModel({
    userId,
    taskType: "sophos-skill-brief",
    dataClass: "PUBLIC",
    systemPrompt: SKILL_BRIEF_SYSTEM_PROMPT,
    userPrompt: buildBriefPrompt(input),
  });

  await prisma.agentRun.create({
    data: {
      agentName: "sophos",
      inputSummary: `skill-brief: ${input.repos.length} repos, ${input.videos.length} videos, release notes ${input.releaseNotes ? "fetched" : "unavailable"}`,
      outputSummary: result.text.slice(0, 2000),
      modelProvider: result.provider,
      status: "completed",
    },
  });

  return { text: result.text, hasFindings: true };
}
