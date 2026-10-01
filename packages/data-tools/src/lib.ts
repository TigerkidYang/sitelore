import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  checkDanger,
  isBlocked,
  normalizeHost,
  parseBlocklist,
  parseEntry,
  parseEntryPath,
  scrub,
  type Entry,
  type HostBundle,
  type HostIndex,
} from "@sitelore/core";

export interface Problem {
  path: string;
  level: "error" | "warning";
  message: string;
}

export function readBlocklist(root: string): string[] {
  const file = join(root, "blocklist.txt");
  return existsSync(file) ? parseBlocklist(readFileSync(file, "utf8")) : [];
}

/** All entry paths (relative, forward slashes) under sites/. */
export function listEntryPaths(root: string): string[] {
  const sites = join(root, "sites");
  if (!existsSync(sites)) return [];
  const out: string[] = [];
  for (const host of readdirSync(sites, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    for (const f of readdirSync(join(sites, host.name), { withFileTypes: true })) {
      if (f.isFile()) out.push(`sites/${host.name}/${f.name}`);
    }
  }
  return out.sort();
}

/**
 * Checks entry files. Errors mean the change must not be merged; warnings are
 * things the reviewer should look at (danger rules with severity "review").
 */
export function checkEntries(root: string, paths: string[]): { problems: Problem[]; entries: Entry[] } {
  const blocklist = readBlocklist(root);
  const problems: Problem[] = [];
  const entries: Entry[] = [];
  const err = (path: string, message: string) => problems.push({ path, level: "error", message });

  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/");
    const loc = parseEntryPath(path);
    if (!loc) {
      err(path, "only files of the form sites/<host>/<id>.md may be changed");
      continue;
    }
    let host: string;
    try {
      host = normalizeHost(loc.host);
    } catch (e) {
      err(path, (e as Error).message);
      continue;
    }
    if (host !== loc.host) err(path, `directory must be the canonical host "${host}"`);
    if (isBlocked(host, blocklist)) err(path, `${host} is on the takedown blocklist`);

    const full = join(root, path);
    if (!existsSync(full)) {
      // Submissions never delete entries; deletions only happen on main via takedown.
      err(path, "entry files may not be deleted by a submission");
      continue;
    }
    let entry: Entry;
    try {
      entry = parseEntry(host, readFileSync(full, "utf8"));
    } catch (e) {
      err(path, (e as Error).message);
      continue;
    }
    if (entry.id !== loc.id) err(path, `id "${entry.id}" does not match the file name`);

    const text = [entry.title, entry.appliesWhen, entry.body, entry.outdatedReason].filter(Boolean).join("\n");
    const pii = scrub(text);
    if (pii.replaced.length) err(path, `contains personal data or secrets (${[...new Set(pii.replaced)].join(", ")})`);
    for (const hit of checkDanger(text, host).hits) {
      problems.push({
        path,
        level: hit.severity === "block" ? "error" : "warning",
        message: `danger rule ${hit.category}: "${hit.match}"`,
      });
    }
    if (!problems.some((p) => p.path === path && p.level === "error")) entries.push(entry);
  }
  return { problems, entries };
}

/** Writes bundles/<host>.json for every host with active entries, plus bundles/hosts.json. */
export function buildBundles(
  root: string,
  outDir: string,
  now = new Date(),
): { hosts: number; entries: number; skipped: Problem[] } {
  // Entries that fail checks (e.g. after a rule change or a manual blocklist edit) are left out
  // and reported, rather than freezing publication for every other site.
  const { problems, entries } = checkEntries(root, listEntryPaths(root));
  const skipped = problems.filter((p) => p.level === "error");

  const byHost = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.status !== "active") continue;
    byHost.set(e.host, [...(byHost.get(e.host) ?? []), e]);
  }
  mkdirSync(outDir, { recursive: true });
  const generatedAt = now.toISOString();
  let count = 0;
  for (const [host, list] of byHost) {
    list.sort((a, b) => b.lastVerified.localeCompare(a.lastVerified) || a.id.localeCompare(b.id));
    const bundle: HostBundle = { host, generatedAt, entries: list };
    writeFileSync(join(outDir, `${host}.json`), JSON.stringify(bundle));
    count += list.length;
  }
  const index: HostIndex = { generatedAt, hosts: [...byHost.keys()].sort() };
  writeFileSync(join(outDir, "hosts.json"), JSON.stringify(index));
  return { hosts: byHost.size, entries: count, skipped };
}

/** Deletes every entry for `domain` and its subdomains and adds it to the blocklist. */
export function takedown(root: string, domain: string): string[] {
  const d = normalizeHost(domain);
  const sites = join(root, "sites");
  const removed: string[] = [];
  if (existsSync(sites)) {
    for (const host of readdirSync(sites)) {
      if (isBlocked(host, [d])) {
        rmSync(join(sites, host), { recursive: true, force: true });
        removed.push(host);
      }
    }
  }
  if (!readBlocklist(root).includes(d)) {
    appendFileSync(join(root, "blocklist.txt"), `${d}  # takedown ${new Date().toISOString().slice(0, 10)}\n`);
  }
  return removed;
}

export function formatProblems(problems: Problem[], root?: string): string {
  return problems
    .map((p) => `${p.level.toUpperCase()} ${root ? relative(root, join(root, p.path)).replace(/\\/g, "/") : p.path}: ${p.message}`)
    .join("\n");
}
