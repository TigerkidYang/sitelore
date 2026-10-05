import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeGitHub } from "../../../test-support/fake-github.js";
import { defaults } from "../src/config.js";
import { submit } from "../src/submit.js";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<(file: string, args: string[], options: unknown, callback: (error: Error | null, stdout: string) => void) => void>(),
}));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const REPO = "example-owner/sitelore-data";
const submission = { kind: "new" as const, site: "example.com", title: "Search", body: "Press Enter; the search icon ignores the first click." };

describe("local GitHub credentials", () => {
  let gh: FakeGitHub;
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    execFileMock.mockReset();
    gh = new FakeGitHub(REPO, "maintainer")
      .addUser("user-token", "alice")
      .addUser("maint-token", "maintainer", REPO);
    fetchSpy = vi.fn(gh.fetch);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["GITHUB_TOKEN", "GH_TOKEN"])("uses %s directly without invoking gh", async (key) => {
    vi.stubEnv(key, "user-token");
    const r = await submit(submission, defaults(REPO), { fetch: fetchSpy });
    expect(r.status).toBe("submitted");
    expect(gh.prs[0]!.head).toMatch(/^alice:/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("prefers GITHUB_TOKEN when both token variables are set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "maint-token");
    vi.stubEnv("GH_TOKEN", "user-token");
    await submit(submission, defaults(REPO), { fetch: fetchSpy });
    expect(gh.prs[0]!.head).toMatch(/^sitelore\//);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("uses an existing gh login without starting an interactive login", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, " user-token\n"));
    const r = await submit(submission, defaults(REPO), { fetch: fetchSpy });
    expect(r.status).toBe("submitted");
    expect(gh.prs[0]!.head).toMatch(/^alice:/);
    expect(execFileMock).toHaveBeenCalledExactlyOnceWith("gh", ["auth", "token"], { timeout: 5000, windowsHide: true }, expect.any(Function));
  });

  it.each([new Error("gh is unavailable or not logged in"), null])("skips when gh returns no usable credential (%s)", async (error) => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(error, ""));
    const r = await submit(submission, defaults(REPO), { fetch: fetchSpy });
    expect(r).toMatchObject({ status: "skipped", reason: expect.stringContaining("No local GitHub credentials") });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gh.prs).toHaveLength(0);
  });

  it("does not read credentials or upload when contribution is off", async () => {
    vi.stubEnv("GITHUB_TOKEN", "user-token");
    const r = await submit(submission, { ...defaults(REPO), contribute: false }, { fetch: fetchSpy });
    expect(r.status).toBe("skipped");
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
