# MVP Burn-Down Agent — Diagnostic Report

**Run UTC:** 2026-04-27
**Agent:** Spooool MVP one-shot burn-down
**Outcome:** **HALTED at Phase 0c.** Linear MCP unreachable; cannot post the required heartbeat on ALO-128 or move issues to Done. Per the hard constraint ("If MCPs are unreachable, push `mvp-burndown-diagnostic` branch with `DIAGNOSTIC.md`"), the agent is exiting before mutating code.

## Reachable MCPs (verified via ToolSearch)

| MCP | Status |
|---|---|
| `mcp__github__*` | ✅ reachable (scoped to `aloewright/spooool`) |
| `mcp__Gmail__*` | ✅ reachable |
| `mcp__Cloudflare-Developer-Platform__*` | ✅ reachable |
| `mcp__Exa__*` | ✅ reachable |
| `mcp__Linear__*` | ❌ **NOT REACHABLE** — no Linear tools surfaced by `ToolSearch` for queries `linear`, `+linear`, `ALO issue ticket project`, or `comment_to_issue create_comment ticket` |

The Spooool burn-down workflow is keyed off Linear ticket IDs (ALO-128, ALO-129, ALO-189, ALO-168, ALO-167, ALO-166, ALO-173, ALO-175, ALO-204) and requires:
- Heartbeat comments on ALO-128 (start, per-issue ship, completion).
- Per-issue Done transitions with merge SHAs.
- Follow-up issue creation under epics via `parentId`.

None of these are possible via the GitHub MCP alone (issue numbers don't map; `parentId` is Linear-specific).

## Environment health (otherwise green)

```
pwd:         /home/user/spooool
git HEAD:    eaf6787 style(home): rework hero/section typography + auth heading spacing
node:        v22.22.2
npm ci:      no-op, node_modules already present
npm run lint:        Found 0 warnings and 0 errors. (oxlint, 57 files, 69 rules)
npm run type-check:  clean (tsc --noEmit)
npm test:            17 files, 120/120 passed (vitest 4.1.5, 1.93s)
```

Initial git state was a **detached HEAD on main** (`eaf6787`); the diagnostic branch was cut from that commit.

## Why the agent did not proceed without Linear

Falling back to "GitHub-only mode" was rejected because:

1. The user's queue is expressed exclusively in Linear IDs (ALO-NNN). Mapping to GitHub issues would require guessing, and could close the wrong issue or leave Linear stale.
2. The Phase 0a contract is explicit: **"Post Linear comment on ALO-128: 🤖 MVP burn-down agent started at <UTC ISO timestamp>. Beginning diagnostics."** — there is no documented fallback for "post on GitHub instead."
3. Hard constraints forbid pushing to `main` and require Linear "Done" transitions per shipped issue. Without Linear, the workflow's accounting is broken even if code lands cleanly.
4. The hard constraint explicitly anticipates this case and prescribes this exact diagnostic branch.

## To unblock the next run

Add a Linear MCP server to the Claude Code config so tools like `mcp__linear__create_comment`, `mcp__linear__update_issue`, `mcp__linear__create_issue` (or equivalents from `@modelcontextprotocol/server-linear` / `linear-mcp`) are surfaced to the agent.

Sample `.mcp.json` snippet (adjust to your Linear MCP package of choice):

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "@tacticlaunch/mcp-linear"],
      "env": { "LINEAR_API_KEY": "<lin_api_...>" }
    }
  }
}
```

Once Linear MCP is wired, re-run the burn-down prompt; the agent should pick up at Phase 0a.

## What the agent would have shipped (priority queue, unchanged)

1. ALO-128 — Email verification flow (Resend via HTTPS POST, no SDK).
2. ALO-129 — Password reset flow.
3. ALO-189 — `@cloudflare/vitest-pool-workers` integration suite.
4. ALO-168 — Durable-Object token-bucket rate limiting.
5. ALO-167 — Sentry frontend (lazy-imported).
6. ALO-166 — Workers Logs + Analytics Engine request-level logging.
7. ALO-173 — Playwright E2E (`npm run e2e` against `wrangler dev`).
8. ALO-175 — D1 backup + restore runbook.
9. ALO-204 — `video.js` → `hls.js` + native HLS (~500KB raw saved).

No code changes were made to the working tree; only this `DIAGNOSTIC.md` is added on the `mvp-burndown-diagnostic` branch.
