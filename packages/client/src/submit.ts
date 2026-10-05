import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeSubmission,
  findEntryFile,
  GitHub,
  isBlocked,
  openSubmissionPR,
  parseBlocklist,
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

export type SubmitResult = {
  scrubbed: string[];
  flags: DangerHit[];
} & (
  | { status: "submitted" | "recorded"; location: string }
  | { status: "skipped"; reason: string }
);

export interface SubmitDeps {
  fetch?: typeof fetch;
  /** Returns a GitHub token for the user, or null. Defaults to env vars, then `gh auth token`. */
  githubToken?: () => Promise<string | null>;
  apiBase?: string;
}

export async function submit(raw: Submission, config: Config, deps: SubmitDeps = {}): Promise<SubmitResult> {
  if (!config.contribute) return { status: "skipped", reason: "Contribution is off.", scrubbed: [], flags: [] };
  // Scrub and screen before anything leaves the machine. Throws SubmissionRejectedError on dangerous content.
  const { submission, scrubbed, flags } = sanitizeSubmission(raw);

  if (config.recordOnly) {
    const dir = join(homeDir(), "records");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${submission.kind}.json`);
    writeFileSync(file, JSON.stringify({ submission, scrubbed, flags, at: new Date().toISOString() }, null, 2));
    return { status: "recorded", location: file, scrubbed, flags };
  }

  if (!config.dataRepo) {
    return { status: "skipped", reason: "No data repository is configured.", scrubbed, flags };
  }
  const token = await (deps.githubToken ?? defaultGithubToken)();
  if (!token) {
    return {
      status: "skipped",
      reason: "No local GitHub credentials are available (GITHUB_TOKEN, GH_TOKEN or an existing gh login).",
      scrubbed,
      flags,
    };
  }
  const location = await submitViaGitHub(submission, config, token, deps);
  return { status: "submitted", location, scrubbed, flags };
}

async function submitViaGitHub(sub: Submission, config: Config, token: string, deps: SubmitDeps): Promise<string> {
  const gh = new GitHub({ token, apiBase: deps.apiBase, fetch: deps.fetch, userAgent: `sitelore/${VERSION}` });
  const { branch } = await gh.defaultBranchSha(config.dataRepo);
  const blocklistFile = await gh.getFile(config.dataRepo, "blocklist.txt", branch);
  const blocklist = parseBlocklist(blocklistFile?.text ?? "");
  const checkHost = (host: string) => {
    if (isBlocked(host, blocklist)) throw new Error(`${host} does not accept submissions (takedown blocklist)`);
  };
  checkHost(sub.site);
  let prepared: PreparedSubmission;
  if (sub.kind === "new") {
    prepared = prepareNew(sub);
  } else {
    const found = await findEntryFile(gh, config.dataRepo, sub.site, sub.id, branch);
    if (!found) throw new Error(`entry ${sub.id} was not found for ${sub.site} or its parent domains`);
    prepared = prepareCorrection({ ...sub, site: found.host }, parseEntry(found.host, found.text));
  }
  checkHost(prepared.host);
  const { title, body } = describeSubmission(prepared, VERSION);
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
