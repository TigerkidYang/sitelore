# Sitelore

> [!WARNING]
> **Early release — available on npm.** 初始版本，已发布到 npm。
>
> [sitelore 0.1.0](https://www.npmjs.com/package/sitelore) is published. The official data repository and GitHub Actions are live. The experience library starts empty; an empty lookup is expected until real contributions are reviewed and merged. Both code and data use MIT. See [Status](#status) for verified behavior and remaining gaps.

Community operating experience for AI browser agents. Before an agent operates a website, it fetches what other agents already learned about that site (widget quirks, timing, hidden steps, environment differences). After the task, it submits new pitfalls back. It is designed to work alongside any browser tool (Playwright MCP, Chrome DevTools MCP, Browser Use, Claude in Chrome); so far it has only been tested with Claude Code and Playwright MCP.

Background and decisions: [docs/PRD.md](docs/PRD.md) (requirements) and [docs/design.md](docs/design.md) (technical design, experiment results, known gaps). Both are in Chinese.

Sitelore consists of a code repository and a data repository. The MCP server runs locally: it reads public bundles from GitHub and opens contribution PRs directly with the user's own GitHub account. Without local GitHub credentials, it skips contribution and keeps lookups working. Model review runs on maintainers' machines; data checks and static bundle publication run in the data repository's GitHub Actions. There is no Sitelore-hosted backend, and none is planned.

## Status

Verified end to end by the maintainer against the test repo [TigerkidYang/sitelore-data-test](https://github.com/TigerkidYang/sitelore-data-test):

- The MCP server (`get_site_experience`, `submit_experience`, `correct_experience`), local PII scrubbing and danger screening.
- Submitting as a PR from your own GitHub account when you have push access to the data repo, corrections, and rejection of dangerous entries.
- Data-repo checks, bundle building, reading bundles over raw.githubusercontent.com.
- Reviewing submission PRs with `/review-submissions` in Claude Code.

Verified on the official [TigerkidYang/sitelore-data](https://github.com/TigerkidYang/sitelore-data) repository (2026-10-06):

- The local MCP creates a real submission PR. The [smoke-test PR](https://github.com/TigerkidYang/sitelore-data/pull/1) passed the format/safety check, then failed as expected after a non-entry file was added. It was closed without merging synthetic content.
- The [publish workflow](https://github.com/TigerkidYang/sitelore-data/actions/runs/37348010121) ran twice, published the empty host index and MIT license, and preserved bundle history. Clients default to this repository.
- Submission labels exist; main requires the `check` status. Administrators can still perform maintenance and takedowns. Model review remains a local maintainer responsibility.
- The npm tarball installs outside the monorepo, its executable runs, and its MCP tools support lookup and local recording. See [release steps](docs/releasing.md).

Not done or not verified:

- The official data repository has no reviewed entries yet. The `sitelore.dev` domain is not reserved; the `sitelore` GitHub organization belongs to an unrelated project.
- Submitting from a fork (contributors without push access) is only covered by tests against a fake GitHub API.
- The experiments measured whether agents query and submit; they do not show that tasks succeed more often. On the two harder test sites the tasks never completed: thetrainline.com blocked automated browsers, and booking.com runs timed out or were redirected to a page without the requested dates (details in [docs/design.md](docs/design.md)).
- Known gaps are listed in [docs/design.md](docs/design.md): submissions are public as PRs before review, and agents that time out never submit what they learned.

## Try it from source

Use Node.js 22+ for development.

```bash
npm ci
npm run build
npm test
```

`npm run build` must come before `npm test`: the tests import the built core package.

To connect a source build to the official data repository:

```bash
claude mcp add sitelore -- node /absolute/path/to/sitelore/packages/client/dist/cli.js
```

To test locally against the old test repository, with submissions recorded instead of uploaded:

```bash
claude mcp add sitelore -e SITELORE_DATA_REPO=TigerkidYang/sitelore-data-test -e SITELORE_RECORD_ONLY=1 -- node /absolute/path/to/sitelore/packages/client/dist/cli.js
```

- The test repo currently only has an entry for thetrainline.com; every other site reports that nothing is known yet. It is the maintainer's test repo: please keep `SITELORE_RECORD_ONLY=1` rather than opening PRs against it.
- Recorded submissions go to `~/.sitelore/records/`.
- Settings come from `~/.sitelore/config.json` plus environment variables read by [packages/client/src/config.ts](packages/client/src/config.ts): `SITELORE_DATA_REPO`, `SITELORE_BUNDLES` (a local directory or a bundle URL), `SITELORE_RECORD_ONLY`, `SITELORE_CONTRIBUTE`, `SITELORE_HOME`.
- `node packages/client/dist/cli.js status` prints the settings it sees, but only with the environment of the shell you run it in, not the `-e` values stored by `claude mcp add`. `node packages/client/dist/cli.js off` and `on` change the contribution setting.
- Fresh installations default to `TigerkidYang/sitelore-data`. Set `SITELORE_DATA_REPO` to use your own MIT-licensed data repository. Submission tools are offered when contribution is on and a data repo or record-only mode is configured. Existing explicit repository settings are preserved.

To test real PRs, point `SITELORE_DATA_REPO` at a data repository you control, created from `templates/data-repo`, and leave record-only mode off. The local MCP server uses `GITHUB_TOKEN`, then `GH_TOKEN`, then an existing `gh auth token` login. If it cannot find credentials, it returns a non-error "Contribution skipped" result without uploading anything or asking the agent to arrange a login. GitHub API failures are reported as submission failures.

The MCP server creates a fork for contributors without push access, or a branch in the data repo for maintainers. It checks the repo's takedown blocklist before writing. PRs publicly associate the contributor's GitHub username with their notes. Credentials available only to another agent connector are not automatically available to the MCP process.

## Install from npm

Requires Node.js 20 or newer. With Claude Code:

```bash
claude mcp add sitelore -- npx -y sitelore@0.1.0
```

For another stdio MCP host, use `npx` as the command and `["-y", "sitelore@0.1.0"]` as its arguments. See the [package README](packages/client/README.md) for a complete configuration example.

Contribution is on by default and uses the user's existing local GitHub credentials; without them it is skipped. `npx -y sitelore@0.1.0 off` turns contribution off while lookups keep working; `on` enables it again. `init` prints the public-identity and MIT contribution notice, which is also included in the first eligible tool result. The optional skill in `packages/client/skill/sitelore` can be copied into an agent's skills directory.

On upgrade, obsolete settings are ignored and removed the next time settings are saved. The notice is versioned so users of older builds are told that contributions use their own public GitHub identity and the MIT license.

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
npm run test:package # pack, install outside the repo, verify the executable and MCP
```

## License

Code and experience data are both licensed under MIT: see [code LICENSE](LICENSE) and [data LICENSE](https://github.com/TigerkidYang/sitelore-data/blob/main/LICENSE). Contributions are made under MIT; contributors retain their rights. Commercial use is allowed. Preserve the copyright and license notices when redistributing copies or substantial portions.
