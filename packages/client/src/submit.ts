import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeSubmission,
  findEntryFile,
  GitHub,
  openSubmissionPR,
  parseEntry,
  prepareCorrection,
  prepareNew,
  sanitizeSubmission,
  type DangerHit,
  type PreparedSubmission,
  type Submission,
} from "@sitelore/core";
import { homeDir, type Config } from "./config.js";
import { VERSION } from "./version.js";

export interface SubmitResult {
  channel: "github" | "intake" | "record";
  /** PR URL, or the local file for record-only mode. */
  location: string;
  scrubbed: string[];
  flags: DangerHit[];
  /** Set when the preferred channel failed and another one was used. */
  note?: string;
}

export interface SubmitDeps {
  fetch?: typeof fetch;
  /** Returns a GitHub token for the user, or null. Defaults to env vars, then `gh auth token`. */
  githubToken?: () => Promise<string | null>;
  apiBase?: string;
}

const NOT_CONFIGURED =
  "Sitelore is a development build with no public data repo or intake service yet. Set SITELORE_RECORD_ONLY=1 to record submissions locally, SITELORE_INTAKE_URL to use an intake service, or SITELORE_DATA_REPO together with `sitelore github on` to open PRs from your own GitHub account.";

export async function submit(raw: Submission, config: Config, deps: SubmitDeps = {}): Promise<SubmitResult> {
  // Scrub and screen before anything leaves the machine. Throws SubmissionRejectedError on dangerous content.
  const { submission, scrubbed, flags } = sanitizeSubmission(raw);

  if (config.recordOnly) {
    const dir = join(homeDir(), "records");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${submission.kind}.json`);
    writeFileSync(file, JSON.stringify({ submission, scrubbed, flags, at: new Date().toISOString() }, null, 2));
    return { channel: "record", location: file, scrubbed, flags };
  }

  let githubFailure: Error | undefined;
  if (config.channel !== "intake") {
    if (!config.dataRepo) throw new Error(NOT_CONFIGURED);
    const token = await (deps.githubToken ?? defaultGithubToken)();
    if (token) {
      try {
        const url = await submitViaGitHub(submission, config, token, deps);
        return { channel: "github", location: url, scrubbed, flags };
      } catch (err) {
        if (config.channel === "github") throw err;
        githubFailure = err as Error;
      }
    } else if (config.channel === "github") {
      throw new Error("channel is set to github but no GitHub token was found (set GITHUB_TOKEN or run `gh auth login`)");
    }
  }

  if (!config.intakeUrl) throw githubFailure ?? new Error(NOT_CONFIGURED);
  const url = await submitViaIntake(submission, config, deps);
  const note = githubFailure
    ? `Submitting with your GitHub account failed (${githubFailure.message}); used the Sitelore intake service instead.`
    : undefined;
  return { channel: "intake", location: url, scrubbed, flags, note };
}

async function submitViaGitHub(sub: Submission, config: Config, token: string, deps: SubmitDeps): Promise<string> {
  const gh = new GitHub({ token, apiBase: deps.apiBase, fetch: deps.fetch, userAgent: `sitelore/${VERSION}` });
  let prepared: PreparedSubmission;
  if (sub.kind === "new") {
    prepared = prepareNew(sub);
  } else {
    const { branch } = await gh.defaultBranchSha(config.dataRepo);
    const found = await findEntryFile(gh, config.dataRepo, sub.site, sub.id, branch);
    if (!found) throw new Error(`entry ${sub.id} was not found for ${sub.site} or its parent domains`);
    prepared = prepareCorrection({ ...sub, site: found.host }, parseEntry(found.host, found.text));
  }
  const { title, body } = describeSubmission(prepared, "github (contributor's own account)", VERSION);
  const viaFork = !(await gh.canPush(config.dataRepo));
  const pr = await openSubmissionPR(gh, {
    repo: config.dataRepo,
    viaFork,
    path: prepared.path,
    content: prepared.content,
    expectExisting: prepared.kind === "correction",
    title,
    body,
    labels: ["submission", ...(prepared.flags.length ? ["needs-attention"] : [])],
    branchName: `sitelore/${prepared.host}/${prepared.entry.id}-${Date.now().toString(36)}`,
  });
  return pr.url;
}

async function submitViaIntake(sub: Submission, config: Config, deps: SubmitDeps): Promise<string> {
  const f = deps.fetch ?? fetch;
  const res = await f(new URL("/v1/submissions", config.intakeUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": `sitelore/${VERSION}` },
    body: JSON.stringify({ submission: sub, client: VERSION }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(`intake service rejected the submission: ${data.error ?? `HTTP ${res.status}`}`);
  return data.url;
}

async function defaultGithubToken(): Promise<string | null> {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  return new Promise((resolve) => {
    execFile("gh", ["auth", "token"], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const token = stdout?.trim();
      resolve(!err && token ? token : null);
    });
  });
}
