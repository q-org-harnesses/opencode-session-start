// session-start: runs a harness's Session Start routine from a plugin instead of asking the model to.
// First prompt of a session: run the script once, keep its report, write it to a harness-owned folder
// (or the OS log), and inject it into the session's system context. [no-start], /task and a
// disabled plugin skip all of it.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_TRIGGERS = ["[no-start]", "/task"];
const MARK = "## Session Start (done by the session-start plugin";
const expand = (p) => (typeof p === "string" && p.startsWith("~/") ? homedir() + p.slice(1) : p);

export function shouldSkip(text, triggers = DEFAULT_TRIGGERS) {
  const t = String(text ?? "").trimStart();
  return triggers.some((trigger) => {
    if (!t.startsWith(trigger)) return false;
    if (!trigger.startsWith("/")) return true;
    const next = t[trigger.length];
    return next === undefined || /\s/.test(next);
  });
}

export function defaultDeps() {
  return {
    env: process.env,
    runScript: (opts) =>
      new Promise((resolve, reject) => {
        const [cmd, ...args] = (opts.command ?? ["python3", "~/.config/opencode/session_start.py"]).map(expand);
        execFile(cmd, args, { timeout: opts.timeoutMs ?? 60000, maxBuffer: 1024 * 1024, env: { ...process.env, SESSION_START_NO_WRITE: "1" } }, (err, stdout) => {
          if (err) reject(err); else resolve(String(stdout));
        });
      }),
    logger: (line) =>
      new Promise((resolve) => {
        execFile("logger", ["-t", "session-start", line], () => resolve());
      }),
  };
}

export function createSessionStart(options = {}, deps = defaultDeps()) {
  const opts = { enabled: true, triggers: DEFAULT_TRIGGERS, reportTarget: "harness", ...options };
  const reportDir = expand(opts.reportDir ?? "~/.local/share/opencode/session-start");
  const sessions = new Map();
  const off = () => opts.enabled === false || String(deps.env?.SESSION_START ?? "").toLowerCase() === "off";

  async function store(report, state) {
    if (opts.reportTarget === "syslog") {
      const line = "Session Start: " + report.split("\n").filter(Boolean).slice(0, 4).join(" | ").slice(0, 300);
      try { await deps.logger(line); } catch (e) { state.warnings.push(`log line not written: ${e.message}`); }
      return;
    }
    const blocked = (opts.refusePaths ?? []).find((p) => reportDir.includes(expand(p)));
    if (blocked) { state.warnings.push(`report file not written: reportDir contains the refused path ${blocked}`); return; }
    try {
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(join(reportDir, "session_start_latest.md"), report);
    } catch (e) {
      state.warnings.push(`report file not written: ${e.message}`);
    }
  }

  async function onPrompt(input) {
    try {
      if (off()) return;
      const id = input?.sessionID;
      if (!id || sessions.has(id)) return;
      const state = { skip: shouldSkip(input?.prompt?.text, opts.triggers), report: null, notice: null, warnings: [] };
      sessions.set(id, state);
      if (state.skip) return;
      try {
        state.report = await deps.runScript(opts);
        await store(state.report, state);
      } catch (e) {
        state.notice = `The session-start plugin could not run the Session Start script (${String(e?.message ?? e).split("\n")[0]}). Run it yourself once, now.`;
      }
    } catch { /* never break a prompt */ }
  }

  async function onContext(request) {
    try {
      const state = sessions.get(request?.sessionID);
      if (!state || state.skip || !Array.isArray(request.system)) return;
      if (request.system.some((s) => typeof s?.text === "string" && s.text.startsWith(MARK))) return;
      const body = state.notice
        ? `${MARK}; it failed)\n${state.notice}`
        : `${MARK}; do not run session_start.py yourself)\n${state.report}` +
          (state.warnings.length ? `\n(${state.warnings.join("; ")})` : "");
      request.system.push({ type: "text", text: body });
    } catch { /* never break a request */ }
  }

  return { onPrompt, onContext, sessions };
}
