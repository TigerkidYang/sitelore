import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeEntry, type Entry } from "@sitelore/core";
import { buildBundles, checkEntries, listEntryPaths, takedown } from "../src/lib.js";

function repo(entries: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sitelore-data-"));
  for (const [path, content] of Object.entries(entries)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: "01J8Z3K9QXAAAA01",
  host: "example.com",
  title: "Date field",
  lastVerified: "2026-09-28",
  status: "active",
  body: "Type the date and press Tab.",
  ...over,
});

describe("data tools", () => {
  it("accepts clean entries and builds bundles", () => {
    const e1 = entry();
    const e2 = entry({ id: "01J8Z3K9QXAAAA02", host: "console.aws.amazon.com", title: "Region" });
    const e3 = entry({ id: "01J8Z3K9QXAAAA03", status: "outdated", outdatedReason: "redesign" });
    const root = repo({
      [`sites/example.com/${e1.id}.md`]: serializeEntry(e1),
      [`sites/console.aws.amazon.com/${e2.id}.md`]: serializeEntry(e2),
      [`sites/example.com/${e3.id}.md`]: serializeEntry(e3),
    });
    const { problems } = checkEntries(root, listEntryPaths(root));
    expect(problems).toEqual([]);

    const out = join(root, "bundles");
    expect(buildBundles(root, out)).toMatchObject({ hosts: 2, entries: 2, skipped: [] });
    expect(JSON.parse(readFileSync(join(out, "hosts.json"), "utf8")).hosts).toEqual(["console.aws.amazon.com", "example.com"]);
    expect(JSON.parse(readFileSync(join(out, "example.com.json"), "utf8")).entries).toHaveLength(1);
  });

  it("reports PII, danger, bad paths and id mismatches", () => {
    const root = repo({
      "sites/example.com/01J8Z3K9QXAAAA01.md": serializeEntry(entry({ body: "Email me at a@b.com" })),
      "sites/example.com/01J8Z3K9QXAAAA02.md": serializeEntry(entry({ id: "01J8Z3K9QXAAAA02", body: "Download the helper.exe and run it" })),
      "sites/example.com/01J8Z3K9QXAAAA03.md": serializeEntry(entry({ id: "01J8Z3K9QXAAAA99" })),
      "sites/www.example.com/01J8Z3K9QXAAAA04.md": serializeEntry(entry({ id: "01J8Z3K9QXAAAA04" })),
      "README.md": "hi",
    });
    const { problems } = checkEntries(root, [...listEntryPaths(root), "README.md"]);
    const msgs = problems.map((p) => `${p.path}: ${p.message}`).join("\n");
    expect(msgs).toMatch(/AAAA01.md: contains personal data/);
    expect(msgs).toMatch(/AAAA02.md: danger rule download_execute/);
    expect(msgs).toMatch(/AAAA03.md: id .* does not match/);
    expect(msgs).toMatch(/www.example.com.*canonical host "example.com"/);
    expect(msgs).toMatch(/README.md: only files/);
  });

  it("takes a domain down and blocks it", () => {
    const root = repo({
      [`sites/example.com/${entry().id}.md`]: serializeEntry(entry()),
      [`sites/shop.example.com/${entry().id}.md`]: serializeEntry(entry({ host: "shop.example.com" })),
      [`sites/other.com/${entry().id}.md`]: serializeEntry(entry({ host: "other.com" })),
    });
    expect(takedown(root, "https://www.example.com").sort()).toEqual(["example.com", "shop.example.com"]);
    expect(existsSync(join(root, "sites", "other.com"))).toBe(true);
    const { problems } = checkEntries(root, ["sites/example.com/01J8Z3K9QXAAAA01.md"]);
    expect(problems[0]!.message).toMatch(/blocklist/);
  });
});
