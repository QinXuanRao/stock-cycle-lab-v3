(function (root, factory) {
  const engine = typeof module === "object" && module.exports ? require("./engine.js") : root.StockCycle;
  const api = factory(engine);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StockCycleAdapters = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";
  const num = x => {
    if (x === "" || x === undefined || x === null) return null;
    const n = Number(x);
    if (!Number.isFinite(n)) throw new Error("Invalid numeric CSV field: " + x);
    return n;
  };
  const flag = x => {
    if (x === "" || x === undefined || x === null) return null;
    if (x === "true" || x === true) return true;
    if (x === "false" || x === false) return false;
    throw new Error("Boolean CSV fields must be true/false: " + x);
  };
  function fromFiles(files) {
    const names = Object.keys(files);
    if (names.length === 1 && /\.json$/i.test(names[0])) return E.safeJSON(files[names[0]]);
    const required = ["metadata.json", "securities.csv", "financials.csv", "prices.csv", "benchmarks.csv", "calendar.csv"];
    for (const name of required) if (!(name in files)) throw new Error("Missing file: " + name);
    const bundle = E.safeJSON(files["metadata.json"]);
    if (!bundle.markets) throw new Error("metadata.json requires markets");
    bundle.stocks = []; const byId = new Map();
    for (const row of E.parseCSV(files["securities.csv"])) {
      const id = row.market + ":" + row.ticker;
      if (byId.has(id)) throw new Error("Duplicate security: " + id);
      const stock = {
        market: row.market, ticker: row.ticker, name: row.name, name_source: row.name_source,
        instrument_type: row.instrument_type, currency: row.currency, cap_basis: row.cap_basis, cap_value: num(row.cap_value),
        quote_date: row.quote_date, quote_published_at: row.quote_published_at, quote_source: row.quote_source,
        financials_verified: flag(row.financials_verified), price_source: row.price_source,
        adjustment: {basis: row.adjustment_basis, anchor_at: row.adjustment_anchor_at, point_in_time_verified: flag(row.adjustment_verified)},
        status: {date: row.status_date, source: row.status_source, verified: flag(row.status_verified),
          listing_sessions: num(row.listing_sessions), halted: flag(row.halted), is_st: flag(row.is_st),
          locked_limit_count20: num(row.locked_limit_count20)},
        financials: [], bars: []
      };
      byId.set(id, stock); bundle.stocks.push(stock);
    }
    for (const row of E.parseCSV(files["financials.csv"])) {
      const stock = byId.get(row.market + ":" + row.ticker);
      if (!stock) throw new Error("Financial row not in securities universe");
      stock.financials.push({
        fiscal_year: num(row.fiscal_year), quarter: num(row.quarter), period_end: row.period_end, published_at: row.published_at,
        net_income_ytd: num(row.net_income_ytd), profit_basis: row.profit_basis, eps_ytd: num(row.eps_ytd), currency: row.currency,
        eps_basis: row.eps_basis, share_basis_id: row.share_basis_id, eps_comparable: flag(row.eps_comparable),
        point_in_time_verified: flag(row.point_in_time_verified), source: row.source
      });
    }
    for (const row of E.parseCSV(files["prices.csv"])) {
      const stock = byId.get(row.market + ":" + row.ticker);
      if (!stock) throw new Error("Price row not in securities universe");
      stock.bars.push(Object.fromEntries(["date", "open", "high", "low", "close", "volume", "amount"].map(k => [k, k === "date" ? row[k] : num(row[k])])));
    }
    for (const data of Object.values(bundle.markets)) {
      data.calendar = [];
      if (data.benchmark) data.benchmark.bars = [];
    }
    for (const row of E.parseCSV(files["benchmarks.csv"])) {
      const m = bundle.markets[row.market];
      if (!m || !m.benchmark) throw new Error("Benchmark market missing in metadata");
      m.benchmark.bars.push({date: row.date, close: num(row.close)});
    }
    for (const row of E.parseCSV(files["calendar.csv"])) {
      if (!bundle.markets[row.market]) throw new Error("Calendar market missing in metadata");
      bundle.markets[row.market].calendar.push({date: row.date, close_at: row.close_at});
    }
    return bundle;
  }
  return {fromFiles};
});
