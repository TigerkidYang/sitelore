# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Sitelore is a work-in-progress prototype: it runs end to end against the test data repo `TigerkidYang/sitelore-data-test`, but nothing is published or deployed (no npm package, no official data repo, no intake deployment; the `sitelore` GitHub org belongs to an unrelated project, so the client must not default to it). The README's Status section lists what works and what doesn't; keep it accurate when that changes. `README.md` also describes the layout (npm workspaces: `packages/core`, `packages/client`, `packages/data-tools`, `services/intake`, plus `templates/data-repo` and `experiments/trigger`).

Commands (repo root):

- `npm run build` — core must build first (other packages import its `dist`); the root script does this in order.
- `npm test` — vitest across all packages. `npx vitest run packages/core` for one package, `-t "<name>"` for one test.
- `npm run typecheck`
- `packages/client/test/cli.test.ts` runs the bundled `dist/cli.js` over stdio and is skipped if it has not been built.

`packages/core` must stay runtime-neutral (no `node:` imports): it runs in Node and in the Cloudflare Worker. Tests use `test-support/fake-github.ts`, an in-memory fake of the GitHub REST endpoints we call.

`docs/PRD.md` was exported from a Claude Docs document (https://claude.ai/artifact/S4Bh8pkiD75AdRsSMPdJ5H). The user may keep editing the online version; if they refer to "the PRD" and the local copy might be stale, check with them or re-export.

## How to read the PRD

The PRD came out of brainstorming conversations with an AI, written up in product-manager style. Treat it as:

- **Settled:** the problem, goals/non-goals, and the rows in the 决策记录 (decision log) table. Don't re-litigate these without the user raising them.
- **Not settled:** any concrete technical choice or design detail (MCP server as the delivery form, git repo vs. repo + query service, data license, entry format, review pipeline, etc.). These are ideas, not decisions. Items under 开放问题 (open questions) are explicitly undecided. When designing, propose options and ask rather than assuming the PRD's examples are requirements.

`docs/design.md` holds the technical design. Its 已定的决定 table records choices confirmed with the user after the PRD (dual submission path with a fallback intake service, build the full loop directly, free-text entries, TypeScript). Treat that table as settled too; the rest of design.md is proposal.

## What Sitelore is (summary)

A neutral, open-source "experience layer" for AI browser agents: before operating a website, an agent fetches community-contributed operating experience for that domain (widget quirks, timing, hidden steps, environment differences); after the task, the agent auto-summarizes new pitfalls and submits them back. Core loop: query by domain → agent runs task → summarize new experience → local PII scrub & danger filter → pre-merge multi-round model review → merge into public per-domain repo; community feedback via issues.

Key constraints that shape any design:

- Not a browser and not tied to any agent framework or browser tool; it works alongside existing tools (Playwright MCP, Chrome DevTools MCP, Browser Use, Claude in Chrome, etc.).
- Experience entries are descriptive data, never executable code. Each carries applicability conditions (login state, region, language, page version) and a last-verified time.
- Submissions are generated only by the tool, never hand-edited and merged directly.
- Security baseline: block entries that could cause serious harm (cross-domain data exfiltration/redirects, entering passwords/OTP/payment info, changing account credentials/2FA, granting OAuth/permissions, downloading/running files, skipping confirmations, extra purchases). Filter both before merge and again client-side before handing entries to the agent. Entries are effectively a trusted prompt-injection channel.
- Privacy/legal: store only how-to-operate knowledge — no page content, screenshots, DOM, or user data. PII must be removed locally by rules before upload (git history makes post-merge deletion ineffective). No anti-bot/CAPTCHA/risk-control bypass experience. Support fast takedown by domain.
- Client is open source; contribution is on by default with a one-click off switch.

`packages/core` and `packages/client` are marked `"private": true` and have no `license` field on purpose: the npm name and the license are not decided yet. Remove `private` only when actually publishing.
