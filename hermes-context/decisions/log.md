# Decisions Log

Append-only. Format: `- [YYYY-MM-DD] decision or commitment made`

---

- [2026-06-11] Initialized Hermes OS personal context layer from AIS-OS intake

- [2026-06-12] Added Themis (9th agent, workplace knowledge): answers job/I-9/M-274/client-services questions grounded only in knowledge/work/ files. PRIVATE data class (Groq only). No write tools. Also fixed approval-queue duplication: createApproval now dedupes identical pending actions, and the email job-tracker scanner skips job-alert digests and unknown-company signals.
