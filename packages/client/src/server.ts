import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  describeHits,
  filterEntries,
  InvalidHostError,
  lookupHosts,
  normalizeHost,
  renderForAgent,
  SubmissionRejectedError,
  type Entry,
  type Submission,
} from "@sitelore/core";
import { saveConfig, type Config } from "./config.js";
import {
  CORRECT_DESCRIPTION,
  firstRunNotice,
  GET_DESCRIPTION,
  INSTRUCTIONS_READ,
  INSTRUCTIONS_WRITE,
  SUBMIT_DESCRIPTION,
} from "./guidance.js";
import { BundleStore } from "./store.js";
import { submit, type SubmitDeps } from "./submit.js";
import { VERSION } from "./version.js";

export interface ServerOptions {
  config: Config;
  store?: BundleStore;
  submitDeps?: SubmitDeps;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

/** Appends one JSON line per tool call to $SITELORE_EVENT_LOG, used by the trigger experiments. */
function logEvent(event: Record<string, unknown>): void {
  const file = process.env.SITELORE_EVENT_LOG;
  if (!file) return;
  try {
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
  } catch {
    // logging must never break a tool call
  }
}

export function createServer(opts: ServerOptions): McpServer {
  const { config } = opts;
  const store = opts.store ?? new BundleStore(config.bundleSource);
  // Only offer submission tools when there is somewhere for submissions to go;
  // otherwise agents would spend effort summarizing pitfalls that can only fail.
  const canSubmit =
    config.contribute && (config.recordOnly || !!config.intakeUrl || (config.channel !== "intake" && !!config.dataRepo));
  let noticePending = !config.noticeShown && canSubmit && !config.recordOnly;
  /** The first-run notice, attached to whichever tool result comes first (a submission may come first). */
  const takeNotice = (): string => {
    if (!noticePending) return "";
    noticePending = false;
    try {
      saveConfig({ noticeShown: true });
    } catch {
      // not fatal; the notice will just show again next time
    }
    return `${firstRunNotice(config.channel !== "intake")}\n\n---\n\n`;
  };

  const server = new McpServer(
    { name: "sitelore", version: VERSION },
    { instructions: INSTRUCTIONS_READ + (canSubmit ? INSTRUCTIONS_WRITE : "") },
  );

  server.registerTool(
    "get_site_experience",
    {
      title: "Get site experience",
      description: GET_DESCRIPTION,
      inputSchema: { url: z.string().describe("URL or hostname of the site you are about to operate") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      let host: string;
      try {
        host = normalizeHost(url);
      } catch (err) {
        logEvent({ tool: "get_site_experience", url, error: "invalid_host" });
        return text(err instanceof InvalidHostError ? `${err.message}. Sitelore only covers public websites.` : String(err), true);
      }

      if (!config.bundleSource) {
        logEvent({ tool: "get_site_experience", host, error: "not_configured" });
        return text(
          "Sitelore is not configured with a data repository (development build: set SITELORE_DATA_REPO or SITELORE_BUNDLES). Continue without it.",
        );
      }

      let groups: { host: string; entries: Entry[] }[] = [];
      let dropped = 0;
      try {
        const known = await store.hosts();
        for (const h of lookupHosts(host)) {
          if (!known.has(h)) continue;
          const bundle = await store.bundle(h);
          if (!bundle) continue;
          // Screen against the host we asked for, not whatever the downloaded bundle claims.
          const f = filterEntries(bundle.entries.map((e) => ({ ...e, host: h })));
          dropped += f.dropped;
          groups.push({ host: h, entries: f.kept });
        }
      } catch (err) {
        logEvent({ tool: "get_site_experience", host, error: String(err) });
        return text(`Could not reach the Sitelore library (${(err as Error).message}). Continue without it.`);
      }

      const count = groups.reduce((n, g) => n + g.entries.filter((e) => e.status === "active").length, 0);
      logEvent({ tool: "get_site_experience", host, entries: count });
      return text(takeNotice() + renderForAgent(host, groups, dropped));
    },
  );

  if (!canSubmit) return server;

  const handleSubmit = async (tool: string, sub: Submission): Promise<ToolResult> => {
    try {
      const r = await submit(sub, config, opts.submitDeps);
      logEvent({ tool, kind: sub.kind, site: sub.site, channel: r.channel, location: r.location, flags: r.flags.length });
      const lines = [
        r.channel === "record"
          ? `Recorded locally (record-only mode): ${r.location}`
          : `Submitted for review: ${r.location}`,
      ];
      if (r.scrubbed.length) lines.push(`Personal data was scrubbed before upload (${[...new Set(r.scrubbed)].join(", ")}).`);
      if (r.flags.length) lines.push("Parts of it were flagged for reviewer attention:\n" + describeHits(r.flags));
      if (r.note) lines.push(r.note);
      return text(takeNotice() + lines.join("\n"));
    } catch (err) {
      logEvent({ tool, kind: sub.kind, site: sub.site, error: (err as Error).message });
      if (err instanceof SubmissionRejectedError) {
        return text(
          `Rejected: the entry looks like it instructs dangerous actions.\n${describeHits(err.hits)}\n` +
            "If the pitfall is still worth sharing, rewrite it without these parts (for example, say that the flow continues on a sign-in page instead of naming another domain). Otherwise skip it.",
          true,
        );
      }
      return text(`Submission failed: ${(err as Error).message}`, true);
    }
  };

  server.registerTool(
    "submit_experience",
    {
      title: "Submit site experience",
      description: SUBMIT_DESCRIPTION,
      inputSchema: {
        url: z.string().describe("URL or hostname of the site the experience is about"),
        title: z.string().describe("One-line summary of the pitfall, e.g. 'Departure date field only accepts typed input'"),
        body: z.string().describe("What goes wrong and what works instead. Plain text, a few sentences."),
        applies_when: z
          .string()
          .optional()
          .describe("Conditions under which this holds, if they matter: login state, region, UI language, page version"),
      },
      annotations: { openWorldHint: true },
    },
    ({ url, title, body, applies_when }) =>
      handleSubmit("submit_experience", { kind: "new", site: url, title, body, appliesWhen: applies_when }),
  );

  server.registerTool(
    "correct_experience",
    {
      title: "Correct site experience",
      description: CORRECT_DESCRIPTION,
      inputSchema: {
        url: z.string().describe("URL or hostname of the site the entry belongs to"),
        id: z.string().describe("Entry id, as shown by get_site_experience"),
        reason: z.string().describe("What you observed that contradicts the entry"),
        outdated: z.boolean().optional().describe("true to mark the entry as no longer valid instead of rewriting it"),
        title: z.string().optional().describe("Corrected title"),
        body: z.string().optional().describe("Corrected body"),
        applies_when: z.string().optional().describe("Corrected applicability conditions"),
      },
      annotations: { openWorldHint: true },
    },
    ({ url, id, reason, outdated, title, body, applies_when }) =>
      handleSubmit("correct_experience", {
        kind: "correction",
        site: url,
        id,
        reason,
        outdated,
        title,
        body,
        appliesWhen: applies_when,
      }),
  );

  return server;
}
