#!/usr/bin/env node
// Applies the TrackedApplication table migration to Turso via HTTP API.
// Usage: node scripts/migrate-tracked-applications.mjs
//
// Requires .env.local to be set (loaded automatically if you run from hermes-os/).
// Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from environment.
//
// Pattern mirrors the established Hermes OS Turso migration approach:
//   POST https://<db-host>/v2/pipeline with bearer token,
//   one `execute` request per SQL statement,
//   then INSERT the migration record into _prisma_migrations.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.error("Could not read .env.local — make sure you run this from hermes-os/");
  process.exit(1);
}

const DB_URL = process.env.TURSO_DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DB_URL || !TOKEN) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local");
  process.exit(1);
}

// Convert libsql:// → https:// for the HTTP pipeline endpoint
const httpUrl = DB_URL.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
const pipelineUrl = `${httpUrl}/v2/pipeline`;

const MIGRATION_NAME = "20260613000000_add_tracked_applications";
const MIGRATION_CHECKSUM = "a1b2c3d4"; // placeholder — Turso doesn't validate this

const SQL_STATEMENTS = [
  // Main table
  `CREATE TABLE IF NOT EXISTS "TrackedApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "applicationDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'Other',
    "status" TEXT NOT NULL DEFAULT 'Unknown',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "emailSubject" TEXT,
    "jobUrl" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "nextFollowUpDate" DATETIME,
    "gmailMessageId" TEXT,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedApplication_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,

  // Dedup index (userId + fingerprint must be unique)
  `CREATE UNIQUE INDEX IF NOT EXISTS "TrackedApplication_userId_fingerprint_key"
    ON "TrackedApplication"("userId", "fingerprint")`,

  // Status query index
  `CREATE INDEX IF NOT EXISTS "TrackedApplication_userId_status_idx"
    ON "TrackedApplication"("userId", "status")`,

  // Recency query index
  `CREATE INDEX IF NOT EXISTS "TrackedApplication_userId_lastUpdatedAt_idx"
    ON "TrackedApplication"("userId", "lastUpdatedAt")`,

  // Register in Prisma's migrations table so `prisma migrate status` stays clean
  `INSERT OR IGNORE INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
  VALUES
    ('${MIGRATION_NAME}', '${MIGRATION_CHECKSUM}', datetime('now'), '${MIGRATION_NAME}', NULL, NULL, datetime('now'), 1)`,
];

async function runPipeline(statements) {
  const requests = statements.map((sql) => ({
    type: "execute",
    stmt: { sql },
  }));
  requests.push({ type: "close" });

  const res = await fetch(pipelineUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  return res.json();
}

console.log(`Running migration: ${MIGRATION_NAME}`);
console.log(`Target: ${httpUrl}`);
console.log(`Statements: ${SQL_STATEMENTS.length}`);
console.log("");

try {
  const result = await runPipeline(SQL_STATEMENTS);
  const results = result.results ?? [];

  let allOk = true;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.type === "error") {
      console.error(`Statement ${i + 1} failed: ${r.error?.message ?? JSON.stringify(r)}`);
      allOk = false;
    } else {
      const stmt = SQL_STATEMENTS[i] ?? "(close)";
      const preview = stmt.replace(/\s+/g, " ").slice(0, 60);
      console.log(`  OK [${i + 1}] ${preview}...`);
    }
  }

  if (allOk) {
    console.log(`\nMigration complete — TrackedApplication table is ready.`);
    console.log(`Next: run "npx prisma generate" to regenerate the Prisma client.`);
  } else {
    console.error(`\nMigration finished with errors. Check output above.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
}
