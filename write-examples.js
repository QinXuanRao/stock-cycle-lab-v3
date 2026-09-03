"use strict";
const fs = require("node:fs"), path = require("node:path");
const {makeDemo} = require("./demo.js");
const {bundle, config} = makeDemo(), target = process.argv[2];
if (!target || fs.existsSync(target)) throw new Error("Provide a new examples directory");
fs.mkdirSync(path.join(target, "csv"), {recursive: true});
fs.writeFileSync(path.join(target, "synthetic-input.json"), JSON.stringify(bundle, null, 2));
fs.writeFileSync(path.join(target, "synthetic-config.json"), JSON.stringify(config, null, 2));
const meta = structuredClone(bundle); delete meta.stocks;
for (const m of Object.values(meta.markets)) { delete m.calendar; delete m.benchmark.bars; }
fs.writeFileSync(path.join(target, "csv", "metadata.json"), JSON.stringify(meta, null, 2));
const rows = {securities: [], financials: [], prices: [], benchmarks: [], calendar: []};
for (const s of bundle.stocks) {
  rows.securities.push({market: s.market, ticker: s.ticker, name: s.name, name_source: s.name_source,
    instrument_type: s.instrument_type, currency: s.currency, cap_basis: s.cap_basis, cap_value: s.cap_value,
    quote_date: s.quote_date, quote_published_at: s.quote_published_at, quote_source: s.quote_source,
    financials_verified: s.financials_verified, price_source: s.price_source,
    adjustment_basis: s.adjustment.basis, adjustment_anchor_at: s.adjustment.anchor_at,
    adjustment_verified: s.adjustment.point_in_time_verified, status_date: s.status.date,
    status_source: s.status.source, status_verified: s.status.verified, listing_sessions: s.status.listing_sessions,
    halted: s.status.halted, is_st: s.status.is_st, locked_limit_count20: s.status.locked_limit_count20});
  for (const f of s.financials) rows.financials.push({market: s.market, ticker: s.ticker, ...f});
  for (const b of s.bars) rows.prices.push({market: s.market, ticker: s.ticker, ...b});
}
for (const [market, m] of Object.entries(bundle.markets)) {
  for (const b of m.benchmark.bars) rows.benchmarks.push({market, ...b});
  for (const c of m.calendar) rows.calendar.push({market, ...c});
}
for (const [name, values] of Object.entries(rows)) {
  const keys = Object.keys(values[0]), cell = x => '"' + (x === null || x === undefined ? "" : String(x)).replace(/"/g, '""') + '"';
  fs.writeFileSync(path.join(target, "csv", name + ".csv"), "\uFEFF" + [keys.map(cell).join(","), ...values.map(v => keys.map(k => cell(v[k])).join(","))].join("\r\n"));
}
console.log("Synthetic examples generated at " + target);
