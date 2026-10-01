import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { hasInvisibleChars } from "./normalize.js";

export type EntryStatus = "active" | "outdated";

/**
 * One piece of operating experience for one host. The body is free text meant
 * for a model to read; the frontmatter fields are deliberately few.
 */
export interface Entry {
  id: string;
  host: string;
  title: string;
  /** Free-text conditions under which the entry holds (login state, region, language...). */
  appliesWhen?: string;
  /** YYYY-MM-DD */
  lastVerified: string;
  status: EntryStatus;
  /** Why the entry was marked outdated. */
  outdatedReason?: string;
  body: string;
}

export const LIMITS = {
  title: 120,
  appliesWhen: 300,
  body: 4000,
  reason: 500,
} as const;

export class EntryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntryFormatError";
  }
}

const ID_RE = /^[0-9A-Z]{10,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function entryPath(host: string, id: string): string {
  return `sites/${host}/${id}.md`;
}

/** Parses `sites/<host>/<id>.md` into its host and id, or returns null. */
export function parseEntryPath(path: string): { host: string; id: string } | null {
  const m = /^sites\/([^/]+)\/([^/]+)\.md$/.exec(path.replace(/\\/g, "/"));
  return m ? { host: m[1]!, id: m[2]! } : null;
}

/** Checks field presence, types and length limits. Throws EntryFormatError. */
export function validateEntry(entry: Entry): void {
  const problems: string[] = [];
  if (!ID_RE.test(entry.id)) problems.push(`id "${entry.id}" must be 10-32 uppercase letters/digits`);
  if (!entry.host) problems.push("host is required");
  checkText("title", entry.title, LIMITS.title, true, problems);
  checkText("applies_when", entry.appliesWhen, LIMITS.appliesWhen, false, problems);
  // Single-line fields: a newline could forge headings in the text rendered for agents.
  for (const [name, value] of [
    ["title", entry.title],
    ["applies_when", entry.appliesWhen],
    ["outdated_reason", entry.outdatedReason],
  ] as const) {
    if (value && /[\r\n]/.test(value)) problems.push(`${name} must be a single line`);
  }
  const all = [entry.title, entry.appliesWhen, entry.body, entry.outdatedReason].join("");
  if (hasInvisibleChars(all)) problems.push("text contains invisible or formatting characters");
  checkText("body", entry.body, LIMITS.body, true, problems);
  if (!DATE_RE.test(entry.lastVerified)) problems.push("last_verified must be YYYY-MM-DD");
  if (entry.status !== "active" && entry.status !== "outdated") {
    problems.push(`status must be "active" or "outdated"`);
  }
  if (entry.status === "outdated") {
    checkText("outdated_reason", entry.outdatedReason, LIMITS.reason, true, problems);
  }
  if (problems.length) throw new EntryFormatError(problems.join("; "));
}

function checkText(
  name: string,
  value: string | undefined,
  max: number,
  required: boolean,
  problems: string[],
): void {
  if (value === undefined || value === "") {
    if (required) problems.push(`${name} is required`);
    return;
  }
  if (typeof value !== "string") {
    problems.push(`${name} must be text`);
    return;
  }
  if (!value.trim()) problems.push(`${name} must not be blank`);
  if (value.length > max) problems.push(`${name} is longer than ${max} characters`);
}

export function serializeEntry(entry: Entry): string {
  validateEntry(entry);
  const front: Record<string, string> = { id: entry.id, title: entry.title };
  if (entry.appliesWhen) front.applies_when = entry.appliesWhen;
  front.last_verified = entry.lastVerified;
  front.status = entry.status;
  if (entry.outdatedReason) front.outdated_reason = entry.outdatedReason;
  const yaml = stringifyYaml(front, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${entry.body.trim()}\n`;
}

export function parseEntry(host: string, source: string): Entry {
  const text = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new EntryFormatError("missing --- frontmatter block");

  let front: unknown;
  try {
    front = parseYaml(m[1]!);
  } catch (err) {
    throw new EntryFormatError(`frontmatter is not valid YAML: ${(err as Error).message}`);
  }
  if (!front || typeof front !== "object" || Array.isArray(front)) {
    throw new EntryFormatError("frontmatter must be a mapping");
  }
  const f = front as Record<string, unknown>;
  const known = new Set(["id", "title", "applies_when", "last_verified", "status", "outdated_reason"]);
  const unknown = Object.keys(f).filter((k) => !known.has(k));
  if (unknown.length) throw new EntryFormatError(`unknown frontmatter fields: ${unknown.join(", ")}`);

  const entry: Entry = {
    id: asString(f.id),
    host,
    title: asString(f.title),
    lastVerified: asString(f.last_verified),
    status: asString(f.status) as EntryStatus,
    body: m[2]!.trim(),
  };
  if (f.applies_when !== undefined) entry.appliesWhen = asString(f.applies_when);
  if (f.outdated_reason !== undefined) entry.outdatedReason = asString(f.outdated_reason);
  validateEntry(entry);
  return entry;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  // YAML turns unquoted dates into Date objects.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Crockford-style base32 id: 10 chars of time + 6 random, sortable by creation. */
export function newEntryId(now: Date = new Date()): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = now.getTime();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = alphabet[time % 32] + out;
    time = Math.floor(time / 32);
  }
  const random = new Uint8Array(6);
  crypto.getRandomValues(random);
  for (const byte of random) out += alphabet[byte % 32];
  return out;
}

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
