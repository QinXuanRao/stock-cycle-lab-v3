(function () {
  "use strict";
  const E = StockCycle, $ = id => document.getElementById(id);
  let bundle = null, config = E.clone(E.DEFAULTS), report = null, worker = null, page = 0;
  const pageSize = 100;
  const fmt = (n, digits = 2) => E.finite(n) ? n.toLocaleString("zh-CN", {maximumFractionDigits: digits}) : "未知";
  function status(text, error = false) { $("status").textContent = text; $("status").className = "status " + (error ? "error" : "muted"); }
  function download(name, content, type = "application/json") {
    const url = URL.createObjectURL(new Blob([content], {type: type + ";charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function invalidate() {
    if (worker) { worker.terminate(); worker = null; $("cancel").disabled = true; $("run").disabled = !bundle; }
    report = null; page = 0;
    for (const id of ["export-json", "export-csv", "manifest"]) $(id).disabled = true;
    for (const id of ["count-total", "count-fund", "count-dual", "count-eligible"]) $(id).textContent = "—";
    $("coverage").textContent = "覆盖率：等待重新评估"; $("run-meta").textContent = ""; render();
  }
  function populateConfig() {
    const m = $("profile-market").value, profile = config.markets[m], scale = m === "CN" ? 1e8 : 1e6;
    const unit = m === "CN" ? "亿元 CNY" : "百万美元 USD";
    $("cap-min-label").textContent = "市值下限（" + unit + "）";
    $("cap-max-label").textContent = "市值上限（" + unit + "）";
    $("amount-label").textContent = "20日均成交额下限（" + unit + "）";
    $("cap-min").value = profile.capMin === null ? "" : profile.capMin / scale;
    $("cap-max").value = profile.capMax === null ? "" : profile.capMax / scale;
    $("amount-min").value = profile.amountMin === null ? "" : profile.amountMin / scale;
    $("profit-min").value = profile.profitYoYMin;
    $("cap-basis").value = profile.capBasis;
    for (const option of $("cap-basis").options) option.disabled = m === "CN" ? option.value !== "circulating_a_share" : option.value === "circulating_a_share";
    $("us-ack-row").classList.toggle("hidden", m !== "US"); $("us-ack").checked = config.markets.US.adaptationAcknowledged;
    $("config-json").value = JSON.stringify(config, null, 2);
  }
  function load(data, demoConfig = null) {
    if (worker) { worker.terminate(); worker = null; $("cancel").disabled = true; }
    if (!data || data.schema_version !== 3 || !Array.isArray(data.stocks)) throw new Error("请选择 schema_version=3 的数据包，格式见空模板和说明");
    if (bundle && bundle.demo === true && data.demo !== true) config = E.clone(E.DEFAULTS);
    bundle = data;
    if (demoConfig) config = demoConfig;
    invalidate(); populateConfig();
    $("input-info").textContent = (data.universe ? data.universe.label : "未命名股票池") + " · " + data.stocks.length + " 只 · 截至 " + data.as_of;
    $("demo-banner").classList.toggle("hidden", data.demo !== true);
    $("run").disabled = false; $("download-input").disabled = false;
    status(data.demo ? "合成演示已加载。点击运行评估。" : "数据已加载。请检查市场参数，然后运行。");
  }
  function showDetail(title, value) {
    $("detail-title").textContent = title;
    $("detail-text").textContent = JSON.stringify(value, null, 2);
    $("detail-dialog").showModal();
  }
  function badge(value) {
    const el = document.createElement("span");
    el.className = "badge " + (value === "pass" || value === "eligible" ? "pass" : value === "fail" || value === "ineligible" ? "fail" : "unknown");
    el.textContent = ({pass: "通过", fail: "未通过", unknown: "未知", eligible: "符合", ineligible: "不符合", insufficient_evidence: "证据不足"})[value] || value;
    return el;
  }
  function render() {
    const body = $("results-body"); body.replaceChildren();
    if (!report) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 9; td.className = "empty"; td.textContent = "等待评估。更换输入或参数后，旧结果会清空。"; tr.append(td); body.append(tr);
      $("page-info").textContent = ""; $("prev-page").disabled = true; $("next-page").disabled = true; return;
    }
    const q = $("search").value.trim().toLowerCase(), layer = $("layer").value;
    const rows = report.results.filter(r => (!q || (r.market + r.ticker + r.name).toLowerCase().includes(q)) &&
      (layer === "all" || layer === "eligible" && r.strategy_eligibility === "eligible" ||
       layer === "dual" && r.fundamental_result === "pass" && r.tradability_result === "pass" ||
       layer === "fundamental" && r.fundamental_result === "pass" ||
       layer === "unknown" && r.strategy_eligibility === "insufficient_evidence"));
    page = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    for (const r of rows.slice(page * pageSize, (page + 1) * pageSize)) {
      const tr = document.createElement("tr");
      const cell = (text, secondary = null) => {
        const td = document.createElement("td");
        if (text instanceof Node) td.append(text); else td.textContent = text;
        if (secondary) { const span = document.createElement("span"); span.className = "secondary"; span.textContent = secondary; td.append(span); }
        tr.append(td); return td;
      };
      cell(r.market + ":" + r.ticker, r.name); cell(badge(r.fundamental_result));
      cell(fmt(r.profit_yoy_pct) + "% / " + fmt(r.eps_ttm, 4));
      cell(badge(r.tradability_result), "日均 " + fmt(E.finite(r.average_amount20) ? r.average_amount20 / 1e6 : null) + " 百万 " + r.currency);
      cell(r.market_regime); cell(r.pattern_state, "活动周期：" + r.active_cycle_state);
      cell(badge(r.strategy_eligibility)); cell(r.action);
      const button = document.createElement("button"); button.className = "small"; button.textContent = "查看";
      button.onclick = () => showDetail(r.market + ":" + r.ticker + " · " + r.name, r);
      cell(button); body.append(tr);
    }
    if (!rows.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 9; td.className = "empty"; td.textContent = "此筛选层没有股票。零候选是有效结果，不会自动放宽门槛。"; tr.append(td); body.append(tr); }
    $("page-info").textContent = rows.length + " 条 · 第 " + (page + 1) + " / " + Math.max(1, Math.ceil(rows.length / pageSize)) + " 页";
    $("prev-page").disabled = page === 0; $("next-page").disabled = (page + 1) * pageSize >= rows.length;
  }
  $("profile-market").onchange = populateConfig;
  $("apply-profile").onclick = () => {
    try {
      const m = $("profile-market").value, scale = m === "CN" ? 1e8 : 1e6;
      const n = id => $(id).value.trim() === "" ? null : Number($(id).value);
      const edits = {};
      for (const [id, key] of [["cap-min", "capMin"], ["cap-max", "capMax"], ["amount-min", "amountMin"]]) edits["markets." + m + "." + key] = n(id) === null ? null : n(id) * scale;
      edits["markets." + m + ".profitYoYMin"] = n("profit-min");
      edits["markets." + m + ".capBasis"] = $("cap-basis").value;
      if (m === "US") edits["markets.US.adaptationAcknowledged"] = $("us-ack").checked;
      config = E.withOverrides(config, edits, "Explicit local user parameter entry");
      populateConfig(); invalidate(); status("参数已应用并记录。请重新运行评估。");
    } catch (e) { status(e.message, true); }
  };
  $("apply-config").onclick = () => { try { config = E.validateConfig(E.safeJSON($("config-json").value)); populateConfig(); invalidate(); status("配置已应用。请重新运行。"); } catch (e) { status(e.message, true); } };
  $("reset-config").onclick = () => { config = E.clone(E.DEFAULTS); populateConfig(); invalidate(); status("已恢复默认；美股美元门槛留空。"); };
  $("export-config").onclick = () => download("stock-cycle-config.json", JSON.stringify(config, null, 2));
  $("data-files").onchange = async event => {
    try {
      const files = {};
      for (const file of event.target.files) { if (file.name in files) throw new Error("同名文件重复"); files[file.name] = await file.text(); }
      load(StockCycleAdapters.fromFiles(files));
    } catch (e) { bundle = null; invalidate(); $("run").disabled = true; $("download-input").disabled = true; $("input-info").textContent = "新输入加载失败；未保留旧数据作为运行输入。"; status(e.message, true); }
  };
  $("paste-load").onclick = () => { try { load(E.safeJSON($("paste-data").value)); } catch (e) { bundle = null; invalidate(); $("run").disabled = true; $("download-input").disabled = true; status(e.message, true); } };
  $("demo").onclick = () => { const demo = StockCycleDemo.makeDemo(); load(demo.bundle, demo.config); };
  $("download-input").onclick = () => download(bundle.demo ? "synthetic-demo-input.json" : "stock-cycle-input.json", JSON.stringify(bundle, null, 2));
  $("template").onclick = () => download("input-template.json", JSON.stringify({
    schema_version: 3, demo: false, as_of: null,
    universe: {label: "", scope: "provided", expected_count: null, source: "", snapshot_at: null, coverage_verified: false, missing_partitions: []},
    markets: {CN: {calendar_source: "", calendar_verified_through: null, calendar: [], benchmark: {id: "", source: "", return_basis: "total_return", bars: []}},
      US: {calendar_source: "", calendar_verified_through: null, calendar: [], benchmark: {id: "", source: "", return_basis: "total_return", bars: []}}},
    stocks: [], schema_help: "Full field definitions and CSV headers are in the distributed DATA_FORMAT.md; demo shows a complete synthetic stock record."
  }, null, 2));
  $("run").onclick = () => {
    if (!bundle || worker) return;
    try {
      E.validateConfig(config); invalidate(); $("run").disabled = true; $("cancel").disabled = false;
      status("正在本地计算，请稍候…");
      const source = $("engine-source").textContent;
      const tail = "\nself.onmessage=async function(e){try{const r=await StockCycle.evaluateBundle(e.data.bundle,e.data.config,(done,total)=>self.postMessage({progress:{done,total}}));r.manifest.engine_sha256=await StockCycle.hash(e.data.engineSource);self.postMessage({result:r});}catch(x){self.postMessage({error:x.message});}};";
      const url = URL.createObjectURL(new Blob([source, tail], {type: "application/javascript"}));
      worker = new Worker(url); URL.revokeObjectURL(url);
      worker.onmessage = event => {
        if (event.data.progress) { status("已计算 " + event.data.progress.done + " / " + event.data.progress.total + " 只"); return; }
        worker.terminate(); worker = null; $("run").disabled = false; $("cancel").disabled = true;
        if (event.data.error) { status(event.data.error, true); return; }
        report = event.data.result;
        const c = report.manifest.counts;
        for (const [id, key] of [["count-total", "total"], ["count-fund", "fundamental_pass"], ["count-dual", "fundamental_and_tradable"], ["count-eligible", "eligible"]]) $(id).textContent = c[key].toLocaleString();
        $("coverage").textContent = report.manifest.full_market_verified ? "全市场覆盖：已按输入证据核验" :
          report.manifest.coverage_complete ? "提供的股票池：覆盖完整（非全市场声明）" : "覆盖不完整 / 未核验，不能称全市场结果";
        $("run-meta").textContent = "版本 " + report.manifest.version + " · 截至 " + report.manifest.as_of +
          " · 配置 SHA256 " + report.manifest.config_sha256;
        for (const id of ["export-json", "export-csv", "manifest"]) $(id).disabled = false;
        render(); status("评估完成 · 未知基本面 " + c.fundamental_unknown + " 只 · 完整策略资格 " + c.eligible + " 只" + (bundle.demo ? " · 合成演示" : ""));
      };
      worker.onerror = event => { worker.terminate(); worker = null; $("run").disabled = false; $("cancel").disabled = true; status("计算失败：" + event.message, true); };
      worker.postMessage({bundle, config, engineSource: source});
    } catch (e) { if (worker) worker.terminate(); worker = null; $("run").disabled = false; $("cancel").disabled = true; status(e.message, true); }
  };
  $("cancel").onclick = () => { if (worker) worker.terminate(); worker = null; $("cancel").disabled = true; $("run").disabled = !bundle; status("已取消，不生成部分结果。"); };
  $("export-json").onclick = () => download("stock-cycle-results.json", JSON.stringify(report, null, 2));
  $("export-csv").onclick = () => download("stock-cycle-results.csv", E.toCSV(report), "text/csv");
  $("manifest").onclick = () => showDetail("运行清单 / Manifest", report.manifest);
  $("close-detail").onclick = () => $("detail-dialog").close();
  $("search").oninput = $("layer").onchange = () => { page = 0; render(); };
  $("prev-page").onclick = () => { page--; render(); }; $("next-page").onclick = () => { page++; render(); };
  populateConfig();
})();
