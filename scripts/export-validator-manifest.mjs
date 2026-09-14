import fs from "node:fs";
import crypto from "node:crypto";

const inputPath = process.argv[2] ?? "plutus.json";
const outputPath = process.argv[3] ?? "artifacts/validator-manifest.json";
if (!fs.existsSync(inputPath)) throw new Error(`Missing ${inputPath}; run aiken build first`);
const blueprint = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const selected = (blueprint.validators ?? []).filter((validator) =>
  ["collateral.collateral.spend", "perpetual.perpetual.spend", "options.options.spend"].includes(validator.title)
);
if (selected.length !== 3) throw new Error(`Expected 3 Symbiotic spend validators, found ${selected.length}`);

const validators = selected.map((validator) => {
  if (typeof validator.compiledCode !== "string") throw new Error(`Missing compiled code for ${validator.title}`);
  return {
    title: validator.title,
    hash: validator.hash ?? null,
    compiledCodeSha256: crypto.createHash("sha256").update(validator.compiledCode.toLowerCase()).digest("hex"),
    compiledBytes: validator.compiledCode.length / 2,
    parameterized: Array.isArray(validator.parameters) && validator.parameters.length > 0
  };
});

const artifact = {
  schemaVersion: 1,
  project: blueprint.preamble?.title ?? "mushee-io/symbiotic",
  plutusVersion: "v3",
  blueprintSha256: crypto.createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex"),
  validators
};

fs.mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
fs.mkdirSync(outputPath.includes("/") ? outputPath.slice(0, outputPath.lastIndexOf("/")) : ".", { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
