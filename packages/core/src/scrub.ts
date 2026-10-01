import { stripInvisible } from "./normalize.js";

/**
 * Rule-based PII / secret removal, run locally before anything is uploaded and
 * again by the intake service and the data-repo checks.
 *
 * Matches are replaced with placeholders rather than rejected, so a useful
 * entry that happens to mention an order number still gets through. Scrubbing
 * is idempotent: already-scrubbed text produces no further replacements, which
 * is what the data-repo check relies on.
 */

export interface ScrubResult {
  text: string;
  /** Rule names that fired, one per replacement. */
  replaced: string[];
}

interface Rule {
  name: string;
  pattern: RegExp;
  replace: string | ((match: string, ...groups: (string | undefined)[]) => string);
}

// Order matters: specific secret formats before generic long-number / long-hex rules.
const RULES: Rule[] = [
  {
    name: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: "[PRIVATE_KEY]",
  },
  { name: "jwt", pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, replace: "[TOKEN]" },
  {
    name: "api_key",
    pattern:
      /\b(?:sk-[\w-]{16,}|sk_(?:live|test)_\w{16,}|pk_(?:live|test)_\w{16,}|gh[pousr]_\w{30,}|github_pat_\w{30,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|glpat-[\w-]{20,})/g,
    replace: "[TOKEN]",
  },
  {
    name: "auth_header",
    pattern: /\b(Bearer|Basic|token)\s+(?!\[)[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: (_m, scheme) => `${scheme} [TOKEN]`,
  },
  {
    name: "secret_assignment",
    // The value must look like a secret (has a digit, or is long), so "Session: expires after 15 minutes" survives.
    pattern:
      /\b(password|passwd|pwd|secret|token|api[_-]?key|session(?:id)?|cookie|密码|口令)(\s*[:=：]\s*)("[^"]+"|'[^']+'|(?!\[)(?=\S*\d|\S{12,})\S+)/gi,
    replace: (_m, key, sep) => `${key}${sep}[REDACTED]`,
  },
  {
    name: "url_query",
    // Keep the path shape (useful), drop query strings and fragments (often carry ids/tokens).
    pattern: /(\bhttps?:\/\/[^\s?#"'<>)）]+)[?#](?!\[QUERY\])[^\s"'<>)）]*/gi,
    replace: (_m, base) => `${base}?[QUERY]`,
  },
  {
    name: "url_query",
    // Same for URLs written without a scheme: shop.example.com/orders?id=883
    pattern: /(\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s?#"'<>)）]*)[?#](?!\[QUERY\])[^\s"'<>)）]*/gi,
    replace: (_m, base) => `${base}?[QUERY]`,
  },
  {
    name: "path_user",
    // Usernames in profile-style paths: /users/jsmith/settings, /@jsmith
    pattern: /(\/(?:users?|u|profiles?|people|~))\/(?!\[)[^\s/?#"'<>)）]+|\/@(?!\[)[\w.-]+/gi,
    replace: (_m, prefix) => (prefix ? `${prefix}/[USER]` : "/@[USER]"),
  },
  {
    name: "email",
    pattern: /[A-Za-z0-9._%+-]+\s?[@＠]\s?[A-Za-z0-9.-]+[.．][A-Za-z]{2,}\b/g,
    replace: "[EMAIL]",
  },
  { name: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replace: "[ID]" },
  { name: "ipv4", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, replace: "[IP]" },
  // Mainland China mobile numbers, with optional +86.
  { name: "phone", pattern: /(?:\+?86[\s-]?)?(?<!\d)1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, replace: "[PHONE]" },
  // International numbers written with a leading +country code.
  { name: "phone", pattern: /(?<![\w+])\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,4}(?!\d)/g, replace: "[PHONE]" },
  // North American formats: (415) 555-2671, 415.555.2671, 415-555-2671
  { name: "phone", pattern: /(?<![\d.-])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d.-])/g, replace: "[PHONE]" },
  {
    name: "labeled_code",
    // Labeled booking / ticket / order codes: "PNR ABC12D", "订单号：A1B2C3D"
    pattern:
      /\b(PNR|booking (?:ref(?:erence)?|code|number)|confirmation (?:code|number)|reservation (?:code|number)|ticket(?: number)?|order(?: number| id)?|case(?: number)?)(\s*[:：#]?\s*)(?!\[)(?=[A-Za-z-]*\d)([A-Za-z0-9-]{5,})|(订单号?|预订号|确认号|工单号?|单号|取票号)(\s*[:：#]?\s*)(?!\[)(?=[A-Za-z-]*\d)([A-Za-z0-9-]{5,})/gi,
    replace: (_m, l1, s1, _v1, l2, s2) => `${l1 ?? l2}${s1 ?? s2}[ID]`,
  },
  // Ticket-system style ids: INC0012345
  { name: "code_id", pattern: /\b[A-Z]{2,5}\d{5,}\b/g, replace: "[ID]" },
  // Long hex / base64-ish blobs: session ids, hashes, tokens without a known prefix.
  { name: "long_hex", pattern: /\b[0-9a-f]{24,}\b/gi, replace: "[TOKEN]" },
  {
    name: "long_token",
    pattern: /(?<![\w/.-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![\w/.-])/g,
    replace: "[TOKEN]",
  },
  // Path segments that look like record ids, e.g. /orders/839201/ -> /orders/[ID]/
  {
    name: "path_id",
    pattern: /(\/)(\d{4,}|[0-9a-f]{12,}|[A-Za-z0-9]*\d[A-Za-z0-9]*\d[A-Za-z0-9]{6,})(?=[/\s?#"'<>)）]|$)/g,
    replace: (_m, slash) => `${slash}[ID]`,
  },
  // Order numbers, card numbers, ID card numbers, account numbers: any run of 8+ digits.
  { name: "long_number", pattern: /(?<![\d.-])(?!\d{4}-\d{2}-\d{2}(?!\d))\d(?:[\s-]?\d){7,}[\dXx]?(?![\d.])/g, replace: "[NUMBER]" },
];

export function scrub(input: string): ScrubResult {
  // Invisible characters can split a match ("jsmith@gm​ail.com"); they have no place in an entry anyway.
  let text = stripInvisible(input);
  const replaced: string[] = text === input ? [] : ["invisible_chars"];
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      replaced.push(rule.name);
      const match = args[0] as string;
      // args = [match, ...groups, offset, input]; none of the patterns use named groups.
      const groups = args.slice(1, -2) as (string | undefined)[];
      return typeof rule.replace === "string" ? rule.replace : rule.replace(match, ...groups);
    });
  }
  return { text, replaced };
}
