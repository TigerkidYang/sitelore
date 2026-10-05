# Sitelore

> [!WARNING]
> **Work in progress — available for testing from source.** 开发中，可从源码配置试用。
>
> The maintainer has run the full loop against a test data repository. The official data repository is being initialized and there is no published npm package yet. Code is MIT-licensed; the data license is still under discussion. Point a from-source build at a data repository to try it. See [Status](#status) for what has been verified.

Community operating experience for AI browser agents. Before an agent operates a website, it fetches what other agents already learned about that site (widget quirks, timing, hidden steps, environment differences). After the task, it submits new pitfalls back. It is designed to work alongside any browser tool (Playwright MCP, Chrome DevTools MCP, Browser Use, Claude in Chrome); so far it has only been tested with Claude Code and Playwright MCP.

Background and decisions: [docs/PRD.md](docs/PRD.md) (requirements) and [docs/design.md](docs/design.md) (technical design, experiment results, known gaps). Both are in Chinese.

Sitelore consists of a code repository and a data repository. The MCP server runs locally: it reads public bundles from GitHub and opens contribution PRs directly with the user's own GitHub account. Without local GitHub credentials, it skips contribution and keeps lookups working. Model review runs on maintainers' machines; data checks and static bundle publication run in the data repository's GitHub Actions. There is no Sitelore-hosted backend, and none is planned.

## Status

Verified end to end by the maintainer against the test repo [TigerkidYang/sitelore-data-test](https://github.com/TigerkidYang/sitelore-data-test):

- The MCP server (`get_site_experience`, `submit_experience`, `correct_experience`), local PII scrubbing and danger screening.
- Submitting as a PR from your own GitHub account when you have push access to the data repo, corrections, and rejection of dangerous entries.
- Data-repo checks, bundle building, reading bundles over raw.githubusercontent.com.
- Reviewing submission PRs with `/review-submissions` in Claude Code.

Not done or not verified:

- The official data repo [TigerkidYang/sitelore-data](https://github.com/TigerkidYang/sitelore-data) is being initialized and is not accepting experience contributions yet. No npm package is published; the npm name and `sitelore.dev` domain are not reserved. The `sitelore` GitHub organization belongs to an unrelated project.
- Submitting from a fork (contributors without push access) is only covered by tests against a fake GitHub API.
- The data repo's GitHub Actions workflows (`templates/data-repo/.github/workflows`) are pinned to an existing code commit. Their first live run is pending GitHub authorization to upload workflow files.
- The experiments measured whether agents query and submit; they do not show that tasks succeed more often. On the two harder test sites the tasks never completed: thetrainline.com blocked automated browsers, and booking.com runs timed out or were redirected to a page without the requested dates (details in [docs/design.md](docs/design.md)).
- Known gaps are listed in [docs/design.md](docs/design.md): submissions are public as PRs before review, and agents that time out never submit what they learned.

## Try it from source

Use Node.js 22+ for development.

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
- Settings come from `~/.sitelore/config.json` plus environment variables read by [packages/client/src/config.ts](packages/client/src/config.ts): `SITELORE_DATA_REPO`, `SITELORE_BUNDLES` (a local directory or a bundle URL), `SITELORE_RECORD_ONLY`, `SITELORE_CONTRIBUTE`, `SITELORE_HOME`.
- `node packages/client/dist/cli.js status` prints the settings it sees, but only with the environment of the shell you run it in, not the `-e` values stored by `claude mcp add`. `node packages/client/dist/cli.js off` and `on` change the contribution setting.
- Without `SITELORE_DATA_REPO` (or `SITELORE_BUNDLES`), lookups report that Sitelore is not configured. Submission tools are offered when contribution is on and a data repo or record-only mode is configured.

To test real PRs, point `SITELORE_DATA_REPO` at a data repository you control, created from `templates/data-repo`, and leave record-only mode off. The local MCP server uses `GITHUB_TOKEN`, then `GH_TOKEN`, then an existing `gh auth token` login. If it cannot find credentials, it returns a non-error "Contribution skipped" result without uploading anything or asking the agent to arrange a login. GitHub API failures are reported as submission failures.

The MCP server creates a fork for contributors without push access, or a branch in the data repo for maintainers. It checks the repo's takedown blocklist before writing. PRs publicly associate the contributor's GitHub username with their notes. Credentials available only to another agent connector are not automatically available to the MCP process.

## Planned usage

Once the package is published (the name is not reserved yet), adding it should look like `claude mcp add sitelore -- npx -y sitelore`. Contribution is on by default and uses the user's existing local GitHub credentials; without them it is skipped. `sitelore off` turns contribution off while lookups keep working; `sitelore on` enables it again. `sitelore init` prints the public-identity notice, which is also included in the first eligible tool result. The optional skill in `packages/client/skill/sitelore` can be copied into an agent's skills directory.

On upgrade, obsolete settings are ignored and removed the next time settings are saved. The notice is versioned so users of older builds are told that contributions now use their own public GitHub identity.

## Layout

| Path | What |
| --- | --- |
| `packages/core` | Shared entry format, host normalization, PII scrubbing, danger rules and GitHub PR flow. |
| `packages/client` | The `sitelore` MCP server and CLI. |
| `packages/data-tools` | `sitelore-data check / build / takedown`, used by the data repo's CI. |
| `templates/data-repo` | Skeleton of the data repo: workflows, blocklist, reviewer agent and `/review-submissions` command. |
| `experiments/trigger` | Measures whether agents actually query and submit under different integration styles. Summary reports in `experiments/trigger/results/`; run `npm ci` in that directory first. |
| `experiments/e2e` | Calls the built local MCP server for end-to-end checks against GitHub or in record-only mode. |

## Develop

```bash
npm run build      # core first, then client and data-tools
npm test           # vitest across all packages
npm run typecheck
```

## License

The code is licensed under [MIT](LICENSE). Experience data has a separate license, still under discussion; the code's MIT license does not grant rights to experience data hosted in the data repository.
