import { checkDanger, type DangerHit } from "./danger.js";
import { normalizeHost } from "./domain.js";
import { type Entry, entryPath, newEntryId, serializeEntry, today, validateEntry, LIMITS, EntryFormatError } from "./entry.js";
import { scrub } from "./scrub.js";

/** What an agent sends: a new entry, or a correction to an existing one. */
export type Submission = NewSubmission | CorrectionSubmission;

export interface NewSubmission {
  kind: "new";
  /** URL or hostname of the site. */
  site: string;
  title: string;
  appliesWhen?: string;
  body: string;
}

export interface CorrectionSubmission {
  kind: "correction";
  site: string;
  id: string;
  /** Why the existing entry is wrong. Always required. */
  reason: string;
  /** Mark the entry as no longer valid instead of rewriting it. */
  outdated?: boolean;
  title?: string;
  appliesWhen?: string;
  body?: string;
}

/** A submission after scrubbing and screening, ready to be written to the data repo. */
export interface PreparedSubmission {
  kind: Submission["kind"];
  host: string;
  entry: Entry;
  path: string;
  content: string;
  /** Scrub rules that replaced something. */
  scrubbed: string[];
  /** Danger hits with severity "review"; "block" hits make preparation fail. */
  flags: DangerHit[];
  /** Correction reason (scrubbed), for the PR description. */
  reason?: string;
}

export class SubmissionRejectedError extends Error {
  constructor(
    message: string,
    public readonly hits: DangerHit[] = [],
  ) {
    super(message);
    this.name = "SubmissionRejectedError";
  }
}

function scrubField(value: string | undefined, fired: string[]): string | undefined {
  if (value === undefined) return undefined;
  const r = scrub(value.trim());
  fired.push(...r.replaced);
  return r.text;
}

/** For single-line fields (title, applies_when, reason): line breaks become spaces. */
function scrubLine(value: string | undefined, fired: string[]): string | undefined {
  return scrubField(value?.replace(/\s*[\r\n]+\s*/g, " "), fired);
}

function screen(entry: Entry, extra: string | undefined): DangerHit[] {
  const text = [entry.title, entry.appliesWhen, entry.body, entry.outdatedReason, extra].filter(Boolean).join("\n");
  const report = checkDanger(text, entry.host);
  if (report.blocked) {
    throw new SubmissionRejectedError("submission contains dangerous instructions", report.hits);
  }
  return report.hits;
}

/**
 * Scrubs every text field of a raw submission and screens it, without needing
 * the existing entry. The local MCP server runs this before any network calls,
 * then prepares the entry after loading the existing version for corrections.
 */
export function sanitizeSubmission(sub: Submission): { submission: Submission; scrubbed: string[]; flags: DangerHit[] } {
  const host = normalizeHost(sub.site);
  const fired: string[] = [];
  const out: Submission =
    sub.kind === "new"
      ? {
          kind: "new",
          site: host,
          title: scrubLine(sub.title, fired) ?? "",
          body: scrubField(sub.body, fired) ?? "",
          ...(sub.appliesWhen ? { appliesWhen: scrubLine(sub.appliesWhen, fired) } : {}),
        }
      : {
          kind: "correction",
          site: host,
          id: sub.id,
          reason: scrubLine(sub.reason, fired) ?? "",
          ...(sub.outdated ? { outdated: true } : {}),
          ...(sub.title !== undefined ? { title: scrubLine(sub.title, fired) } : {}),
          ...(sub.body !== undefined ? { body: scrubField(sub.body, fired) } : {}),
          ...(sub.appliesWhen !== undefined ? { appliesWhen: scrubLine(sub.appliesWhen, fired) } : {}),
        };
  const text = [out.title, out.appliesWhen, out.body, out.kind === "correction" ? out.reason : undefined]
    .filter(Boolean)
    .join("\n");
  const report = checkDanger(text, host);
  if (report.blocked) throw new SubmissionRejectedError("submission contains dangerous instructions", report.hits);
  return { submission: out, scrubbed: fired, flags: report.hits };
}

export function prepareNew(sub: NewSubmission, now: Date = new Date()): PreparedSubmission {
  const host = normalizeHost(sub.site);
  const fired: string[] = [];
  const entry: Entry = {
    id: newEntryId(now),
    host,
    title: scrubLine(sub.title, fired) ?? "",
    body: scrubField(sub.body, fired) ?? "",
    lastVerified: today(now),
    status: "active",
  };
  const appliesWhen = scrubLine(sub.appliesWhen, fired);
  if (appliesWhen) entry.appliesWhen = appliesWhen;
  validateEntry(entry);
  const flags = screen(entry, undefined);
  const path = entryPath(host, entry.id);
  return { kind: "new", host, entry, path, content: serializeEntry(entry), scrubbed: fired, flags };
}

/**
 * Applies a correction to the entry currently in the repo. `existing` must be
 * the parsed current version of sites/<host>/<id>.md.
 */
export function prepareCorrection(
  sub: CorrectionSubmission,
  existing: Entry,
  now: Date = new Date(),
): PreparedSubmission {
  const host = normalizeHost(sub.site);
  if (existing.host !== host || existing.id !== sub.id) {
    throw new EntryFormatError(`entry ${sub.id} does not belong to ${host}`);
  }
  const fired: string[] = [];
  const reason = scrubLine(sub.reason, fired);
  if (!reason) throw new EntryFormatError("reason is required for a correction");
  if (reason.length > LIMITS.reason) throw new EntryFormatError(`reason is longer than ${LIMITS.reason} characters`);

  const entry: Entry = { ...existing, lastVerified: today(now) };
  if (sub.outdated) {
    entry.status = "outdated";
    entry.outdatedReason = reason;
  } else {
    if (sub.title === undefined && sub.body === undefined && sub.appliesWhen === undefined) {
      throw new EntryFormatError("a correction must either mark the entry outdated or change its title, applies_when or body");
    }
    entry.status = "active";
    delete entry.outdatedReason;
    if (sub.title !== undefined) entry.title = scrubLine(sub.title, fired) ?? "";
    if (sub.body !== undefined) entry.body = scrubField(sub.body, fired) ?? "";
    if (sub.appliesWhen !== undefined) {
      const aw = scrubLine(sub.appliesWhen, fired);
      if (aw) entry.appliesWhen = aw;
      else delete entry.appliesWhen;
    }
  }
  validateEntry(entry);
  const flags = screen(entry, reason);
  return {
    kind: "correction",
    host,
    entry,
    path: entryPath(host, entry.id),
    content: serializeEntry(entry),
    scrubbed: fired,
    flags,
    reason,
  };
}

/** Title and description for the pull request that carries a prepared submission. */
export function describeSubmission(p: PreparedSubmission, clientVersion: string): { title: string; body: string } {
  const verb = p.kind === "new" ? "Add" : p.entry.status === "outdated" ? "Mark outdated" : "Correct";
  const title = `[${p.host}] ${verb}: ${p.entry.title}`.slice(0, 200);
  const lines = [
    `Kind: ${p.kind}`,
    `Host: ${p.host}`,
    `Entry: \`${p.path}\``,
    `Client: sitelore ${clientVersion}`,
  ];
  if (p.reason) lines.push("", "Reason:", "", quote(p.reason));
  if (p.flags.length) {
    lines.push("", "Flagged for review:", "");
    for (const f of p.flags) lines.push(`- ${f.category}: "${f.match}"`);
  }
  if (p.scrubbed.length) lines.push("", `Scrubbed locally: ${[...new Set(p.scrubbed)].join(", ")}`);
  lines.push("", "_Generated by the Sitelore client. Do not edit by hand._");
  return { title, body: lines.join("\n") };
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}
