import { lookupHosts } from "./domain.js";

/**
 * Minimal GitHub REST client for opening submission PRs against the data repo.
 * Uses only fetch, so it runs in Node and in Cloudflare Workers.
 */

export interface GitHubOptions {
  token: string;
  /** Defaults to https://api.github.com */
  apiBase?: string;
  userAgent?: string;
  fetch?: typeof fetch;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class GitHub {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GitHubOptions) {
    this.base = (opts.apiBase ?? "https://api.github.com").replace(/\/$/, "");
    // Always call through a closure: Workers throw "Illegal invocation" when the global fetch
    // is called as a method of another object (this.fetchImpl(...)).
    const f = opts.fetch ?? fetch;
    this.fetchImpl = (input, init) => f(input, init);
  }

  async request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": this.opts.userAgent ?? "sitelore",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      const text = await res.text().catch(() => "");
      throw new GitHubError(`GitHub ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async viewerLogin(): Promise<string> {
    const me = await this.request<{ login: string }>("GET", "/user");
    return me.login;
  }

  /** Whether the token can push branches to `repo` directly (maintainers, bots), so no fork is needed. */
  async canPush(repo: string): Promise<boolean> {
    const info = await this.request<{ permissions?: { push?: boolean } }>("GET", `/repos/${repo}`);
    return info.permissions?.push === true;
  }

  async defaultBranchSha(repo: string): Promise<{ branch: string; sha: string }> {
    const info = await this.request<{ default_branch: string }>("GET", `/repos/${repo}`);
    const ref = await this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch)}`,
    );
    return { branch: info.default_branch, sha: ref.object.sha };
  }

  /** Returns the file's text and blob sha, or null if it does not exist. */
  async getFile(repo: string, path: string, ref?: string): Promise<{ text: string; sha: string } | null> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const res = await this.request<{ content: string; sha: string } | undefined>(
      "GET",
      `/repos/${repo}/contents/${encodePath(path)}${q}`,
      undefined,
      [404],
    );
    if (!res || !res.content) return null;
    return { text: decodeBase64(res.content), sha: res.sha };
  }

  /** Forks `repo` into the authenticated user's account (idempotent) and waits until it is usable. */
  async ensureFork(repo: string, waitMs = 60_000): Promise<string> {
    const fork = await this.request<{ full_name: string }>("POST", `/repos/${repo}/forks`, {
      default_branch_only: true,
    });
    const deadline = Date.now() + waitMs;
    for (;;) {
      const ok = await this.request<unknown>("GET", `/repos/${fork.full_name}/git/refs/heads`, undefined, [404, 409]).then(
        (r) => Array.isArray(r) && r.length > 0,
        () => false,
      );
      if (ok) return fork.full_name;
      if (Date.now() > deadline) throw new GitHubError(`fork ${fork.full_name} was not ready in time`, 504);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async createBranch(repo: string, branch: string, sha: string): Promise<void> {
    await this.request("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  async putFile(repo: string, branch: string, path: string, content: string, message: string, sha?: string): Promise<void> {
    await this.request("PUT", `/repos/${repo}/contents/${encodePath(path)}`, {
      message,
      content: encodeBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  async openPullRequest(
    repo: string,
    args: { head: string; base: string; title: string; body: string; labels?: string[] },
  ): Promise<{ number: number; url: string }> {
    const pr = await this.request<{ number: number; html_url: string }>("POST", `/repos/${repo}/pulls`, {
      head: args.head,
      base: args.base,
      title: args.title,
      body: args.body,
      maintainer_can_modify: true,
    });
    if (args.labels?.length) {
      // Labels are best effort: a fork contributor usually cannot set them.
      await this.request("POST", `/repos/${repo}/issues/${pr.number}/labels`, { labels: args.labels }).catch(() => {});
    }
    return { number: pr.number, url: pr.html_url };
  }
}

export interface SubmissionPROptions {
  /** Upstream data repo, "owner/name". */
  repo: string;
  /** Open the PR from a fork owned by the token's user (true) or from a branch in `repo` itself (false). */
  viaFork: boolean;
  path: string;
  content: string;
  /** For corrections: the file must already exist upstream. */
  expectExisting: boolean;
  title: string;
  body: string;
  labels?: string[];
  branchName: string;
}

/** Commits one entry file on a fresh branch and opens a PR against the data repo. */
export async function openSubmissionPR(gh: GitHub, o: SubmissionPROptions): Promise<{ number: number; url: string }> {
  const upstream = await gh.defaultBranchSha(o.repo);
  const existing = await gh.getFile(o.repo, o.path, upstream.branch);
  if (o.expectExisting && !existing) throw new GitHubError(`${o.path} does not exist in ${o.repo}`, 404);
  if (!o.expectExisting && existing) throw new GitHubError(`${o.path} already exists in ${o.repo}`, 409);

  const headRepo = o.viaFork ? await gh.ensureFork(o.repo) : o.repo;
  // Fork networks share objects, so the upstream commit can be used directly as the branch base.
  await gh.createBranch(headRepo, o.branchName, upstream.sha);
  await gh.putFile(headRepo, o.branchName, o.path, o.content, o.title, existing?.sha);
  const headOwner = headRepo.split("/")[0]!;
  return gh.openPullRequest(o.repo, {
    head: o.viaFork ? `${headOwner}:${o.branchName}` : o.branchName,
    base: upstream.branch,
    title: o.title,
    body: o.body,
    labels: o.labels,
  });
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Finds sites/<host>/<id>.md for a correction. The agent may pass the URL of a
 * subdomain it was on while the entry lives under a parent domain, so walk up.
 */
export async function findEntryFile(
  gh: GitHub,
  repo: string,
  host: string,
  id: string,
  ref?: string,
): Promise<{ host: string; text: string } | null> {
  for (const h of lookupHosts(host)) {
    const file = await gh.getFile(repo, `sites/${h}/${id}.md`, ref);
    if (file) return { host: h, text: file.text };
  }
  return null;
}
