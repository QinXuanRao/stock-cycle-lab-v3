#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const E = require("./engine.js"), A = require("./adapters.js"), D = require("./demo.js");
async function main() {
  const args = process.argv.slice(2), get = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  if (args.includes("--help") || !args.length) {
    console.log("node cli.js --input bundle.json|csv_directory --out NEW_DIRECTORY [--config config.json]\nnode cli.js --demo --out NEW_DIRECTORY\nNo network requests or brokerage access. US dollar thresholds must be configured.");
    return;
  }
  const allowed = new Set(["--input", "--out", "--config", "--demo"]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error("Unknown option: " + args[i]);
    if (args[i] !== "--demo") { if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Missing option value"); i++; }
  }
  const out = get("--out");
  if (!out) throw new Error("--out is required");
  if (fs.existsSync(out)) throw new Error("Refusing to overwrite existing output directory");
  let bundle, config;
  if (args.includes("--demo")) ({bundle, config} = D.makeDemo());
  else {
    const input = get("--input");
    if (!input) throw new Error("--input is required");
    if (fs.statSync(input).isDirectory()) {
      const names = ["metadata.json", "securities.csv", "financials.csv", "prices.csv", "benchmarks.csv", "calendar.csv"];
      bundle = A.fromFiles(Object.fromEntries(names.map(n => [n, fs.readFileSync(path.join(input, n), "utf8")])));
    } else bundle = E.safeJSON(fs.readFileSync(input, "utf8"));
    config = E.clone(E.DEFAULTS);
  }
  if (get("--config")) config = E.safeJSON(fs.readFileSync(get("--config"), "utf8"));
  const report = await E.evaluateBundle(bundle, config);
  report.manifest.engine_sha256 = await E.hash(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"));
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, "results.csv"), E.toCSV(report), "utf8");
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(report.manifest, null, 2));
  fs.writeFileSync(path.join(out, "config.json"), JSON.stringify(config, null, 2));
  console.log(JSON.stringify({demo: bundle.demo === true, ...report.manifest.counts, coverage_complete: report.manifest.coverage_complete}));
}
main().catch(e => { console.error("ERROR: " + e.message); process.exitCode = 1; });
