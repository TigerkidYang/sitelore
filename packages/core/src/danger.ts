import { parse } from "tldts";
import { registrableDomain } from "./domain.js";
import { normalizeForMatching } from "./normalize.js";

/**
 * Rule-based screening for entries that could cause serious harm if an agent
 * followed them. Runs before submission, in the intake service, in the
 * data-repo checks, and again client-side before entries reach an agent.
 *
 * Rules on free text will always miss things and misfire sometimes. "block"
 * rules are kept narrow enough that a legitimate entry rarely trips them;
 * "review" rules only flag an entry for the human/model reviewer.
 */

export type DangerCategory =
  | "cross_domain"
  | "credential_sharing"
  | "credential_input"
  | "payment_input"
  | "account_security"
  | "permission_grant"
  | "download_execute"
  | "skip_confirmation"
  | "extra_purchase"
  | "anti_bot"
  | "prompt_injection";

export type Severity = "block" | "review";

export interface DangerHit {
  category: DangerCategory;
  severity: Severity;
  match: string;
}

export interface DangerReport {
  blocked: boolean;
  hits: DangerHit[];
}

// A gap that stays inside one clause: no sentence terminators or newlines.
const gap = (n: number) => `[^。！？!?；;\\n]{0,${n}}`;
const near = (a: string, b: string, n: number) => new RegExp(`(?:${a})${gap(n)}(?:${b})`, "i");

const CREDENTIAL = "密码|口令|验证码|动态码|短信码|校验码|password|passcode|otp|one[- ]time (?:code|password)|verification code|2fa code|security code";
const PAYMENT = "银行卡号|信用卡号|卡号|cvv|cvc|安全码|支付密码|有效期|card number|credit card|cvv|cvc|expiry date|expiration date|iban|routing number";
const ACCOUNT_FIELD =
  "密码|登录邮箱|绑定邮箱|邮箱地址|绑定手机|手机号|两步验证|二次验证|双重验证|二步验证|双因素|密保|安全问题|找回方式|恢复邮箱|通行密钥|password|email address|recovery (?:email|phone|code)s?|phone number|two[- ]factor|2fa|mfa|security questions?|passkeys?|authenticator";

interface Rule {
  category: DangerCategory;
  severity: Severity;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    category: "credential_sharing",
    severity: "block",
    pattern: near(
      "发送|发给|发到|告诉|粘贴到|复制到|提交到|分享|转发|send|paste|share|forward|post|tell",
      CREDENTIAL,
      15,
    ),
  },
  {
    category: "credential_sharing",
    severity: "block",
    pattern: near(CREDENTIAL, "发送到|发给|发到|告诉|粘贴到|复制到|分享给|转发|send (?:it )?to|paste (?:it )?into|share (?:it )?with|forward (?:it )?to", 12),
  },
  {
    category: "payment_input",
    severity: "block",
    pattern: near("输入|填写|填入|键入|提供|enter|type|fill in|provide|input", PAYMENT, 12),
  },
  {
    category: "credential_input",
    severity: "review",
    pattern: near("输入|填写|填入|键入|enter|type|fill in|input", CREDENTIAL, 10),
  },
  {
    category: "account_security",
    severity: "block",
    pattern: near(
      "修改|更改|更换|重置|关闭|停用|禁用|解绑|移除|删除|改成|改为|change|reset|update|disable|turn off|remove|replace",
      ACCOUNT_FIELD,
      12,
    ),
  },
  {
    // Consenting to a third-party app getting at the user's account.
    category: "permission_grant",
    severity: "block",
    pattern: near(
      "同意|允许|授予|批准|接受|点击|accept|allow|grant|approve|authorize|authorise|click",
      "oauth|第三方应用|访问你的|访问您的|access to your|third[- ]party app",
      30,
    ),
  },
  {
    // Could be the user's actual task (e.g. configuring IAM in a cloud console), so only flag it.
    category: "permission_grant",
    severity: "review",
    pattern: near("同意|允许|授予|批准|accept|allow|grant|approve|authorize|authorise", "授权|权限|permissions?|authori[sz]ation|scopes?", 12),
  },
  {
    category: "download_execute",
    severity: "block",
    pattern: near("下载|download", "运行|执行|打开|安装|双击|run|execute|open|install|launch", 20),
  },
  {
    category: "download_execute",
    severity: "block",
    pattern: /\.(?:exe|msi|dmg|pkg|apk|bat|cmd|ps1|scr|jar|vbs|deb|rpm|appimage)\b/i,
  },
  {
    category: "download_execute",
    severity: "block",
    pattern: near("运行|执行|粘贴|run|execute|paste", "命令|脚本|终端|控制台|commands?|scripts?|terminal|powershell|console", 10),
  },
  {
    category: "skip_confirmation",
    severity: "block",
    pattern: near(
      "忽略|跳过|无视|绕过|不理|ignore|skip|bypass|disregard",
      "确认|二次确认|警告|安全提示|风险提示|confirmations?|confirm dialogs?|warnings?|security (?:alert|prompt|notice)s?",
      8,
    ),
  },
  {
    category: "skip_confirmation",
    severity: "block",
    pattern: /(?:不要|无需|不必|别|不用)[^。！？!?；;\n]{0,6}(?:告诉|通知|询问|征求|确认)[^。！？!?；;\n]{0,4}用户|without (?:asking|telling|notifying|confirming with|checking with) the user/i,
  },
  {
    category: "extra_purchase",
    severity: "block",
    pattern: near(
      "额外|顺便|另外|同时|再加|also|additionally|extra|as well",
      "购买|下单|订阅|加购|付费|充值|buy|purchase|subscribe|order",
      10,
    ),
  },
  {
    category: "extra_purchase",
    severity: "review",
    pattern: /(?:(?<!取消|不要|别|不)勾选|(?<!un)\bcheck\b|\benable\b|\bselect\b)[^。！？!?；;\n]{0,10}(?:自动续费|自动续订|会员|保险|auto[- ]?renew|subscription|premium|insurance)/i,
  },
  {
    category: "anti_bot",
    severity: "block",
    pattern: near(
      "验证码|人机验证|滑块|captcha|recaptcha|hcaptcha|turnstile|风控|反爬|bot detection|anti[- ]bot|cloudflare challenge",
      "绕过|跳过|破解|规避|bypass|solve|skip|evade|get around|circumvent",
      15,
    ),
  },
  {
    category: "anti_bot",
    severity: "block",
    pattern: near(
      "绕过|跳过|破解|规避|bypass|solve|skip|evade|get around|circumvent",
      "验证码|人机验证|滑块|captcha|recaptcha|hcaptcha|turnstile|风控|反爬|bot detection|anti[- ]bot",
      10,
    ),
  },
  {
    category: "anti_bot",
    severity: "block",
    pattern: /住宅代理|代理池|指纹浏览器|residential prox|rotating prox|fingerprint spoof|spoof(?:ing)? (?:the )?(?:user[- ]agent|fingerprint)|伪造[^。\n]{0,6}(?:ua|user-agent|指纹)|stealth plugin|undetected[- ]chromedriver/i,
  },
  {
    category: "prompt_injection",
    severity: "block",
    pattern: near(
      "ignore|disregard|forget|override",
      `(?:previous|prior|above|earlier|system|all|any|your)${gap(12)}(?:instructions?|prompts?|rules?|messages?|guidelines?)`,
      20,
    ),
  },
  {
    category: "prompt_injection",
    severity: "block",
    pattern: near("忽略|无视|忘记|覆盖|不要遵守", `(?:之前|以上|前面|上面|系统|所有|你的)${gap(6)}(?:指令|指示|提示词|规则|说明|要求)`, 10),
  },
  {
    category: "prompt_injection",
    severity: "block",
    pattern: /\byou are now\b|\bsystem prompt\b|系统提示词|<\/?(?:system|assistant|user|instructions?)>|\bnew instructions\b|新的指令/i,
  },
];

const ASCII_HOST_RE = /(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62})(?![\w-]|\()/gi;
// Internationalized hostnames (例え.jp). Labels may be any letters; the TLD must be ASCII or punycode.
const UNICODE_HOST_RE = /(?:https?:\/\/)?((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+))(?![\p{L}\p{N}_-])/giu;
const IP_URL_RE = /https?:\/\/(?:\d{1,3}(?:\.\d{1,3}){3}|0x[0-9a-f]+|\d{6,}|\[[0-9a-f:.]+\])/gi;

function crossDomainHits(text: string, host: string): DangerHit[] {
  const ownSite = registrableDomain(host);
  const hits: DangerHit[] = [];
  const seen = new Set<string>();
  const consider = (candidate: string, match: string) => {
    let ascii: string;
    try {
      ascii = new URL(`https://${candidate}`).hostname;
    } catch {
      return;
    }
    const info = parse(ascii, { allowPrivateDomains: true });
    if (!info.domain || !(info.isIcann || info.isPrivate)) return;
    if (info.domain === ownSite || seen.has(match)) return;
    seen.add(match);
    hits.push({ category: "cross_domain", severity: "block", match });
  };
  for (const m of text.matchAll(ASCII_HOST_RE)) consider(m[1]!, m[0]);
  for (const m of text.matchAll(UNICODE_HOST_RE)) if (/[^ -~]/.test(m[1]!)) consider(m[1]!, m[0]);
  for (const m of text.matchAll(IP_URL_RE)) hits.push({ category: "cross_domain", severity: "block", match: m[0] });
  return hits;
}

// A negation right before the bypass verb, e.g. "did not attempt to solve the CAPTCHA", "没有尝试绕过".
const NEGATED_BYPASS =
  /(?:\bnot|n't|\bnever|\bwithout|\bcannot|没有|没|不要|不能|无法|别|未)[^。！？!?；;\n]{0,12}(?:绕过|跳过|破解|规避|bypass|solve|skip|evade|get around|circumvent)[^。！？!?；;\n]{0,25}$/i;

/** Screens the text of an entry that applies to `host`. */
export function checkDanger(text: string, host: string): DangerReport {
  const normalized = normalizeForMatching(text);
  const hits = crossDomainHits(normalized, host);
  // Also match across line breaks, so "Send\nthe code to..." is not split into harmless halves.
  const joined = normalized.replace(/\s*\n\s*/g, " ");
  for (const rule of RULES) {
    for (const source of [normalized, joined]) {
      const m = rule.pattern.exec(source);
      if (!m) continue;
      // "did not attempt to solve the CAPTCHA" reports a dead end; it does not teach a bypass.
      if (rule.category === "anti_bot" && NEGATED_BYPASS.test(source.slice(Math.max(0, m.index - 30), m.index + m[0].length))) continue;
      hits.push({ category: rule.category, severity: rule.severity, match: m[0] });
      break;
    }
  }
  return { blocked: hits.some((h) => h.severity === "block"), hits };
}

const CATEGORY_LABELS: Record<DangerCategory, string> = {
  cross_domain: "mentions another site's domain (sending data to or navigating to other domains is not allowed)",
  credential_sharing: "tells the agent to send or share passwords/verification codes",
  credential_input: "involves entering passwords or verification codes",
  payment_input: "involves entering payment details",
  account_security: "changes account credentials, email/phone, 2FA or recovery settings",
  permission_grant: "grants OAuth authorization or permissions",
  download_execute: "downloads or runs files, scripts or commands",
  skip_confirmation: "skips confirmations/warnings or acting without the user",
  extra_purchase: "makes extra purchases or subscriptions",
  anti_bot: "bypasses CAPTCHAs, anti-bot or risk controls",
  prompt_injection: "contains instructions aimed at overriding the agent's instructions",
};

export function describeHits(hits: DangerHit[]): string {
  return hits.map((h) => `- ${CATEGORY_LABELS[h.category]} (${h.severity}): "${h.match}"`).join("\n");
}
