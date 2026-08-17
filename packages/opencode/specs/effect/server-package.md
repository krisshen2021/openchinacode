# Server Package Extraction

Obsolete. The `@opencode-ai/protocol` and `@opencode-ai/server` packages this
spec described were removed in Phase 4 of the memory surgery (commit
`5d16d6033`); the live `/api/*` routes were folded into the opencode instance
HttpApi (`src/server/routes/instance/httpapi/groups/v2.ts` + `handlers/v2.ts`).
Any future server-package split starts from that route tree, not from this
spec. See `docs/superpowers/plans/2026-08-16-memory-surgery.md` Phase 4.
