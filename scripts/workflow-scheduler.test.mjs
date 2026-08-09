import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function workflow(name) {
  return readFile(path.join(root, ".github", "workflows", name), "utf8");
}

async function exists(name) {
  try {
    await access(path.join(root, ".github", "workflows", name));
    return true;
  } catch {
    return false;
  }
}

test("the deploy workflow cannot restart the ticker", async () => {
  const pages = await workflow("pages.yml");

  assert.doesNotMatch(pages, /workflow run ticker\.yml/);
  assert.doesNotMatch(pages, /^\s*actions:\s*write\s*$/m);
});

// THE CLOCK LEFT THIS REPO ON 2026-08-09, AND THIS TEST IS WHY IT STAYS GONE.
//
// `ticker.yml` used to ask GitHub's scheduler four times an hour to dispatch
// pages.yml. It was deleted because the scheduler does not deliver: measured
// here, roughly 40% of slots landed, so a dashboard promising a 15-minute
// refresh showed numbers 20-50 minutes old. The refresh is now driven by a
// systemd timer on ops-box (`vault-pulse-tick`, OnCalendar=*:0/15,
// AccuracySec=1s, Persistent=true), which is not subject to that loss.
//
// The failure this guards against is somebody noticing "nothing in this repo
// refreshes the dashboard" and helpfully re-adding a cron. That would restore
// the exact duplication we just removed: on 2026-08-09T13:30:02Z the box timer
// and a second ticker both dispatched pages.yml in the same second.
//
// If you are here because you want the clock back in this repo, the thing to
// change is the box timer, not this test.
test("no scheduled trigger in this repo drives the refresh", async () => {
  assert.equal(
    await exists("ticker.yml"),
    false,
    "ticker.yml is deleted on purpose - the 15-minute clock is vault-pulse-tick on ops-box",
  );

  const pages = await workflow("pages.yml");
  assert.doesNotMatch(
    pages,
    /^\s*schedule:\s*$/m,
    "pages.yml must stay dispatch-only; it is the worker, not the clock",
  );
});

// The watchdog is the ONE scheduled trigger left, and that is deliberate.
// While the primary was also a GitHub cron this was not really a guard - a
// guard that runs on the mechanism it guards fails with it. Now that the
// primary is a box timer, this is an independent mechanism and a real
// backstop: if the box dies, this still notices the snapshot going stale and
// dispatches. Its unreliability is acceptable precisely because it is the
// backstop and not the clock.
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
