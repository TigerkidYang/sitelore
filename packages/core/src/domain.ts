import { parse } from "tldts";

export class InvalidHostError extends Error {
  constructor(input: string, reason: string) {
    super(`"${input}" is not a supported site: ${reason}`);
    this.name = "InvalidHostError";
  }
}

/**
 * Turns a URL or bare hostname into the canonical key Sitelore stores entries
 * under: lowercase, punycode, no trailing dot, no leading "www.".
 *
 * Only public sites are accepted. IPs, localhost and hosts without a known
 * public suffix (intranet names like jira.corp.internal) are rejected so that
 * private infrastructure never ends up in the public repo.
 */
export function normalizeHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidHostError(input, "empty");

  let hostname: string;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    hostname = url.hostname;
  } catch {
    throw new InvalidHostError(input, "cannot be parsed as a URL or hostname");
  }

  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);

  const info = parse(hostname, { allowPrivateDomains: true });
  if (info.isIp) throw new InvalidHostError(input, "IP addresses are not supported");
  if (!info.domain || !(info.isIcann || info.isPrivate)) {
    throw new InvalidHostError(input, "not a public domain");
  }
  return hostname;
}

/** The registrable domain ("eTLD+1") of a normalized host, e.g. amazon.com. */
export function registrableDomain(host: string): string {
  const info = parse(host, { allowPrivateDomains: true });
  if (!info.domain) throw new InvalidHostError(host, "no registrable domain");
  return info.domain;
}

/**
 * Hosts whose entries apply to `host`, most specific first:
 * console.aws.amazon.com -> [console.aws.amazon.com, aws.amazon.com, amazon.com]
 */
export function lookupHosts(host: string): string[] {
  const root = registrableDomain(host);
  const hosts = [host];
  let current = host;
  while (current !== root) {
    current = current.slice(current.indexOf(".") + 1);
    hosts.push(current);
  }
  return hosts;
}

/** Whether two hosts belong to the same registrable domain. */
export function sameSite(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}

/** Parses blocklist.txt: one domain per line, "#" comments. */
export function parseBlocklist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim().toLowerCase())
    .filter(Boolean);
}

/** A blocklisted domain covers itself and all its subdomains. */
export function isBlocked(host: string, blocklist: string[]): boolean {
  return blocklist.some((d) => host === d || host.endsWith(`.${d}`));
}
