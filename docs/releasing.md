# Release checklist

Only `packages/client` is published to npm as `sitelore`. Core is bundled into the CLI; core, data-tools and the monorepo stay private. Code and official experience data use MIT.

1. Use a dedicated release branch/worktree. Update `packages/client/package.json` and `packages/client/src/version.ts` together. Update the pinned install examples in the client README, and refresh the lockfile if dependencies or versions changed.
2. Run `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, and `npm run test:package`. The package check creates a tarball, installs it in a temporary directory outside the monorepo, checks the executable/default repository, and exercises MCP lookup and local-only recording. It prints the verified tarball path and integrity. The build includes third-party license notices.
3. Inspect `git diff`, commit, and integrate deliberately into main. Verify `npm whoami --registry=https://registry.npmjs.org/` returns the intended maintainer. New maintainers must register, verify their email, and complete npm's authentication requirements. Do not store tokens in the repository.
4. Publish the exact verified tarball: `npm publish <verified-tarball> --access public --registry=https://registry.npmjs.org/`. Complete any npm browser/2FA challenge. Publishing requires explicit maintainer authorization; the initial release is authorized in the project setup task.
5. Verify the registry version and integrity, then run `npx -y sitelore@<version> --version` from outside the repo. Test a lookup with a fresh `SITELORE_HOME` and `SITELORE_CONTRIBUTE=0` against the official bundles.
6. Update the README's publication status only after registry verification. Tag the tested code commit as `v<version>` and push the tag. Do not move a tag or overwrite a published version.

## Data repository

The official repository is `TigerkidYang/sitelore-data`. Its `check` and `publish` workflows use tooling pinned to a full commit SHA in `TigerkidYang/sitelore`; update both pins deliberately when releasing a tooling change. They do not depend on an npm release.

Create the four submission labels from the template's `CLAUDE.md`. Require `check` on main, prevent force pushes and deletion, and allow the maintainer's administrative maintenance/takedown path. GitHub Actions performs rule checks, not model review; use the local `/review-submissions` command before merging entries.

The publish workflow copies `LICENSE` beside the bundles and appends commits to the `bundles` branch. Verify `hosts.json` and `LICENSE` are publicly readable. Smoke-test entries must be clearly marked, closed without merging, and never presented as observed experience.

Initial live verification, 2026-10-06:

- [Valid synthetic PR check passed](https://github.com/TigerkidYang/sitelore-data/actions/runs/37347946377).
- [The same PR with an extra non-entry file failed](https://github.com/TigerkidYang/sitelore-data/actions/runs/37348168122), then [PR #1](https://github.com/TigerkidYang/sitelore-data/pull/1) was closed and its branch deleted.
- [Initial publication](https://github.com/TigerkidYang/sitelore-data/actions/runs/37347046294) and [a second publication](https://github.com/TigerkidYang/sitelore-data/actions/runs/37348010121) passed. The second commit retained the first as its parent.

The official library initially has no reviewed entries. A real non-maintainer fork contribution remains unverified; tests cover that path with a fake GitHub API.
