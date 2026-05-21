# Agent Payment Signal Ledger Maintenance Plan

Last updated: 2026-05-21

## Purpose

Keep one public, source-backed directory for x402, L402, and agent-payments signals.
The ledger should help builders, crawlers, reviewers, and operators understand what is
live, what is merely listed, what is documented, and what has paid-call proof.

## Weekly Refresh

Run a manual source review once per week:

- Re-check each `sourceUrl` in `feed.json`.
- Update `lastVerified` on rows that still match the source.
- Downgrade or rewrite rows whose source changed, disappeared, or no longer supports the note.
- Add new rows only when a public HTTPS source supports the exact claim.
- Keep `lastUpdated` at the feed level aligned with the newest real review date.

## Row Rules

- Every row needs a public source URL.
- Ecosystem listings are discovery signals, not payment proof.
- Owned Satoshi/SATLAB surfaces should be labeled as owned or operator-controlled when relevant.
- Do not claim partnership, endorsement, prize, finalist status, or third-party revenue unless a cited source says exactly that.
- Prefer conservative proof labels over promotional wording.

## Proof-Status Ladder

- `protocol-doc`: official or durable protocol reference.
- `platform-doc`: platform documentation for payment behavior.
- `ecosystem-listed`: project appears in a public ecosystem/directory source.
- `public-observatory`: public explorer or observability surface.
- `live-discovery`: live machine-readable endpoint, catalog, or facilitator metadata.
- `public-proof-packet`: public packet with demo/evidence materials.
- `paid-call-captured`: public evidence of a completed paid call.

## Leverage Plan

Use the ledger as the directory layer for the Satoshi API, SATLAB, AgentOps Ledger,
x402, and L402 lane:

- Link it from the portfolio, Satoshi/SATLAB proof surfaces, and AgentOps discovery pages.
- Treat new market research as row candidates instead of scattered notes.
- Use the feed as a compact artifact in grant/reference conversations after rows mature.
- Watch for incoming search/crawler interest before expanding into automation.
- Add a contribution path later only if the public page starts attracting useful corrections.

## Production Boundary

This ledger can go live as a directory and proof map. It should not be used as revenue
proof, grant proof, partner proof, or market-leadership proof until cited external
sources support those exact claims.
