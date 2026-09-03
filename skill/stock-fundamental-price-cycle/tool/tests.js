"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const E = require("./engine.js"), D = require("./demo.js"), A = require("./adapters.js");
const fixture = () => D.makeDemo();
const run = d => E.evaluateBundle(d.bundle, d.config);
test("raw-data pipeline computes both markets without supplied pattern booleans", async () => {
  const result = await run(fixture());
  assert.equal(result.manifest.counts.total, 2);
  assert.equal(result.manifest.counts.fundamental_pass, 2);
  assert.equal(result.manifest.counts.eligible, 2);
  assert.ok(result.results.every(r => r.pattern_state === "Base n' Break"));
  assert.equal(result.results[0].profit_yoy_pct, 62.5);
  assert.ok(Math.abs(result.results[0].eps_ttm - 1.85) < 1e-10);
});
test("US thresholds are independent, blank by default; no implicit FX", async () => {
  const d = fixture(); d.config = E.clone(E.DEFAULTS);
  const result = await run(d);
  assert.equal(result.results[0].fundamental_result, "pass");
  assert.equal(result.results[1].fundamental_result, "unknown");
  assert.equal(result.results[1].pattern_state, "Base n' Break");
  assert.ok(result.results[1].blockers.some(r => r.includes("US_adaptation")));
});
test("US no CN ST or daily limit requirement", async () => {
  const r = (await run(fixture())).results[1];
  assert.equal(r.tradability_result, "pass");
  assert.deepEqual(r.tradability.not_applicable, ["CN_ST_rule", "CN_daily_price_limit_rule"]);
});
test("cap boundaries inclusive, EPS and growth strict", async () => {
  for (const cap of [5e9, 5e10]) {
    const d = fixture(); d.bundle.stocks[0].cap_value = cap;
    assert.equal((await run(d)).results[0].fundamental_result, "pass");
  }
  const d = fixture();
  d.config = E.withOverrides(d.config, {"markets.CN.profitYoYMin": 62.5}, "test boundary");
  assert.equal((await run(d)).results[0].fundamental_result, "fail");
});
test("future earnings excluded, not used to repair missing quarter", async () => {
  const d = fixture(); d.bundle.stocks[0].financials.find(f => f.fiscal_year === 2026 && f.quarter === 2).published_at = "2026-09-04T22:00:00Z";
  const r = (await run(d)).results[0];
  assert.equal(r.fundamental.report_period, "2026-03-31");
  assert.notEqual(r.profit_yoy_pct, 62.5);
});
test("missing announcement timestamp blocks complete financial lineage", async () => {
  const d = fixture(); delete d.bundle.stocks[0].financials.find(f => f.fiscal_year === 2025 && f.quarter === 1).published_at;
  assert.equal((await run(d)).results[0].fundamental_result, "unknown");
});
test("non-calendar fiscal-year identifiers work", async () => {
  const d = fixture(); d.bundle.stocks[1].financials.forEach(f => f.fiscal_year += 1);
  assert.equal((await run(d)).results[1].profit_yoy_pct, 62.5);
});
test("EPS restatement/share-basis mismatch cannot pass", async () => {
  const d = fixture(); d.bundle.stocks[0].financials.find(f => f.quarter === 4).share_basis_id = "incomparable";
  assert.equal((await run(d)).results[0].fundamental_result, "unknown");
});
test("income basis mismatch not treated as attributable earnings", async () => {
  const d = fixture(); d.bundle.stocks[0].financials[0].profit_basis = "consolidated";
  assert.equal((await run(d)).results[0].fundamental_result, "unknown");
});
test("zero prior-year profit is unknown; negative denominator uses abs", async () => {
  const d = fixture(), f = d.bundle.stocks[0].financials;
  f.find(f => f.fiscal_year === 2025 && f.quarter === 2).net_income_ytd = 30e6;
  assert.equal((await run(d)).results[0].fundamental_result, "unknown");
  f.find(f => f.fiscal_year === 2025 && f.quarter === 2).net_income_ytd = 20e6;
  assert.equal((await run(d)).results[0].profit_yoy_pct, 750);
});
test("stale capitalization cannot pass", async () => {
  const d = fixture(); d.bundle.stocks[0].quote_date = "2026-09-02";
  assert.equal((await run(d)).results[0].fundamental_result, "unknown");
});
test("SEC annual public float is not interchangeable with same-day cap", async () => {
  const d = fixture(); d.bundle.stocks[1].quote_date = "2025-06-30";
  assert.equal((await run(d)).results[1].fundamental_result, "unknown");
});
test("US total-market-cap alternative must be explicitly configured", async () => {
  const d = fixture(); d.bundle.stocks[1].cap_basis = "total_market_cap";
  assert.equal((await run(d)).results[1].fundamental_result, "unknown");
  d.config = E.withOverrides(d.config, {"markets.US.capBasis": "total_market_cap"}, "explicit test variant");
  assert.equal((await run(d)).results[1].fundamental_result, "pass");
});
test("halt, CN ST and persistent limits are separate failures", async () => {
  for (const [key, value] of [["halted", true], ["is_st", true], ["locked_limit_count20", 3]]) {
    const d = fixture(); d.bundle.stocks[0].status[key] = value;
    assert.equal((await run(d)).results[0].tradability_result, "fail");
  }
});
test("missing status unknown not false", async () => {
  const d = fixture(); delete d.bundle.stocks[0].status.is_st;
  assert.equal((await run(d)).results[0].tradability_result, "unknown");
});
test("missing trading sessions, stale bars and invalid OHLC block", async () => {
  for (const kind of ["gap", "stale", "ohlc", "duplicate"]) {
    const d = fixture(), bars = d.bundle.stocks[0].bars;
    if (kind === "gap") bars.splice(200, 1);
    if (kind === "stale") bars.pop();
    if (kind === "ohlc") bars[210].high = bars[210].low - 1;
    if (kind === "duplicate") bars[210].date = bars[209].date;
    assert.equal((await run(d)).results[0].strategy_eligibility, "insufficient_evidence");
  }
});
test("unknown or future corporate-action anchor blocks signal", async () => {
  const d = fixture(); d.bundle.stocks[0].adjustment.anchor_at = "2026-09-05T00:00:00Z";
  assert.equal((await run(d)).results[0].pattern_state, "unknown");
});
test("market regime chop blocks confirmed base", async () => {
  const d = fixture(); d.bundle.markets.CN.benchmark.bars.forEach(b => b.close = 100);
  const r = (await run(d)).results[0];
  assert.equal(r.market_regime, "chop"); assert.equal(r.pattern_state, "Base n' Break");
  assert.equal(r.strategy_eligibility, "ineligible"); assert.equal(r.action, "watch");
});
test("downtrend and missing benchmark do not permit entry", async () => {
  const d = fixture(); d.bundle.markets.CN.benchmark.bars.forEach((b, i) => b.close = 400 - i);
  assert.equal((await run(d)).results[0].market_regime, "downtrend");
  d.bundle.markets.CN.benchmark.bars = [];
  assert.equal((await run(d)).results[0].market_regime, "unknown");
});
test("frequent EMA crossing has chop precedence", () => {
  const bars = Array.from({length: 160}, (_, i) => ({close: 100 + (i % 2 ? 0.05 : -0.05), high: 101, low: 99}));
  assert.equal(E.regimeAt(bars, E.indicators(bars, E.DEFAULTS.technical), 159, E.DEFAULTS.technical).regime, "chop");
});
test("Wilder ATR uses recursive smoothing, not rolling SMA", () => {
  const bars = Array.from({length: 16}, (_, i) => ({high: i < 14 ? 11 : 24, low: i < 14 ? 9 : 10, close: 10}));
  const {atr} = E.indicators(bars, E.DEFAULTS.technical);
  assert.equal(atr[13], 2); assert.equal(atr[14], (2 * 13 + 14) / 14);
  assert.equal(atr[15], (atr[14] * 13 + 14) / 14);
});
test("six state predicates obey risk-first precedence", () => {
  for (let a = 0; a < E.STATES.length; a++) for (let b = a; b < E.STATES.length; b++) {
    const checks = Object.fromEntries(E.STATES.map(s => [s, {condition: s === E.STATES[a] || s === E.STATES[b]}]));
    assert.equal(E.choosePattern(checks).state, E.STATES[a]);
  }
});
test("unknown higher-priority risk cannot imply a clean buy", () => {
  const checks = Object.fromEntries(E.STATES.map(s => [s, {condition: s === "Base n' Break"}]));
  checks["Wedge Drop"].condition = null;
  assert.deepEqual(E.choosePattern(checks).higherUnknown, ["Wedge Drop"]);
});
test("risk state persists, a quiet day does not carry entry eligibility", () => {
  assert.equal(E.transition("Exhaustion Extension", "Neutral"), "Exhaustion Extension");
  assert.equal(E.transition("Exhaustion Extension", "Wedge Pop"), "Exhaustion Extension");
  assert.equal(E.transition("Exhaustion Extension", "Base n' Break"), "Base n' Break");
  assert.equal(E.transition("Wedge Drop", "EMA Crossback"), "Wedge Drop");
  const t = {state: "Neutral", active_state: "Base n' Break", reasons: []}, pass = {result: "pass", reasons: []};
  assert.notEqual(E.decide(pass, pass, t, "uptrend").strategy_eligibility, "eligible");
});
test("state machine does not relabel earlier events from future bars", () => {
  const {bundle, config} = fixture(), bars = bundle.stocks[0].bars, bench = bundle.markets.CN.benchmark.bars;
  const prefix = E.classify(bars.slice(0, 210), bench.slice(0, 210), config.technical);
  const full = E.classify(bars, bench, config.technical);
  assert.deepEqual(full.trace.filter(x => x.date <= bars[209].date), prefix.trace);
});
test("US DST, early-close and China overnight context are calendar-driven", () => {
  assert.equal(E.dateInZone("2026-01-15T21:00:00Z", "America/New_York"), "2026-01-15");
  assert.equal(E.dateInZone("2026-07-15T20:00:00Z", "America/New_York"), "2026-07-15");
  const cal = {calendar_source: "fixture", calendar_verified_through: "2026-11-27",
    calendar: [{date: "2026-11-25", close_at: "2026-11-25T16:00:00-05:00"}, {date: "2026-11-27", close_at: "2026-11-27T13:00:00-05:00"}]};
  assert.equal(E.calendarContext(cal, E.DEFAULTS.markets.US, "2026-11-27T18:01:00Z").expected, "2026-11-27");
  assert.equal(E.calendarContext(cal, E.DEFAULTS.markets.US, "2026-11-27T17:59:00Z").expected, "2026-11-25");
  const d = fixture(); assert.equal(E.calendarContext(d.bundle.markets.CN, E.DEFAULTS.markets.CN, d.bundle.as_of).expected, "2026-09-03");
});
test("unverified or expired calendar is unknown rather than weekday guessing", async () => {
  const d = fixture(); d.bundle.markets.US.calendar_verified_through = "2026-09-02";
  assert.equal((await run(d)).results[1].market_regime, "unknown");
});
test("instrument universe supports any supplied equity, not commodity categories", async () => {
  const d = fixture(); d.bundle.stocks[0].sector = "software";
  assert.equal((await run(d)).results[0].strategy_eligibility, "eligible");
});
test("duplicate ticker same market rejected, leading zeros preserved", async () => {
  const d = fixture(); d.bundle.stocks.push(E.clone(d.bundle.stocks[0])); d.bundle.universe.expected_count++;
  await assert.rejects(run(d), /Duplicate/);
});
test("partial universe cannot masquerade as all-market coverage", async () => {
  const d = fixture(); d.bundle.universe.scope = "full_market"; d.bundle.universe.expected_count = 5000;
  const r = await run(d); assert.equal(r.manifest.coverage_complete, false); assert.equal(r.manifest.full_market_verified, false);
});
test("outdated universe snapshot loses complete coverage claim", async () => {
  const d = fixture(); d.bundle.universe.snapshot_at = "2026-08-01T20:00:00Z";
  assert.equal((await run(d)).manifest.coverage_complete, false);
});
test("config changes require provenance and cannot pollute prototypes", () => {
  const c = E.clone(E.DEFAULTS); c.technical.breakVolume = 1;
  assert.throws(() => E.validateConfig(c), /Undocumented/);
  assert.throws(() => E.withOverrides(E.DEFAULTS, {"__proto__.polluted": true}, "bad"), /Unknown/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => E.safeJSON('{"__proto__":{"polluted":true}}'), /Unsafe/);
});
test("null growth threshold does not coerce to zero", () => {
  const c = E.clone(E.DEFAULTS); c.markets.CN.profitYoYMin = null;
  assert.throws(() => E.validateConfig(c), /bounds/);
});
test("canonical fingerprints stable and sensitive to input/config", async () => {
  assert.equal(await E.hash(E.canonical({b: 2, a: 1})), await E.hash(E.canonical({a: 1, b: 2})));
  const d = fixture(), a = await run(d); d.bundle.stocks[0].cap_value++;
  const b = await run(d); assert.notEqual(a.manifest.input_sha256, b.manifest.input_sha256);
  assert.equal(a.manifest.config_sha256, b.manifest.config_sha256);
});
test("CSV parser respects quotes, BOM, CRLF and codes", () => {
  assert.deepEqual(E.parseCSV('\uFEFFticker,name\r\n000001,"A, ""quoted"""\r\n'), [{ticker: "000001", name: 'A, "quoted"'}]);
  assert.throws(() => E.parseCSV('a,b\n"bad,x'), /Unclosed/);
});
test("CSV export prevents spreadsheet formula injection", async () => {
  const d = fixture(); d.bundle.stocks[0].name = "=HYPERLINK(\"bad\")";
  const text = E.toCSV(await run(d)); assert.ok(text.includes("'=HYPERLINK"));
});
test("file adapter passes single JSON bundle unchanged", () => {
  const d = fixture(); assert.deepEqual(A.fromFiles({"input.json": JSON.stringify(d.bundle)}), d.bundle);
});
test("CLI requires new output folder and exports standalone artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stockcycle-test-"));
  try {
    const out = path.join(dir, "run"), command = [path.join(__dirname, "cli.js"), "--demo", "--out", out];
    const result = cp.spawnSync(process.execPath, command, {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"))).counts.eligible, 2);
    assert.equal(cp.spawnSync(process.execPath, command).status, 1);
  } finally {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith("stockcycle-test-")) throw new Error("Unsafe test cleanup path");
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
test("browser-like VM uses WebCrypto and returns the same result as Node", async () => {
  const vm = require("node:vm"), context = vm.createContext({crypto: require("node:crypto").webcrypto, TextEncoder, Intl, Date, console});
  context.self = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"), context);
  const d = fixture(), node = await run(d), browser = await context.StockCycle.evaluateBundle(d.bundle, d.config);
  assert.equal(E.canonical(node), E.canonical(browser));
});
test("UI scripts parse and every literal DOM id exists in the template", () => {
  const vm = require("node:vm"), ui = fs.readFileSync(path.join(__dirname, "ui.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "app.template.html"), "utf8");
  new vm.Script(ui);
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), m => m[1]));
  for (const m of ui.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.has(m[1]), m[1]);
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(ui));
});
test("CSV six-file roundtrip is numerically identical to JSON input", async () => {
  const folder = path.join(__dirname, "examples", "csv");
  const files = Object.fromEntries(fs.readdirSync(folder).map(n => [n, fs.readFileSync(path.join(folder, n), "utf8")]));
  const {config} = fixture(), actual = await E.evaluateBundle(A.fromFiles(files), config);
  const expected = await run(fixture());
  assert.equal(E.canonical(actual), E.canonical(expected));
});
