(function (root, factory) {
  const E = typeof module === "object" && module.exports ? require("./engine.js") : root.StockCycle;
  const api = factory(E);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StockCycleDemo = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";
  function makeDemo() {
    const dates = [], end = new Date("2026-09-03T00:00:00Z");
    while (dates.length < 220) {
      if (end.getUTCDay() !== 0 && end.getUTCDay() !== 6) dates.unshift(end.toISOString().slice(0, 10));
      end.setUTCDate(end.getUTCDate() - 1);
    }
    function calendar(market) {
      return dates.map(date => ({date, close_at: date + (market === "CN" ? "T15:00:00+08:00" : "T16:00:00-04:00")}));
    }
    function financials(market) {
      const source = "SYNTHETIC fixture; not real filings";
      return [[2025, 1, "03-31", 30, 0.3], [2025, 2, "06-30", 70, 0.7], [2025, 4, "12-31", 140, 1.4],
        [2026, 1, "03-31", 50, 0.5], [2026, 2, "06-30", 115, 1.15]].map(([year, quarter, md, ni, eps]) => ({
          fiscal_year: year, quarter, period_end: year + "-" + md,
          published_at: (quarter === 4 ? (year + 1) + "-02-20" : year + (quarter === 1 ? "-04-20" : "-08-20")) + "T20:00:00Z",
          net_income_ytd: ni * 1e6, profit_basis: market === "CN" ? "attributable_to_parent" : "attributable_to_common",
          eps_ytd: eps, currency: market === "CN" ? "CNY" : "USD", eps_basis: "basic", share_basis_id: "synthetic-stable",
          eps_comparable: true, point_in_time_verified: true, source
        }));
    }
    function bars() {
      return dates.map((date, i) => {
        const close = i < 207 ? 20 + i * 0.09 : i < 219 ? 38.7 + (i - 207) * 0.02 : 39.55;
        const spread = i < 207 ? 0.65 : i < 219 ? 0.16 : 0.25;
        const volume = i < 207 ? 1e7 : i < 219 ? 5e6 : 2e7;
        return {date, open: close - spread / 3, high: close + spread / 2, low: close - spread / 2,
          close, volume, amount: volume * close};
      });
    }
    const stocks = ["CN", "US"].map(market => ({
      market, ticker: market === "CN" ? "000001" : "DEMO.A", name: market === "CN" ? "合成A股示例（非真实公司）" : "Synthetic US Example",
      name_source: "SYNTHETIC fixture", instrument_type: "common_stock", currency: market === "CN" ? "CNY" : "USD",
      cap_basis: market === "CN" ? "circulating_a_share" : "public_float", cap_value: market === "CN" ? 12e9 : 2e9,
      quote_date: "2026-09-03", quote_published_at: "2026-09-03T20:05:00Z", quote_source: "SYNTHETIC fixture",
      financials_verified: true, financials: financials(market), price_source: "SYNTHETIC fixture",
      adjustment: {basis: "split_dividend_adjusted", anchor_at: "2025-01-01T00:00:00Z", point_in_time_verified: true},
      status: {date: "2026-09-03", verified: true, source: "SYNTHETIC", listing_sessions: 500, halted: false,
        is_st: market === "CN" ? false : null, locked_limit_count20: market === "CN" ? 0 : null}, bars: bars()
    }));
    const markets = Object.fromEntries(["CN", "US"].map(market => [market, {
      calendar: calendar(market).concat(market === "CN" ? [{date: "2026-09-04", close_at: "2026-09-04T15:00:00+08:00"}] : []),
      calendar_source: "SYNTHETIC weekdays, NOT an exchange calendar",
      calendar_verified_through: market === "CN" ? "2026-09-04" : "2026-09-03",
      benchmark: {id: market + "_SYNTHETIC", source: "SYNTHETIC", return_basis: "total_return", bars: dates.map((date, i) => ({date, close: 100 + i}))}
    }]));
    const bundle = {schema_version: 3, demo: true, as_of: "2026-09-03T22:00:00Z",
      universe: {label: "合成演示 / Synthetic, not real market data", scope: "provided", expected_count: 2,
        missing_partitions: [], coverage_verified: true, snapshot_at: "2026-09-03T21:00:00Z", source: "SYNTHETIC"},
      markets, stocks};
    const config = E.withOverrides(E.clone(E.DEFAULTS), {
      "markets.US.capMin": 1e9, "markets.US.capMax": 10e9, "markets.US.amountMin": 1e7,
      "markets.US.adaptationAcknowledged": true
    }, "SYNTHETIC DEMO ONLY — not user investment thresholds");
    return {bundle, config};
  }
  return {makeDemo};
});
