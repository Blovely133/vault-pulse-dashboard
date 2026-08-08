import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function workflow(name) {
  return readFile(path.join(root, ".github", "workflows", name), "utf8");
}

test("the deploy workflow cannot restart the ticker", async () => {
  const pages = await workflow("pages.yml");

  assert.doesNotMatch(pages, /workflow run ticker\.yml/);
  assert.doesNotMatch(pages, /^\s*actions:\s*write\s*$/m);
});

test("the ticker dispatches one refresh on four 15-minute slots", async () => {
  const ticker = await workflow("ticker.yml");

  assert.equal((ticker.match(/workflow run pages\.yml/g) ?? []).length, 1);
  assert.match(ticker, /cron:\s*"9,24,39,54 \* \* \* \*"/);
});

test("the watchdog only recovers a stale refresh", async () => {
  const watchdog = await workflow("refresh-watchdog.yml");

  assert.equal((watchdog.match(/workflow run pages\.yml/g) ?? []).length, 1);
  assert.match(watchdog, /cron:\s*"14,29,44,59 \* \* \* \*"/);
  assert.match(watchdog, /gh run list[^\n]*--workflow pages\.yml/);
  assert.match(watchdog, /select\(\.status != "completed"\)/);
  assert.match(watchdog, /if:\s*steps\.freshness\.outputs\.stale == 'true'/);
  assert.match(
    watchdog,
    /steps\.active_refresh\.outputs\.active != 'true'/,
  );
});
