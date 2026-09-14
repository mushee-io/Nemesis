import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2];
const output = process.argv[3] ?? "artifacts/build-digest.json";
if (!input || !fs.existsSync(input)) throw new Error("Directory to hash does not exist");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "cache") return [];
        return walk(absolute);
      }
      return entry.isFile() ? [absolute] : [];
    });
}

const root = path.resolve(input);
const files = walk(root).sort((a, b) => a.localeCompare(b));
if (!files.length) throw new Error("No build files found to hash");
const hash = crypto.createHash("sha256");
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  hash.update(relative);
  hash.update("\0");
  hash.update(fs.readFileSync(file));
  hash.update("\0");
}
const artifact = {
  schemaVersion: 1,
  directory: input,
  fileCount: files.length,
  sha256: hash.digest("hex"),
  commitSha: process.env.GITHUB_SHA ?? null
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${output}`);
