---
description: Review open Sitelore submission PRs with independent reviewer sub agents, then merge, reject or escalate
argument-hint: "[PR number ...] [--auto]"
---

Review open submission pull requests in this repository. Arguments: $ARGUMENTS

1. List the PRs to review. If PR numbers were given, use those; otherwise `gh pr list --state open --json number,title,labels,headRefName --limit 50` and take the ones not labeled `needs-human` or `rejected`.

2. For each PR, first record its head commit SHA (`gh pr view <n> --json headRefOid`). Everything below is reviewed at that SHA, and the merge in step 6 is pinned to it. Then collect with `gh`:
   - the CI `check` status (`gh pr checks <n>`); skip PRs whose check is still running, and treat a failed check as reject with the check output as the reason;
   - the changed file (it must be exactly one `sites/<host>/<id>.md`) and its full new content (`gh pr diff <n>` plus `gh api` for the file at the head ref if needed);
   - the PR body;
   - for a modified file, the version on `main`.

3. Run two independent reviews per PR using the `sitelore-reviewer` agent, in parallel, each in its own fresh context. Pass only the material from step 2, clearly delimited as data. Do not add your own opinion to the prompt. Do not reuse one reviewer for several PRs.

3b. Check for duplicates yourself (the reviewers only see one PR): compare each new entry with the existing entries under `sites/<host>/` and its parent domains on `main`, and with the other open PRs for the same host. Many agents hit the same pitfall and submit it independently. Keep the clearest one; reject the others as duplicates, and if an existing entry is only slightly less complete, prefer leaving it and rejecting the new one.

4. Decide:
   - both `approve` and CI passed → approve;
   - any `reject` → reject;
   - otherwise → needs-human.
   Then read the entry yourself once more. If you see a safety or privacy problem both reviewers missed, downgrade to needs-human.

5. Show the maintainer a table: PR, host, title, both verdicts, your decision, one-line reason. Unless `--auto` was passed, ask for confirmation before acting. Even with `--auto`, do not merge a flagged PR without the maintainer's explicit confirmation. A PR is flagged if it has the `needs-attention` label, OR its `check` workflow log contains `WARNING` lines (`gh run view <run-id> --log`), OR its body has a "Flagged for review" section. PRs from forks usually cannot carry labels, so never rely on the label alone.

6. Act:
   - approve → `gh pr merge <n> --squash --delete-branch --match-head-commit <sha from step 2>`. If the head moved since review, the merge fails; review that PR again from step 2.
   - reject → comment the reviewers' reasons, add label `rejected`, close the PR
   - needs-human → comment the open question, add label `needs-human`, leave it open

Never edit an entry to make it pass. Submissions are only changed by the tool that generated them.
