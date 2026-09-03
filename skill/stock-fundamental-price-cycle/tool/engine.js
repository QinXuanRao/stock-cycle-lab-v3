/* Stock Cycle Lab v3 — same deterministic engine in browser, worker and Node.
 * No network, brokerage, AI inference or device-specific paths.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StockCycle = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const VERSION = "3.0.0";
  const STATES = ["Wedge Drop", "Exhaustion Extension", "Base n' Break", "EMA Crossback", "Wedge Pop", "Reversal Extension"];
  const ENTRY = ["Wedge Pop", "EMA Crossback", "Base n' Break"];
  const DEFAULTS = {
    version: VERSION,
    technical: {
      emaFast: 10, emaSlow: 20, atrWindow: 14, warmup: 120,
      volumeWindow: 20, regimeWindow: 5, regimeHits: 3, chopWindow: 20,
      chopCrosses: 3, chopSeparation: 0.005, extensionATR: 2,
      extensionVolume: 1.5, breakVolume: 1.2, supportWindow: 60,
      supportToleranceATR: 0.5, wedgeWindow: 5, contractionRatio: 0.8,
      wedgeSeparation: 0.01, rsWindow: 20, crossbackMin: 2, crossbackMax: 15,
      baseMin: 5, baseMax: 20, baseWidth: 0.15, baseMaxATR: 6,
      bottomWindow: 10, weeklySupportWeeks: 12
    },
    markets: {
      CN: {currency: "CNY", timezone: "Asia/Shanghai", capBasis: "circulating_a_share",
        capMin: 5e9, capMax: 5e10, amountMin: 2e8, profitYoYMin: 30, epsMin: 0,
        listingMin: 120, lockedLimitMax: 3, adaptationAcknowledged: true},
      US: {currency: "USD", timezone: "America/New_York", capBasis: "public_float",
        capMin: null, capMax: null, amountMin: null, profitYoYMin: 30, epsMin: 0,
        listingMin: 120, lockedLimitMax: null, adaptationAcknowledged: false}
    },
    overrides: []
  };
  const finite = x => typeof x === "number" && Number.isFinite(x);
  const bool = x => typeof x === "boolean";
  const clone = x => JSON.parse(JSON.stringify(x));
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const median = xs => {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const maximum = xs => xs.length ? Math.max(...xs) : null;
  const minimum = xs => xs.length ? Math.min(...xs) : null;
  const time = x => typeof x === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
  const dateValid = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
    Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
  function dateInZone(iso, zone) {
    const parts = new Intl.DateTimeFormat("en-CA", {timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(iso));
    return ["year", "month", "day"].map(k => parts.find(p => p.type === k).value).join("-");
  }
  function canonical(x) {
    if (x === undefined) return "null";
    if (typeof x === "number" && !finite(x)) throw new Error("Cannot fingerprint a non-finite number");
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    return "{" + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
  }
  async function hash(text) {
    if (typeof require === "function") return require("node:crypto").createHash("sha256").update(text).digest("hex");
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
    }
    throw new Error("SHA-256 unavailable in this browser. Use a modern browser or the Node CLI.");
  }
  function safeJSON(text) {
    return JSON.parse(text.replace(/^\uFEFF/, ""), (k, v) => {
      if (["__proto__", "constructor", "prototype"].includes(k)) throw new Error("Unsafe JSON key");
      if (typeof v === "number" && !finite(v)) throw new Error("Non-finite number");
      return v;
    });
  }
  function validateConfig(config) {
    if (!config || config.version !== VERSION) throw new Error("Configuration version mismatch");
    for (const key of Object.keys(config.technical || {})) {
      if (!(key in DEFAULTS.technical)) throw new Error("Unknown technical parameter: " + key);
    }
    for (const key of Object.keys(DEFAULTS.technical)) {
      if (!finite(config.technical[key]) || config.technical[key] <= 0) throw new Error("Invalid parameter: " + key);
      if (Number.isInteger(DEFAULTS.technical[key]) && !Number.isInteger(config.technical[key])) throw new Error("Integer required: " + key);
    }
    const p = config.technical;
    if (p.warmup < Math.max(p.supportWindow + 1, p.emaSlow * 3, p.baseMax * 2 + p.regimeWindow, p.rsWindow + 1) ||
        p.emaFast >= p.emaSlow || p.baseMin > p.baseMax || p.crossbackMin > p.crossbackMax ||
        p.regimeHits > p.regimeWindow) throw new Error("Inconsistent technical windows");
    for (const market of ["CN", "US"]) {
      const profile = config.markets[market];
      if (!profile || profile.currency !== DEFAULTS.markets[market].currency || profile.timezone !== DEFAULTS.markets[market].timezone)
        throw new Error("Market currency/timezone mismatch: " + market);
      if (!(market === "CN" ? ["circulating_a_share"] : ["public_float", "total_market_cap"]).includes(profile.capBasis))
        throw new Error("Unsupported cap basis: " + market);
      for (const key of ["capMin", "capMax", "amountMin", "profitYoYMin", "epsMin", "listingMin", "lockedLimitMax"]) {
        if (profile[key] !== null && !finite(profile[key])) throw new Error("Invalid market threshold: " + key);
      }
      if ([profile.capMin, profile.capMax, profile.amountMin].some(v => v !== null && v <= 0) ||
          (finite(profile.capMin) && finite(profile.capMax) && profile.capMin > profile.capMax) ||
          !finite(profile.profitYoYMin) || !finite(profile.epsMin) ||
          !Number.isInteger(profile.listingMin) || profile.listingMin < 1 || !bool(profile.adaptationAcknowledged))
        throw new Error("Invalid market bounds or acknowledgement");
      if (market === "CN" && (!Number.isInteger(profile.lockedLimitMax) || profile.lockedLimitMax < 1))
        throw new Error("CN locked-limit threshold must be a positive integer");
    }
    if (!Array.isArray(config.overrides)) throw new Error("overrides must be an array");
    const changes = [];
    for (const section of ["technical"]) for (const k of Object.keys(DEFAULTS[section])) {
      if (config[section][k] !== DEFAULTS[section][k]) changes.push({path: section + "." + k, old: DEFAULTS[section][k], value: config[section][k]});
    }
    for (const m of ["CN", "US"]) for (const k of Object.keys(DEFAULTS.markets[m])) {
      if (config.markets[m][k] !== DEFAULTS.markets[m][k]) changes.push({path: "markets." + m + "." + k, old: DEFAULTS.markets[m][k], value: config.markets[m][k]});
    }
    for (const c of changes) {
      if (!config.overrides.some(o => o.path === c.path && o.old === c.old && o.value === c.value && o.reason && o.provenance === "user-specified"))
        throw new Error("Undocumented override: " + c.path);
    }
    return config;
  }
  function withOverrides(config, edits, reason) {
    const out = clone(config);
    const allowed = new Set(Object.keys(DEFAULTS.technical).map(k => "technical." + k).concat(
      ["CN", "US"].flatMap(m => Object.keys(DEFAULTS.markets[m]).map(k => "markets." + m + "." + k))));
    for (const [path, value] of Object.entries(edits)) {
      if (!allowed.has(path)) throw new Error("Unknown setting: " + path);
      const keys = path.split("."), leaf = keys.pop();
      let object = out, baseline = DEFAULTS;
      for (const k of keys) { object = object[k]; baseline = baseline[k]; }
      if (!object || !(leaf in object) || !baseline) throw new Error("Unknown setting: " + path);
      object[leaf] = value;
      out.overrides = out.overrides.filter(o => o.path !== path);
      if (baseline[leaf] !== value) out.overrides.push({path, old: baseline[leaf], value, reason, provenance: "user-specified"});
    }
    return validateConfig(out);
  }
  function gate(checks, unknownReasons = []) {
    const failed = Object.keys(checks).filter(k => checks[k] === false);
    const missing = Object.keys(checks).filter(k => checks[k] === null);
    const result = unknownReasons.length || missing.length ? "unknown" : failed.length ? "fail" : "pass";
    return {result, checks, reasons: unknownReasons.concat(missing.map(k => "missing:" + k), failed.map(k => "failed:" + k))};
  }
  function indicators(bars, p) {
    const fast = [], slow = [], tr = [], atr = [];
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], prev = i ? bars[i - 1].close : b.close;
      fast.push(i ? fast[i - 1] + 2 / (p.emaFast + 1) * (b.close - fast[i - 1]) : b.close);
      slow.push(i ? slow[i - 1] + 2 / (p.emaSlow + 1) * (b.close - slow[i - 1]) : b.close);
      tr.push(Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev)));
      atr.push(i < p.atrWindow - 1 ? null : i === p.atrWindow - 1 ? mean(tr.slice(0, p.atrWindow)) : (atr[i - 1] * (p.atrWindow - 1) + tr[i]) / p.atrWindow);
    }
    return {fast, slow, tr, atr};
  }
  function regimeAt(bars, ind, i, p) {
    if (i < Math.max(p.warmup - 1, p.chopWindow, p.regimeWindow)) return {regime: "unknown", reason: "insufficient_history"};
    let up = 0, down = 0, crosses = 0;
    const sep = [];
    for (let j = i - p.regimeWindow + 1; j <= i; j++) {
      if (bars[j].close > ind.slow[j] && ind.fast[j] > ind.slow[j]) up++;
      if (bars[j].close < ind.slow[j] && ind.fast[j] < ind.slow[j]) down++;
    }
    for (let j = i - p.chopWindow + 1; j <= i; j++) {
      if ((bars[j].close > ind.slow[j]) !== (bars[j - 1].close > ind.slow[j - 1])) crosses++;
      sep.push(Math.abs(ind.fast[j] - ind.slow[j]) / ind.slow[j]);
    }
    let regime = up >= p.regimeHits && ind.slow[i] >= ind.slow[i - p.regimeWindow] ? "uptrend" :
      down >= p.regimeHits && ind.slow[i] < ind.slow[i - p.regimeWindow] ? "downtrend" : "chop";
    if (crosses >= p.chopCrosses && median(sep) <= p.chopSeparation) regime = "chop";
    return {regime, up_count: up, down_count: down, crosses, median_separation: median(sep)};
  }
  function calendarContext(data, profile, asOf) {
    const unknown = reason => ({valid: false, reason, expected: null, sessions: []});
    if (!data || !Array.isArray(data.calendar) || !data.calendar.length || !data.calendar_source) return unknown("calendar_missing");
    const localDate = dateInZone(asOf, profile.timezone);
    if (!dateValid(data.calendar_verified_through) || data.calendar_verified_through < localDate) return unknown("calendar_coverage_stale");
    let priorDate = "", priorTime = -Infinity;
    for (const s of data.calendar) {
      const t = time(s.close_at);
      if (!dateValid(s.date) || t === null || s.date <= priorDate || t <= priorTime || dateInZone(s.close_at, profile.timezone) !== s.date)
        return unknown("calendar_invalid_order_date_or_timezone");
      priorDate = s.date; priorTime = t;
    }
    const sessions = data.calendar.filter(s => time(s.close_at) <= time(asOf));
    if (!sessions.length) return unknown("no_completed_session");
    return {valid: true, expected: sessions[sessions.length - 1].date, sessions};
  }
  function validateBars(raw, context, {benchmark = false} = {}) {
    const out = {valid: false, bars: [], reasons: []};
    if (!context.valid) { out.reasons.push(context.reason); return out; }
    if (!Array.isArray(raw) || !raw.length) { out.reasons.push("prices_missing"); return out; }
    const sessions = new Set(context.sessions.map(s => s.date));
    let previous = "";
    for (const b of raw) {
      if (!dateValid(b.date) || b.date <= previous) { out.reasons.push("duplicate_or_unsorted_prices"); return out; }
      previous = b.date;
      if (b.date > context.expected) continue;
      if (!sessions.has(b.date)) { out.reasons.push("price_outside_supplied_calendar"); return out; }
      if (!finite(b.close) || b.close <= 0) { out.reasons.push("invalid_close"); return out; }
      if (!benchmark && (!["open", "high", "low", "volume", "amount"].every(k => finite(b[k])) ||
          b.low <= 0 || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.low > b.high ||
          b.volume < 0 || b.amount < 0)) { out.reasons.push("invalid_ohlcv_or_amount"); return out; }
      out.bars.push(benchmark ? {date: b.date, close: b.close, high: b.close, low: b.close, open: b.close, volume: 0, amount: 0} : b);
    }
    if (!out.bars.length || out.bars[out.bars.length - 1].date !== context.expected) out.reasons.push("stale_prices");
    if (out.bars.length) {
      const required = context.sessions.filter(s => s.date >= out.bars[0].date);
      if (required.length !== out.bars.length) out.reasons.push("missing_sessions_include_zero_volume_suspension_bars");
    }
    out.valid = !out.reasons.length;
    return out;
  }
  function financialGate(stock, profile, context, asOf) {
    const errors = [], audit = [], notes = [];
    const cut = time(asOf), statements = Array.isArray(stock.financials) ? stock.financials : [];
    const available = statements.filter(f => time(f.published_at) !== null && time(f.published_at) <= cut);
    const byQuarter = new Map();
    for (const f of available) {
      if (!Number.isInteger(f.fiscal_year) || !Number.isInteger(f.quarter) || f.quarter < 1 || f.quarter > 4 ||
          !dateValid(f.period_end) || f.period_end > f.published_at.slice(0, 10)) { errors.push("invalid_financial_period"); continue; }
      const key = f.fiscal_year + ":" + f.quarter, old = byQuarter.get(key);
      if (old && old.published_at === f.published_at && canonical(old) !== canonical(f)) errors.push("conflicting_financial_versions");
      if (!old || time(old.published_at) < time(f.published_at)) byQuarter.set(key, f);
    }
    const ordered = Array.from(byQuarter.values()).sort((a, b) => a.period_end.localeCompare(b.period_end));
    const latest = ordered[ordered.length - 1];
    let current = null, prior = null, growth = null, eps = null;
    const get = (y, q) => byQuarter.get(y + ":" + q);
    if (latest) {
      const ly = get(latest.fiscal_year - 1, latest.quarter);
      const cp = latest.quarter > 1 ? get(latest.fiscal_year, latest.quarter - 1) : null;
      const pp = latest.quarter > 1 ? get(latest.fiscal_year - 1, latest.quarter - 1) : null;
      const fy = latest.quarter < 4 ? get(latest.fiscal_year - 1, 4) : latest;
      const required = [latest, ly].concat(latest.quarter > 1 ? [cp, pp] : []).concat(latest.quarter < 4 ? [fy] : []);
      if (required.some(f => !f)) errors.push("quarter_or_ttm_components_missing");
      const unique = Array.from(new Set(required.filter(Boolean)));
      audit.push(...unique.map(f => ({period_end: f.period_end, published_at: f.published_at, source: f.source, fiscal_year: f.fiscal_year, quarter: f.quarter})));
      if (unique.some(f => !f.source || f.point_in_time_verified !== true)) errors.push("financial_lineage_unverified");
      if (unique.some(f => f.profit_basis !== (stock.market === "CN" ? "attributable_to_parent" : "attributable_to_common")))
        errors.push("net_profit_basis_mismatch");
      if (new Set(unique.map(f => f.currency)).size !== 1 || unique.some(f => !f.currency)) errors.push("financial_currencies_inconsistent");
      const epsParts = latest.quarter === 4 ? [latest] : [latest, ly, fy];
      if (epsParts.some(f => !f || f.eps_basis !== "basic" || !f.share_basis_id || f.eps_comparable !== true) ||
          new Set(epsParts.filter(Boolean).map(f => f.share_basis_id)).size !== 1) errors.push("eps_basis_incomparable");
      if (finite(latest.net_income_ytd) && (latest.quarter === 1 || cp && finite(cp.net_income_ytd)))
        current = latest.net_income_ytd - (cp ? cp.net_income_ytd : 0);
      if (ly && finite(ly.net_income_ytd) && (latest.quarter === 1 || pp && finite(pp.net_income_ytd)))
        prior = ly.net_income_ytd - (pp ? pp.net_income_ytd : 0);
      if (finite(current) && finite(prior) && prior !== 0) growth = (current - prior) / Math.abs(prior) * 100;
      if (latest.quarter === 4 && finite(latest.eps_ytd)) eps = latest.eps_ytd;
      else if (latest && ly && fy && [latest.eps_ytd, ly.eps_ytd, fy.eps_ytd].every(finite)) eps = fy.eps_ytd + latest.eps_ytd - ly.eps_ytd;
      if (finite(prior) && prior <= 0) notes.push("nonpositive_prior_profit_base");
      if (finite(prior) && finite(current) && Math.sign(prior) !== Math.sign(current)) notes.push("profit_sign_reversal");
      notes.push("EPS_TTM_is_comparable_YTD_rollforward_proxy");
    } else errors.push("no_financial_report_available_at_asof");
    if (stock.financials_verified !== true) errors.push("financial_dataset_completeness_unverified");
    if (!context.valid || stock.quote_date !== context.expected || time(stock.quote_published_at) === null || time(stock.quote_published_at) > cut ||
        !stock.quote_source) errors.push("cap_snapshot_unverified_or_stale");
    if (stock.cap_basis !== profile.capBasis) errors.push("cap_basis_mismatch");
    if (finite(stock.cap_value) && stock.cap_value <= 0) errors.push("invalid_market_cap");
    if (stock.currency !== profile.currency) errors.push("quote_currency_mismatch");
    if (stock.market === "US" && profile.adaptationAcknowledged !== true) errors.push("US_adaptation_not_acknowledged");
    const checks = {
      profit_yoy: finite(growth) ? growth > profile.profitYoYMin : null,
      eps: finite(eps) ? eps > profile.epsMin : null,
      market_cap: finite(stock.cap_value) && finite(profile.capMin) && finite(profile.capMax) ?
        stock.cap_value >= profile.capMin && stock.cap_value <= profile.capMax : null
    };
    return {...gate(checks, errors), profit_yoy_pct: growth, eps_ttm: eps, current_quarter_profit: current,
      prior_quarter_profit: prior, cap_value: stock.cap_value ?? null, cap_basis: stock.cap_basis,
      report_period: latest ? latest.period_end : null, publication: latest ? latest.published_at : null, components: audit, notes};
  }
  function tradabilityGate(stock, profile, context, priceData) {
    const s = stock.status || {}, errors = [];
    if (!context.valid || s.date !== context.expected || s.verified !== true || !s.source) errors.push("status_unverified_or_stale");
    if (!priceData.valid) errors.push(...priceData.reasons);
    const last20 = priceData.bars.slice(-20);
    const amount = last20.length === 20 && priceData.valid ? mean(last20.map(b => b.amount)) : null;
    const checks = {
      liquidity: finite(amount) && finite(profile.amountMin) ? amount >= profile.amountMin : null,
      listing_age: Number.isInteger(s.listing_sessions) && s.listing_sessions >= 0 ? s.listing_sessions >= profile.listingMin : null,
      not_halted: bool(s.halted) ? !s.halted : null
    };
    if (stock.market === "CN") {
      checks.not_st = bool(s.is_st) ? !s.is_st : null;
      checks.no_persistent_locked_limits = Number.isInteger(s.locked_limit_count20) && s.locked_limit_count20 >= 0 && s.locked_limit_count20 <= 20 ?
        s.locked_limit_count20 < profile.lockedLimitMax : null;
    }
    return {...gate(checks, errors), average_amount20: amount, currency: profile.currency,
      not_applicable: stock.market === "US" ? ["CN_ST_rule", "CN_daily_price_limit_rule"] : []};
  }
  function monday(date) {
    const d = new Date(date + "T00:00:00Z"), day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1);
    return d.toISOString().slice(0, 10);
  }
  function tri(checks) {
    const values = Object.values(checks);
    return values.includes(false) ? false : values.some(v => v === null) ? null : true;
  }
  function choosePattern(checks, structuralStopHit = false) {
    const statuses = Object.fromEntries(STATES.map(s => [s, checks[s] ? tri(checks[s]) : null]));
    const confirmed = STATES.filter(s => statuses[s] === true);
    const state = structuralStopHit ? "Wedge Drop" : confirmed[0] || "Neutral";
    const candidates = STATES.filter(s => statuses[s] === null);
    const higherUnknown = candidates.filter(s => state === "Neutral" || STATES.indexOf(s) < STATES.indexOf(state));
    return {state, confirmed, candidates, higherUnknown};
  }
  function transition(previous, event) {
    if (event === "Neutral") return previous;
    if (previous === "Exhaustion Extension" && !["Base n' Break", "Wedge Drop"].includes(event)) return previous;
    if (previous === "Wedge Drop" && ["Base n' Break", "EMA Crossback", "Exhaustion Extension"].includes(event)) return previous;
    return event;
  }
  function classify(bars, benchmarkBars, p) {
    if (bars.length < p.warmup) return {state: "unknown", active_state: "unknown", reasons: ["insufficient_price_history"], trace: []};
    const ind = indicators(bars, p), bm = new Map(benchmarkBars.map(b => [b.date, b.close]));
    const weekly = [], weeksByIndex = [];
    let week = null, weekLow = null;
    for (const b of bars) {
      const w = monday(b.date);
      if (w !== week) { if (week !== null) weekly.push({week, low: weekLow}); week = w; weekLow = b.low; }
      else weekLow = Math.min(weekLow, b.low);
      weeksByIndex.push(weekly.length ? minimum(weekly.slice(-p.weeklySupportWeeks).map(x => x.low)) : null);
    }
    let active = "Neutral", lastReversal = -1, lastWP = -1, lastBase = -1, lastDrop = -1;
    let crossUsed = false, structuralStop = null, baseCount = 0, last = null;
    const trace = [];
    for (let i = p.warmup - 1; i < bars.length; i++) {
      const b = bars[i], prev = bars[i - 1], fast = ind.fast[i], slow = ind.slow[i], atr = ind.atr[i];
      const before = n => bars.slice(i - n, i), window = before(p.wedgeWindow);
      const high = maximum(window.map(x => x.high)), low = minimum(window.map(x => x.low));
      const avgVol = mean(before(p.volumeWindow).map(x => x.volume)), vr = avgVol > 0 ? b.volume / avgVol : null;
      const priorTR = median(ind.tr.slice(i - 2 * p.wedgeWindow, i - p.wedgeWindow));
      const contraction = priorTR > 0 ? median(ind.tr.slice(i - p.wedgeWindow, i)) / priorTR : null;
      const benchmarkStart = bm.get(bars[i - p.rsWindow].date), benchmarkEnd = bm.get(b.date);
      const rs = finite(benchmarkStart) && benchmarkStart > 0 && finite(benchmarkEnd) ?
        b.close / bars[i - p.rsWindow].close - benchmarkEnd / benchmarkStart : null;
      const support = minimum(before(p.supportWindow).map(x => x.low)), ws = weeksByIndex[i];
      const declining = prev.close < bars[i - p.rsWindow - 1].close && ind.slow[i - 1] < ind.slow[i - p.regimeWindow - 1];
      const bottom = before(p.bottomWindow), half = Math.floor(bottom.length / 2);
      const bottoming = prev.close < bars[i - p.supportWindow].close &&
        (maximum(bottom.map(x => x.high)) - minimum(bottom.map(x => x.low))) / minimum(bottom.map(x => x.low)) <= p.baseWidth &&
        minimum(bottom.slice(half).map(x => x.low)) >= minimum(bottom.slice(0, half).map(x => x.low));
      const checks = {};
      checks["Reversal Extension"] = {
        prior_decline: declining, downside_extension: b.low <= fast - p.extensionATR * atr,
        volume: finite(vr) ? vr >= p.extensionVolume : null,
        daily_and_completed_week_support: finite(ws) ? b.low <= support + p.supportToleranceATR * atr && b.low <= ws + p.supportToleranceATR * atr : null,
        reversal: b.close > b.open && b.close >= (b.high + b.low) / 2
      };
      checks["Wedge Pop"] = {
        prior_bottom: lastReversal > lastDrop || bottoming,
        contraction: finite(contraction) ? contraction <= p.contractionRatio : null,
        ema_convergence: Math.abs(fast - slow) / b.close <= p.wedgeSeparation,
        above_emas_and_pivot: b.close > Math.max(fast, slow, high),
        volume: finite(vr) ? vr >= p.breakVolume : null,
        relative_strength: finite(rs) ? rs > 0 : null
      };
      const near = b.low >= Math.min(fast, slow) - p.supportToleranceATR * atr && b.low <= Math.max(fast, slow) + p.supportToleranceATR * atr;
      const pullback = lastWP >= 0 ? bars.slice(lastWP + 1, i) : [];
      checks["EMA Crossback"] = {
        prior_wedge: lastWP > lastDrop, within_window: lastWP >= 0 && i - lastWP >= p.crossbackMin && i - lastWP <= p.crossbackMax,
        first_retest: !crossUsed, near_ema_band: near,
        selling_fades: pullback.length ? mean(pullback.map(x => x.volume)) < bars[lastWP].volume : false,
        bullish_support: b.close > Math.max(fast, slow) && ((b.close > b.open && b.close > prev.close) || b.close > prev.high)
      };
      let base = null;
      if (finite(vr) && vr >= p.breakVolume && b.close > high && b.close > slow && fast > slow) {
        for (let n = p.baseMin; n <= p.baseMax; n++) {
          const a = before(n), lo = minimum(a.map(x => x.low)), hi = maximum(a.map(x => x.high)), h = Math.floor(n / 2);
          const candidate = {
            established_uptrend: regimeAt(bars, ind, i - n - 1, p).regime === "uptrend",
            width: (hi - lo) / lo <= p.baseWidth && hi - lo <= p.baseMaxATR * ind.atr[i - 1],
            higher_lows: minimum(a.slice(h).map(x => x.low)) >= minimum(a.slice(0, h).map(x => x.low)),
            contracting_volume: mean(a.map(x => x.volume)) < mean(bars.slice(i - 2 * n, i - n).map(x => x.volume)),
            above_base: b.close > hi, breakout_volume: true
          };
          if (tri(candidate) === true) { base = {n, lo, hi, checks: candidate}; break; }
        }
      }
      checks["Base n' Break"] = base ? base.checks : {valid_complete_base: false};
      checks["Exhaustion Extension"] = {
        established_run: Math.max(lastWP, lastBase) > lastDrop,
        upside_extension: b.close >= fast + p.extensionATR * atr,
        volume: finite(vr) ? vr >= p.extensionVolume : null
      };
      checks["Wedge Drop"] = {below_ema20: b.close < slow, below_pivot: b.close < low, volume: finite(vr) ? vr >= p.breakVolume : null};
      const stopHit = finite(structuralStop) && b.close < structuralStop;
      const choice = choosePattern(checks, stopHit), previous = active;
      active = transition(active, choice.state);
      let trigger = null, invalidation = null;
      if (choice.state === "Wedge Pop") { trigger = high; invalidation = Math.min(fast, slow); }
      if (choice.state === "EMA Crossback") { trigger = Math.max(fast, slow); invalidation = minimum(bars.slice(lastWP, i + 1).map(x => x.low)); }
      if (choice.state === "Base n' Break") { trigger = base.hi; invalidation = base.lo; }
      const eventAccepted = choice.state === active && choice.state !== "Neutral";
      if (eventAccepted) {
        if (choice.state === "Reversal Extension") lastReversal = i;
        if (choice.state === "Wedge Pop") { lastWP = i; crossUsed = false; baseCount = 0; }
        if (choice.state === "EMA Crossback") crossUsed = true;
        if (choice.state === "Base n' Break") { lastBase = i; baseCount++; }
        if (choice.state === "Wedge Drop") { lastDrop = i; structuralStop = null; baseCount = 0; }
        if (ENTRY.includes(choice.state) && finite(invalidation)) structuralStop = Math.max(structuralStop || 0, invalidation);
      }
      if (choice.state !== "Neutral" || active !== previous) trace.push({
        date: b.date, event: choice.state, previous_state: previous, active_state: active,
        accepted: eventAccepted, structural_stop_hit: stopHit, stop_after_event: structuralStop,
        trigger, invalidation, base_count: baseCount
      });
      last = {...choice, active_state: active, previous_state: previous, trigger, invalidation, checks,
        structural_stop_hit: stopHit, state_transition_blocked: choice.state !== "Neutral" && !eventAccepted,
        evidence: {date: b.date, close: b.close, ema10: fast, ema20: slow, atr14: atr, volume_ratio: vr,
          rs20: rs, contraction_ratio: contraction, prior_pivot_high: high, prior_pivot_low: low,
          support_daily: support, support_completed_weeks: ws, base_length: base ? base.n : null},
        trace, reasons: []};
    }
    return last;
  }
  function decide(fundamental, tradability, technical, regime, extraReasons = []) {
    const reasons = [...extraReasons];
    if (fundamental.result !== "pass") reasons.push(...fundamental.reasons.map(r => "fundamental:" + r));
    if (tradability.result !== "pass") reasons.push(...tradability.reasons.map(r => "tradability:" + r));
    if (regime !== "uptrend") reasons.push("market:" + regime);
    if (!ENTRY.includes(technical.state)) reasons.push("not_at_entry_add_event");
    if (technical.higherUnknown && technical.higherUnknown.length) reasons.push("higher_priority_pattern_unknown");
    if (technical.state_transition_blocked) reasons.push("risk_state_not_resolved");
    if (ENTRY.includes(technical.state) && !(finite(technical.trigger) && finite(technical.invalidation) && technical.trigger > technical.invalidation && technical.invalidation > 0))
      reasons.push("invalid_structure_levels");
    reasons.push(...(technical.reasons || []));
    const eligible = reasons.length === 0 && fundamental.result === "pass" && tradability.result === "pass";
    let action = "watch";
    if (technical.active_state === "Wedge Drop") action = "exit / cash";
    else if (technical.active_state === "Exhaustion Extension") action = "reduce if held / do not chase";
    else if (eligible) action = technical.state === "Wedge Pop" ? "eligible first entry" : "eligible add";
    else if (fundamental.result === "fail") action = "skip";
    const incomplete = fundamental.result === "unknown" || tradability.result === "unknown" || regime === "unknown" ||
      technical.state === "unknown" || (technical.higherUnknown || []).length > 0 || extraReasons.length > 0;
    return {strategy_eligibility: eligible ? "eligible" : incomplete ? "insufficient_evidence" : "ineligible",
      action, blockers: Array.from(new Set(reasons)), confidence: incomplete ? "low" : eligible ? "high" : "medium"};
  }
  function validateBundle(bundle) {
    if (!bundle || bundle.schema_version !== 3 || time(bundle.as_of) === null || !Array.isArray(bundle.stocks) || !bundle.markets)
      throw new Error("Expected schema_version=3, timezone-aware as_of, markets and stocks[]");
    const u = bundle.universe;
    if (!u || !u.label || !["provided", "full_market"].includes(u.scope) || !Array.isArray(u.missing_partitions))
      throw new Error("Universe label, scope and missing_partitions[] required");
    if (u.expected_count !== null && (!Number.isInteger(u.expected_count) || u.expected_count < bundle.stocks.length))
      throw new Error("Universe expected_count must cover every supplied stock");
    const ids = new Set();
    for (const s of bundle.stocks) {
      if (!["CN", "US"].includes(s.market) || typeof s.ticker !== "string" ||
          !(s.market === "CN" ? /^\d{6}$/ : /^[A-Z0-9][A-Z0-9.-]{0,14}$/).test(s.ticker)) throw new Error("Invalid market/ticker identity");
      const id = s.market + ":" + s.ticker;
      if (ids.has(id)) throw new Error("Duplicate security: " + id);
      ids.add(id);
    }
  }
  async function evaluateBundle(bundle, config = clone(DEFAULTS), onProgress = null) {
    validateConfig(config); validateBundle(bundle);
    const contexts = {}, markets = {}, rows = [], p = config.technical;
    for (const market of new Set(bundle.stocks.map(s => s.market))) {
      const m = bundle.markets[market], ctx = calendarContext(m, config.markets[market], bundle.as_of);
      const prices = validateBars(m && m.benchmark ? m.benchmark.bars : null, ctx, {benchmark: true});
      const hasBenchmarkSource = m && m.benchmark && m.benchmark.id && m.benchmark.source;
      const regime = prices.valid && hasBenchmarkSource ? regimeAt(prices.bars, indicators(prices.bars, p), prices.bars.length - 1, p) :
        {regime: "unknown", reason: prices.reasons.join("; ") || "benchmark_source_missing"};
      contexts[market] = {ctx, benchmark: prices.valid && hasBenchmarkSource ? prices.bars : [], regime,
        benchmarkReturnVerified: !!(m && m.benchmark && m.benchmark.return_basis === "total_return")};
      markets[market] = {session: ctx.expected, ...regime, benchmark: m && m.benchmark ? m.benchmark.id : null,
        currency: config.markets[market].currency, cap_basis: config.markets[market].capBasis};
    }
    for (let i = 0; i < bundle.stocks.length; i++) {
      const s = bundle.stocks[i], profile = config.markets[s.market], c = contexts[s.market];
      const prices = validateBars(s.bars, c.ctx), extra = [];
      if (!c.benchmarkReturnVerified) extra.push("benchmark_total_return_basis_unverified");
      if (!s.name || !s.name_source) extra.push("security_name_source_missing");
      if (s.instrument_type !== "common_stock" && s.instrument_type !== "adr") extra.push("instrument_not_supported_by_equity_earnings_gate");
      const f = financialGate(s, profile, c.ctx, bundle.as_of);
      const t = tradabilityGate(s, profile, c.ctx, prices);
      if (!s.price_source || !s.adjustment || s.adjustment.point_in_time_verified !== true ||
          !["split_dividend_adjusted", "split_adjusted"].includes(s.adjustment.basis) ||
          time(s.adjustment.anchor_at) === null || time(s.adjustment.anchor_at) > time(bundle.as_of)) extra.push("price_adjustment_lineage_unverified");
      const tech = prices.valid && !extra.includes("price_adjustment_lineage_unverified") ? classify(prices.bars, c.benchmark, p) :
        {state: "unknown", active_state: "unknown", reasons: prices.reasons.concat(extra.filter(x => x.includes("adjustment"))), trace: []};
      if (s.adjustment && s.adjustment.basis === "split_adjusted") extra.push("total_return_adjustment_required_for_RS");
      const decision = decide(f, t, tech, c.regime.regime, extra);
      rows.push({market: s.market, ticker: s.ticker, name: s.name || "", session: c.ctx.expected,
        currency: profile.currency, fundamental_result: f.result, tradability_result: t.result,
        profit_yoy_pct: f.profit_yoy_pct, eps_ttm: f.eps_ttm, cap_value: f.cap_value, cap_basis: profile.capBasis,
        average_amount20: t.average_amount20, market_regime: c.regime.regime,
        pattern_state: tech.state, active_cycle_state: tech.active_state, ...decision,
        trigger: tech.trigger ?? null, invalidation: tech.invalidation ?? null,
        fundamental: f, tradability: t, technical: tech,
        research_status: s.market === "US" ? "US adaptation; not empirically validated" : "research model; not empirically validated"});
      if (onProgress && (i % 20 === 0 || i === bundle.stocks.length - 1)) onProgress(i + 1, bundle.stocks.length);
    }
    const counts = {total: rows.length, fundamental_pass: 0, fundamental_fail: 0, fundamental_unknown: 0, fundamental_and_tradable: 0, eligible: 0};
    for (const r of rows) {
      counts["fundamental_" + r.fundamental_result]++;
      if (r.fundamental_result === "pass" && r.tradability_result === "pass") counts.fundamental_and_tradable++;
      if (r.strategy_eligibility === "eligible") counts.eligible++;
    }
    if (!(counts.eligible <= counts.fundamental_and_tradable && counts.fundamental_and_tradable <= counts.fundamental_pass)) throw new Error("Gate invariant failed");
    const u = bundle.universe;
    const snapshotFresh = time(u.snapshot_at) !== null && Object.keys(contexts).every(m =>
      contexts[m].ctx.valid && dateInZone(u.snapshot_at, config.markets[m].timezone) >= contexts[m].ctx.expected);
    const coverage = u.expected_count === rows.length && u.coverage_verified === true && !!u.source && snapshotFresh &&
      time(u.snapshot_at) <= time(bundle.as_of) && u.missing_partitions.length === 0;
    const manifest = {tool: "Stock Cycle Lab", version: VERSION, as_of: bundle.as_of, demo: bundle.demo === true,
      config_sha256: await hash(canonical(config)), input_sha256: await hash(canonical(bundle)),
      universe: u, coverage_complete: coverage, full_market_verified: coverage && u.scope === "full_market",
      markets, counts, config, warning: "Offline research classification. No live data subscription, order execution or return guarantee."};
    return {manifest, results: rows};
  }
  function toCSV(result) {
    const keys = ["market", "ticker", "name", "session", "currency", "fundamental_result", "profit_yoy_pct", "eps_ttm",
      "cap_value", "cap_basis", "tradability_result", "average_amount20", "market_regime", "pattern_state",
      "active_cycle_state", "strategy_eligibility", "action", "trigger", "invalidation", "confidence", "blockers"];
    const cell = value => {
      let text = Array.isArray(value) ? value.join("; ") : value === null || value === undefined ? "" : String(value);
      if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return "\uFEFF" + [keys.map(cell).join(","), ...result.results.map(r => keys.map(k => cell(r[k])).join(","))].join("\r\n");
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    const rows = []; let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
      } else if (c === "," && !quoted) { row.push(field); field = ""; }
      else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); if (row.some(x => x !== "")) rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (quoted) throw new Error("Unclosed CSV quote");
    row.push(field); if (row.some(x => x !== "")) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift();
    if (new Set(headers).size !== headers.length || headers.some(h => ["__proto__", "constructor", "prototype"].includes(h))) throw new Error("Invalid CSV headers");
    return rows.map((cells, index) => {
      if (cells.length !== headers.length) throw new Error("CSV column mismatch at row " + (index + 2));
      return Object.fromEntries(headers.map((k, i) => [k, cells[i]]));
    });
  }
  return {VERSION, STATES, ENTRY, DEFAULTS, clone, finite, time, dateInZone, canonical, hash, safeJSON,
    validateConfig, withOverrides, gate, indicators, regimeAt, calendarContext, validateBars, financialGate,
    tradabilityGate, choosePattern, transition, classify, decide, evaluateBundle, toCSV, parseCSV};
});
