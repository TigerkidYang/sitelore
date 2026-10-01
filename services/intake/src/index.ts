import {
  describeSubmission,
  EntryFormatError,
  findEntryFile,
  GitHub,
  GitHubError,
  InvalidHostError,
  isBlocked,
  normalizeHost,
  openSubmissionPR,
  parseBlocklist,
  parseEntry,
  prepareCorrection,
  prepareNew,
  SubmissionRejectedError,
  type PreparedSubmission,
  type Submission,
} from "@sitelore/core";

export interface Env {
  DATA_REPO: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_INSTALLATION_ID?: string;
  /** Alternative to the GitHub App, for testing: a token with push access to DATA_REPO. */
  GITHUB_TOKEN?: string;
  GITHUB_API_BASE?: string;
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const MAX_BODY_BYTES = 16 * 1024;

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/") return json(200, { service: "sitelore-intake", ok: true });
  if (url.pathname !== "/v1/submissions") return json(404, { error: "not found" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!env.DATA_REPO) return json(503, { error: "intake is not configured with a data repo" });

  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: ip })).success) {
    return json(429, { error: "too many submissions, try again later" });
  }

  // Check the declared size before reading, then the actual size (the header can be absent or wrong).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "submission too large" });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: "submission too large" });

  let sub: Submission;
  let client = "unknown";
  try {
    const payload = JSON.parse(raw) as { submission?: unknown; client?: unknown };
    sub = parseSubmission(payload.submission);
    if (typeof payload.client === "string") client = payload.client.slice(0, 20);
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }

  try {
    const gh = new GitHub({ token: await githubToken(env, fetchImpl), apiBase: env.GITHUB_API_BASE, fetch: fetchImpl, userAgent: "sitelore-intake" });

    let prepared: PreparedSubmission;
    if (sub.kind === "new") {
      prepared = prepareNew(sub);
    } else {
      const host = normalizeHost(sub.site);
      const found = await findEntryFile(gh, env.DATA_REPO, host, sub.id);
      if (!found) throw new EntryFormatError(`entry ${sub.id} was not found for ${host} or its parent domains`);
      prepared = prepareCorrection({ ...sub, site: found.host }, parseEntry(found.host, found.text));
    }

    if (isBlocked(prepared.host, await blocklist(gh, env.DATA_REPO))) {
      return json(403, { error: `${prepared.host} does not accept submissions` });
    }

    const { title, body } = describeSubmission(prepared, "intake service", client);
    const pr = await openSubmissionPR(gh, {
      repo: env.DATA_REPO,
      viaFork: false,
      path: prepared.path,
      content: prepared.content,
      expectExisting: prepared.kind === "correction",
      title,
      body,
      labels: ["submission", "via-intake", ...(prepared.flags.length ? ["needs-attention"] : [])],
      branchName: `intake/${prepared.host}/${prepared.entry.id}-${Date.now().toString(36)}`,
    });
    return json(201, { url: pr.url });
  } catch (err) {
    if (err instanceof SubmissionRejectedError) {
      return json(422, { error: "submission contains dangerous instructions", hits: err.hits });
    }
    if (err instanceof EntryFormatError || err instanceof InvalidHostError) return json(400, { error: err.message });
    if (err instanceof GitHubError && err.status === 404) return json(404, { error: err.message });
    console.error(err);
    return json(502, { error: "could not open a pull request" });
  }
}

function parseSubmission(value: unknown): Submission {
  if (!value || typeof value !== "object") throw new Error("missing submission");
  const v = value as Record<string, unknown>;
  const str = (k: string, required: boolean): string | undefined => {
    const x = v[k];
    if (x === undefined || x === null) {
      if (required) throw new Error(`${k} is required`);
      return undefined;
    }
    if (typeof x !== "string") throw new Error(`${k} must be a string`);
    return x;
  };
  if (v.kind === "new") {
    return { kind: "new", site: str("site", true)!, title: str("title", true)!, body: str("body", true)!, appliesWhen: str("appliesWhen", false) };
  }
  if (v.kind === "correction") {
    if (v.outdated !== undefined && typeof v.outdated !== "boolean") throw new Error("outdated must be a boolean");
    return {
      kind: "correction",
      site: str("site", true)!,
      id: str("id", true)!,
      reason: str("reason", true)!,
      outdated: v.outdated as boolean | undefined,
      title: str("title", false),
      body: str("body", false),
      appliesWhen: str("appliesWhen", false),
    };
  }
  throw new Error(`kind must be "new" or "correction"`);
}

// Per-isolate cache; a takedown takes effect within BLOCKLIST_TTL_MS.
const BLOCKLIST_TTL_MS = 5 * 60_000;
let cachedBlocklist: { list: string[]; at: number } | null = null;

async function blocklist(gh: GitHub, repo: string): Promise<string[]> {
  if (cachedBlocklist && Date.now() - cachedBlocklist.at < BLOCKLIST_TTL_MS) return cachedBlocklist.list;
  const file = await gh.getFile(repo, "blocklist.txt");
  cachedBlocklist = { list: file ? parseBlocklist(file.text) : [], at: Date.now() };
  return cachedBlocklist.list;
}

/** For tests. */
export function resetCaches(): void {
  cachedBlocklist = null;
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

// --- GitHub App authentication ---

let cachedToken: { token: string; expires: number } | null = null;

async function githubToken(env: Env, fetchImpl: typeof fetch): Promise<string> {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_INSTALLATION_ID) {
    throw new Error("intake is not configured with GitHub credentials");
  }
  if (cachedToken && cachedToken.expires - Date.now() > 5 * 60_000) return cachedToken.token;

  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const base = (env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, "");
  const res = await fetchImpl(`${base}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "user-agent": "sitelore-intake" },
  });
  if (!res.ok) throw new Error(`could not get installation token: ${res.status}`);
  const data = (await res.json()) as { token: string; expires_at: string };
  cachedToken = { token: data.token, expires: Date.parse(data.expires_at) };
  return data.token;
}

async function appJwt(appId: string, pem: string): Promise<string> {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
