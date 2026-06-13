# Work knowledge — Themis reads everything in this folder

Drop any `.md` or `.txt` file here and Themis (the work agent) will ground its
answers in it. This is plain retrieval — no fine-tuning, no datasets needed.
The more real source material lives here, the better the answers.

What belongs here:
- USCIS M-274 Handbook for Employers sections (copy text from
  https://www.uscis.gov/i-9-central/form-i-9-resources/handbook-for-employers-m-274
  into one or more .md files — split by chapter for better retrieval)
- Your employer's client-services documentation, SOPs, ticket runbooks
- Internal FAQ answers you find yourself repeating
- Anything job-related you want Themis to know

What does NOT belong here:
- Real customer PII, SSNs, or document numbers — keep examples generic
- Credentials of any kind

Files are read at answer time and matched against your question by keyword
relevance, so use descriptive headings — they're the retrieval index.
