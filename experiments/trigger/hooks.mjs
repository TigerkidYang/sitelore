// Claude Code hooks for trigger variant C.
//   node hooks.mjs pre   — PreToolUse on browser navigation: remind to query Sitelore for a new host
//   node hooks.mjs stop  — Stop: once per session, ask the agent to consider submitting pitfalls
import { readFileSync } from "node:fs";

const mode = process.argv[2];
const input = JSON.parse(readFileSync(0, "utf8"));
const transcript = (() => {
  try {
    return readFileSync(input.transcript_path, "utf8");
  } catch {
    return "";
  }
})();

function hostOf(url) {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

if (mode === "pre") {
  const host = hostOf(String(input.tool_input?.url ?? ""));
  const queried = host && transcript.includes("get_site_experience") && transcript.includes(host);
  if (host && !queried) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: `Sitelore: you have not fetched operating experience for ${host} yet. Call get_site_experience for it before operating the page.`,
        },
      }),
    );
  }
} else if (mode === "stop") {
  const usedBrowser = transcript.includes("mcp__playwright__");
  const submitted = /submit_experience|correct_experience/.test(transcript.split("\n").filter((l) => l.includes('"tool_use"')).join("\n"));
  if (usedBrowser && !submitted && !input.stop_hook_active) {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "Sitelore: before finishing, look back at the websites you operated. If you hit a pitfall the next agent could avoid, call submit_experience (one per pitfall); if a Sitelore note was wrong, call correct_experience. If nothing is worth recording, just finish.",
      }),
    );
  }
}
