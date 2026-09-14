import fs from "node:fs";
import crypto from "node:crypto";

const inputPath = process.argv[2] ?? "plutus.json";
const outputPath = process.argv[3] ?? "artifacts/parameter-schema.json";
if (!fs.existsSync(inputPath)) throw new Error(`Missing ${inputPath}; run aiken build first`);

const raw = fs.readFileSync(inputPath);
const blueprint = JSON.parse(raw.toString("utf8"));
const titles = [
  "collateral.collateral.spend",
  "perpetual.perpetual.spend",
  "options.options.spend",
  "notional.notional.spend"
];

const validators = titles.map((title) => {
  const validator = (blueprint.validators ?? []).find((candidate) => candidate.title === title);
  if (!validator) throw new Error(`Missing validator ${title}`);
  const parameters = Array.isArray(validator.parameters) ? validator.parameters : [];
  if (!parameters.length) throw new Error(`${title} must expose parameter schema in the CIP-0057 blueprint`);
  const canonical = JSON.stringify(parameters);
  return {
    title,
    parameterCount: parameters.length,
    parameterSchemaSha256: crypto.createHash("sha256").update(canonical).digest("hex")
  };
});

const artifact = {
  schemaVersion: 1,
  project: blueprint.preamble?.title ?? "mushee-io/symbiotic",
  blueprintSha256: crypto.createHash("sha256").update(raw).digest("hex"),
  validators,
  parameterBundleSha256: crypto.createHash("sha256").update(
    validators.map((validator) => `${validator.title}:${validator.parameterCount}:${validator.parameterSchemaSha256}`).join("|")
  ).digest("hex")
};

const directory = outputPath.includes("/") ? outputPath.slice(0, outputPath.lastIndexOf("/")) : ".";
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
