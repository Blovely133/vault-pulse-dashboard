import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isSnapshotStale(
  generatedAt,
  maximumAgeMinutes,
  now = Date.now(),
) {
  const generatedAtTime = Date.parse(generatedAt);
  const maximumAge = Number(maximumAgeMinutes) * 60 * 1000;

  if (
    !Number.isFinite(generatedAtTime) ||
    !Number.isFinite(maximumAge) ||
    maximumAge <= 0
  ) {
    return true;
  }

  return now - generatedAtTime > maximumAge;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const dataPath = path.join(
    repositoryRoot,
    "site",
    "data",
    "dashboard.json",
  );
  const data = JSON.parse(await readFile(dataPath, "utf8"));

  process.stdout.write(
    String(isSnapshotStale(data.generatedAt, process.argv[2])),
  );
}
