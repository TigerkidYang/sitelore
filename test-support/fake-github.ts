/**
 * In-memory stand-in for the parts of the GitHub REST API that Sitelore uses,
 * exposed as a fetch function. Good enough to exercise fork/branch/PR flows.
 */

type Files = Map<string, string>;

export interface FakePR {
  repo: string;
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  labels: string[];
  /** Files on the head branch at PR creation time. */
  files: Files;
}

export class FakeGitHub {
  commits = new Map<string, Files>();
  branches = new Map<string, Map<string, string>>(); // repo -> branch -> sha
  pushers = new Map<string, Set<string>>(); // repo -> logins with push access
  tokens = new Map<string, string>(); // token -> login
  prs: FakePR[] = [];
  private seq = 0;

  constructor(repo: string, owner: string, files: Record<string, string> = {}) {
    const sha = this.commit(new Map(Object.entries(files)));
    this.branches.set(repo, new Map([["main", sha]]));
    this.pushers.set(repo, new Set([owner]));
  }

  addUser(token: string, login: string, pushTo?: string): this {
    this.tokens.set(token, login);
    if (pushTo) this.pushers.get(pushTo)!.add(login);
    return this;
  }

  private commit(files: Files): string {
    const sha = `sha${++this.seq}`;
    this.commits.set(sha, files);
    return sha;
  }

  fileAt(repo: string, branch: string, path: string): string | undefined {
    const sha = this.branches.get(repo)?.get(branch);
    return sha ? this.commits.get(sha)?.get(path) : undefined;
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    const login = this.tokens.get(auth);
    if (!login) return res(401, { message: "Bad credentials" });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const p = decodeURIComponent(url.pathname);
    let m: RegExpExecArray | null;

    if (method === "GET" && p === "/user") return res(200, { login });

    if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(p)) && method === "GET") {
      if (!this.branches.has(m[1]!)) return res(404, {});
      return res(200, {
        full_name: m[1],
        default_branch: "main",
        permissions: { push: this.pushers.get(m[1]!)?.has(login) ?? m[1]!.startsWith(`${login}/`) },
      });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/(.+)$/.exec(p)) && method === "GET") {
      const sha = this.branches.get(m[1]!)?.get(m[2]!);
      return sha ? res(200, { object: { sha } }) : res(404, {});
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/refs\/heads$/.exec(p)) && method === "GET") {
      const b = this.branches.get(m[1]!);
      return b ? res(200, [...b.keys()].map((ref) => ({ ref }))) : res(404, {});
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/forks$/.exec(p)) && method === "POST") {
      const name = `${login}/${m[1]!.split("/")[1]}`;
      if (!this.branches.has(name)) this.branches.set(name, new Map(this.branches.get(m[1]!)));
      return res(202, { full_name: name });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/git\/refs$/.exec(p)) && method === "POST") {
      if (!this.canPush(m[1]!, login)) return res(403, {});
      const branch = String(body.ref).replace("refs/heads/", "");
      const b = this.branches.get(m[1]!)!;
      if (b.has(branch)) return res(422, { message: "Reference already exists" });
      if (!this.commits.has(body.sha)) return res(422, { message: "Object does not exist" });
      b.set(branch, body.sha);
      return res(201, {});
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(p))) {
      const [repo, path] = [m[1]!, m[2]!];
      if (method === "GET") {
        const branch = url.searchParams.get("ref") ?? "main";
        const text = this.fileAt(repo, branch, path);
        if (text === undefined) return res(404, {});
        return res(200, { content: Buffer.from(text).toString("base64"), sha: `blob:${path}:${text.length}` });
      }
      if (method === "PUT") {
        if (!this.canPush(repo, login)) return res(403, {});
        const b = this.branches.get(repo)!;
        const head = b.get(body.branch);
        if (!head) return res(404, {});
        const files = new Map(this.commits.get(head)!);
        if (files.has(path) && !body.sha) return res(422, { message: "sha required" });
        files.set(path, Buffer.from(body.content, "base64").toString("utf8"));
        b.set(body.branch, this.commit(files));
        return res(201, {});
      }
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(p)) && method === "POST") {
      const [owner, branch] = String(body.head).includes(":") ? String(body.head).split(":") : [m[1]!.split("/")[0], body.head];
      const headRepo = `${owner}/${m[1]!.split("/")[1]}`;
      const sha = this.branches.get(headRepo)?.get(branch!);
      if (!sha) return res(422, { message: "head not found" });
      const pr: FakePR = { repo: m[1]!, number: this.prs.length + 1, head: body.head, base: body.base, title: body.title, body: body.body, labels: [], files: this.commits.get(sha)! };
      this.prs.push(pr);
      return res(201, { number: pr.number, html_url: `https://github.com/${m[1]}/pull/${pr.number}` });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/labels$/.exec(p)) && method === "POST") {
      if (!this.pushers.get(m[1]!)?.has(login)) return res(403, {});
      this.prs[Number(m[2]) - 1]!.labels.push(...body.labels);
      return res(200, []);
    }
    return res(404, { message: `fake: no route for ${method} ${p}` });
  };

  private canPush(repo: string, login: string): boolean {
    return repo.startsWith(`${login}/`) || (this.pushers.get(repo)?.has(login) ?? false);
  }
}

function res(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
