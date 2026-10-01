/**
 * Text normalization applied before PII scrubbing and danger screening, so
 * that look-alike characters and invisible characters cannot hide a match.
 */

// Invisible / formatting characters: zero-width spaces and joiners, soft hyphen, bidi controls, BOM...
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}᠎ㅤﾠ]/gu;

// Common Cyrillic and Greek letters that look like Latin ones.
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", і: "i", ј: "j", ԁ: "d", ӏ: "l", ԛ: "q", ԝ: "w",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", Ѕ: "S", І: "I", Ј: "J",
  α: "a", ο: "o", ρ: "p", τ: "t", υ: "u", ν: "v", ι: "i", κ: "k", ε: "e",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

export function hasInvisibleChars(text: string): boolean {
  INVISIBLE.lastIndex = 0;
  return INVISIBLE.test(text);
}

/**
 * Canonical form for matching (never stored): NFKC (full-width letters, digits,
 * "＠" and "．" become ASCII), invisible characters removed, Latin look-alikes
 * mapped to Latin, defanged dots ("evil[.]com", "evil。com") turned into dots.
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c)
    .replace(/\s*[[(（【]\s*(?:\.|。|dot|点)\s*[\])）】]\s*/gi, ".")
    .replace(/(?<=[A-Za-z0-9-])[。｡](?=[A-Za-z0-9])/g, ".");
}

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}
