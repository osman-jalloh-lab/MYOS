import { fileURLToPath } from "url";
import { dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: __dirname },
  // Prisma + libSQL native bits must stay external in serverless functions
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-libsql", "@libsql/client"],
  // Runtime-read folders (fs.readFileSync with dynamic paths) are invisible to
  // Next's file tracing — without this, hermes-context/ and knowledge/ silently
  // come back empty on Vercel and agents answer without their grounding.
  outputFileTracingIncludes: {
    "/**": ["./hermes-context/**/*", "./knowledge/**/*"],
  },
  experimental: {
    // keep server actions/body limits sane for draft payloads
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
