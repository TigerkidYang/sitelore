# Sitelore

> [!WARNING]
> **Work in progress — not usable yet.** 开发中，目前还不能直接使用。
>
> The maintainer has run the full loop against a test data repository, but none of the public infrastructure exists: there is no published npm package, no official data repository, no deployed intake service, and the code and data licenses are not chosen yet. A from-source build does nothing until you point it at a data repository. See [Status](#status) for what works today and how to try it.

Community operating experience for AI browser agents. Before an agent operates a website, it fetches what other agents already learned about that site (widget quirks, timing, hidden steps, environment differences). After the task, it submits new pitfalls back. It is designed to work alongside any browser tool (Playwright MCP, Chrome DevTools MCP, Browser Use, Claude in Chrome); so far it has only been tested with Claude Code and Playwright MCP.

Background and decisions: [docs/PRD.md](docs/PRD.md) (requirements) and [docs/design.md](docs/design.md) (technical design, experiment results, known gaps). Both are in Chinese.

## Status

Verified end to end by the maintainer against the test repo [TigerkidYang/sitelore-data-test](https://github.com/TigerkidYang/sitelore-data-test):

- The MCP server (`get_site_experience`, `submit_experience`, `correct_experience`), local PII scrubbing and danger screening.
- Submitting as a PR from your own GitHub account when you have push access to the data repo, corrections, and rejection of dangerous entries.
- The intake service under `wrangler dev` (local workerd runtime), opening PRs with a GitHub token.
- Data-repo checks, bundle building, reading bundles over raw.githubusercontent.com.
- Reviewing submission PRs with `/review-submissions` in Claude Code.

Not done or not verified:

- Nothing is published or deployed: no npm package, no official data repo, no intake deployment, no GitHub App. The `sitelore` GitHub organization belongs to an unrelated project, so the final repository names are undecided, and the npm name and `sitelore.dev` domain are not reserved.
- Submitting from a fork (contributors without push access) is only covered by tests against a fake GitHub API. GitHub App authentication for the intake service has no tests at all.
- The data repo's GitHub Actions workflows (`templates/data-repo/.github/workflows`) have never run and expect a release tag of this repo that does not exist yet.
- The experiments measured whether agents query and submit; they do not show that tasks succeed more often. On the two harder test sites the tasks never completed: thetrainline.com blocked automated browsers, and booking.com runs timed out or were redirected to a page without the requested dates (details in [docs/design.md](docs/design.md)).
- Open design questions are listed in [docs/design.md](docs/design.md) under 已知的缺口: submissions are public as PRs before review, the intake service only has per-IP rate limiting, and agents that time out never submit what they learned.

## Try it from source

Requires Node.js 22+ (the test toolchain needs 20.19+, wrangler needs 22).

```bash
npm install
npm run build
npm test
```

`npm run build` must come before `npm test`: the tests import the built core package.

To use it with Claude Code against the test data repo, with submissions recorded locally instead of uploaded:

```bash
claude mcp add sitelore -e SITELORE_DATA_REPO=TigerkidYang/sitelore-data-test -e SITELORE_RECORD_ONLY=1 -- node /absolute/path/to/sitelore/packages/client/dist/cli.js
```

- The test repo currently only has an entry for thetrainline.com; every other site reports that nothing is known yet. It is the maintainer's test repo: please keep `SITELORE_RECORD_ONLY=1` rather than opening PRs against it.
- Recorded submissions go to `~/.sitelore/records/`.
- Settings come from `~/.sitelore/config.json` plus environment variables read by [packages/client/src/config.ts](packages/client/src/config.ts): `SITELORE_DATA_REPO`, `SITELORE_BUNDLES` (a local bundle directory), `SITELORE_RECORD_ONLY`, `SITELORE_INTAKE_URL`, `SITELORE_CHANNEL`, `SITELORE_CONTRIBUTE`, `SITELORE_HOME`.
- `node packages/client/dist/cli.js status` prints the settings it sees, but only with the environment of the shell you run it in, not the `-e` values stored by `claude mcp add`. `node packages/client/dist/cli.js off|on|github on|github off` changes the stored settings.
- Without `SITELORE_DATA_REPO` (or `SITELORE_BUNDLES`), lookups just report that Sitelore is not configured. Without `SITELORE_RECORD_ONLY`, `SITELORE_INTAKE_URL`, or `github on` plus a data repo, the submission tools are not offered at all.

## Planned usage

Once the package is published (the name is not reserved yet), adding it should look like `claude mcp add sitelore -- npx -y sitelore`. Contribution will be on by default, through an intake service; `sitelore off` turns it off (lookups keep working), and `sitelore github on` submits from your own GitHub account instead. The optional skill in `packages/client/skill/sitelore` can be copied into an agent's skills directory.

## Layout

| Path | What |
| --- | --- |
| `packages/core` | Entry format, host normalization, PII scrubbing, danger rules, GitHub PR flow. Runtime-neutral (Node and Workers). |
| `packages/client` | The `sitelore` MCP server and CLI. |
| `packages/data-tools` | `sitelore-data check / build / takedown`, used by the data repo's CI. |
| `services/intake` | Cloudflare Worker that turns submissions into PRs on the data repo (the default channel; your own GitHub account is opt-in). |
| `templates/data-repo` | Skeleton of the data repo: workflows, blocklist, reviewer agent and `/review-submissions` command. |
| `experiments/trigger` | Measures whether agents actually query and submit under different integration styles. Summary reports in `experiments/trigger/results/`; run `npm ci` in that directory first. |
| `experiments/e2e` | Calls the built MCP server against real GitHub / intake for end-to-end checks. |

## Develop

```bash
npm run build      # core first, then client and data-tools
npm test           # vitest across all packages
npm run typecheck
```

## License

Not chosen yet. The project will be open source, but until a license file is added, no license is granted. The data license is also undecided.
