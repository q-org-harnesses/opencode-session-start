import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldSkip, createSessionStart, DEFAULT_TRIGGERS } from "../session-start.js";

const REPORT = "# Session Start, test\n\n## 1. Inbox\n- empty\n";
function make(over = {}) {
  const calls = { run: 0, logger: [], warn: [] };
  const dir = mkdtempSync(join(tmpdir(), "ss-"));
  const deps = {
    runScript: async () => { calls.run++; return REPORT; },
    logger: async (line) => { calls.logger.push(line); },
    env: {},
    ...over.deps,
  };
  const ss = createSessionStart({ reportDir: dir, ...over.opts }, deps);
  return { ss, calls, dir };
}
const prompt = (sessionID, text) => ({ sessionID, prompt: { text } });
const req = (sessionID) => ({ sessionID, system: [{ type: "text", text: "base" }], messages: [] });

test("shouldSkip: marker prefix, commands, not mid-text", () => {
  assert.equal(shouldSkip("[no-start] do it", DEFAULT_TRIGGERS), true);
  assert.equal(shouldSkip("  [no-start]\ndo it", DEFAULT_TRIGGERS), true);
  assert.equal(shouldSkip("/task build x", DEFAULT_TRIGGERS), true);
  assert.equal(shouldSkip("please mention [no-start] in the docs", DEFAULT_TRIGGERS), false);
  assert.equal(shouldSkip("hello", DEFAULT_TRIGGERS), false);
  assert.equal(shouldSkip("/plan x", ["[no-start]", "/task"]), false);
  assert.equal(shouldSkip("/plan x", ["[no-start]", "/task", "/plan"]), true);
});

test("first prompt runs the script once per session; a new session runs again", async () => {
  const { ss, calls } = make();
  await ss.onPrompt(prompt("a", "hi"));
  await ss.onPrompt(prompt("a", "again"));
  assert.equal(calls.run, 1);
  await ss.onPrompt(prompt("b", "hi"));
  assert.equal(calls.run, 2);
});

test("a skip trigger runs nothing and injects nothing", async () => {
  const { ss, calls } = make();
  await ss.onPrompt(prompt("a", "[no-start] work"));
  const r = req("a"); await ss.onContext(r);
  assert.equal(calls.run, 0);
  assert.equal(r.system.length, 1);
});

test("context hook injects the report once per request, every request", async () => {
  const { ss } = make();
  await ss.onPrompt(prompt("a", "hi"));
  const r = req("a"); await ss.onContext(r); await ss.onContext(r);
  assert.equal(r.system.length, 2);
  assert.match(r.system[1].text, /Session Start, test/);
  assert.match(r.system[1].text, /do not run session_start\.py yourself/i);
  const r2 = req("a"); await ss.onContext(r2);
  assert.equal(r2.system.length, 2);
});

test("disabled by option and by environment", async () => {
  for (const over of [{ opts: { enabled: false } }, { deps: { env: { SESSION_START: "off" } } }]) {
    const { ss, calls } = make(over);
    await ss.onPrompt(prompt("a", "hi"));
    const r = req("a"); await ss.onContext(r);
    assert.equal(calls.run, 0);
    assert.equal(r.system.length, 1);
  }
});

test("a failing script injects a one-line notice and never throws", async () => {
  const { ss } = make({ deps: { runScript: async () => { throw new Error("boom"); } } });
  await ss.onPrompt(prompt("a", "hi"));
  const r = req("a"); await ss.onContext(r);
  assert.match(r.system[1].text, /could not run/i);
  assert.match(r.system[1].text, /boom/);
});

test("harness target writes the report to reportDir, not the vault", async () => {
  const { ss, dir } = make();
  await ss.onPrompt(prompt("a", "hi"));
  assert.equal(readFileSync(join(dir, "session_start_latest.md"), "utf8"), REPORT);
});

test("a reportDir containing a refused path is refused: no file written, report still injected", async () => {
  const { ss, calls } = make({ opts: { reportDir: "/srv/notes-vault/agent/reports", refusePaths: ["/notes-vault/"] } });
  await ss.onPrompt(prompt("a", "hi"));
  const r = req("a"); await ss.onContext(r);
  assert.equal(existsSync("/srv/notes-vault/agent/reports/session_start_latest.md"), false);
  assert.match(r.system[1].text, /Session Start, test/);
  assert.match(r.system[1].text, /report file not written/i);
  assert.equal(calls.run, 1);
});

test("syslog target logs one line and writes no file", async () => {
  const { ss, calls, dir } = make({ opts: { reportTarget: "syslog" } });
  await ss.onPrompt(prompt("a", "hi"));
  assert.equal(calls.logger.length, 1);
  assert.match(calls.logger[0], /Session Start/);
  assert.equal(readdirSync(dir).length, 0);
});

test("an unwritable reportDir warns but still injects the report", async () => {
  const { ss } = make({ opts: { reportDir: "/dev/null/nope" } });
  await ss.onPrompt(prompt("a", "hi"));
  const r = req("a"); await ss.onContext(r);
  assert.match(r.system[1].text, /Session Start, test/);
  assert.match(r.system[1].text, /report file not written/i);
});

test("the setup function registers prompt and context hooks", async () => {
  const mod = (await import("../index.js")).default;
  const hooks = [];
  await mod.setup({ options: {}, session: { hook: async (n, fn) => { hooks.push(n); return () => {}; } } });
  assert.deepEqual(hooks.sort(), ["context", "prompt"]);
});

test("the default runner returns the script's stdout and enforces the timeout", async () => {
  const { defaultDeps } = await import("../session-start.js");
  const d = defaultDeps();
  const out = await d.runScript({ command: ["node", "-e", "console.log('hello')"] });
  assert.equal(out.trim(), "hello");
  await assert.rejects(d.runScript({ command: ["node", "-e", "setTimeout(()=>{},5000)"], timeoutMs: 300 }));
});
