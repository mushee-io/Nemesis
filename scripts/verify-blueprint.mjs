import fs from "node:fs";
import crypto from "node:crypto";

const path = process.argv[2] ?? "plutus.json";
if (!fs.existsSync(path)) throw new Error(`Missing ${path}; run aiken build first`);
const blueprint = JSON.parse(fs.readFileSync(path, "utf8"));
if (!Array.isArray(blueprint.validators)) throw new Error("Blueprint validators array is missing");

const required = [
  { module: "collateral", validator: "collateral" },
  { module: "perpetual", validator: "perpetual" },
  { module: "options", validator: "options" },
  { module: "notional", validator: "notional" },
  { module: "registry", validator: "registry" }
];

const manifest = [];
for (const expected of required) {
  const prefix = `${expected.module}.${expected.validator}.`;
  const match = blueprint.validators.find((validator) => typeof validator.title === "string" && validator.title.startsWith(prefix));
  if (!match) throw new Error(`Missing compiled validator ${expected.module}.${expected.validator}`);
  if (typeof match.compiledCode !== "string" || match.compiledCode.length < 20 || match.compiledCode.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(match.compiledCode)) throw new Error(`Validator ${match.title} has invalid compiledCode`);
  if (match.hash != null && !/^[0-9a-f]{56}$/i.test(match.hash)) throw new Error(`Validator ${match.title} has invalid script hash`);
  manifest.push({
    title: match.title,
    hash: match.hash ?? null,
    compiledCodeSha256: crypto.createHash("sha256").update(match.compiledCode.toLowerCase()).digest("hex"),
    compiledBytes: match.compiledCode.length / 2,
    parameterized: Array.isArray(match.parameters) && match.parameters.length > 0
  });
}

const uniqueTitles = new Set(manifest.map((entry) => entry.title));
if (uniqueTitles.size !== manifest.length) throw new Error("Duplicate validator titles detected");
console.log(JSON.stringify({ ok: true, validators: manifest }, null, 2));
