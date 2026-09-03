"use strict";
const E = require("./engine.js"), D = require("./demo.js");
const count = Number(process.argv[2] || 1000);
if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error("count must be 1..20000");
const d = D.makeDemo(), prototype = d.bundle.stocks[0];
d.bundle.stocks = Array.from({length: count}, (_, i) => ({...prototype, ticker: String(100000 + i), name: "SYNTHETIC-" + i}));
d.bundle.universe.expected_count = count;
d.bundle.universe.label = "SYNTHETIC scale test; not a real market universe";
const start = performance.now();
E.evaluateBundle(d.bundle, d.config, (done, total) => { if (done % 1000 === 1) console.log("processed " + done + "/" + total); }).then(r => {
  console.log(JSON.stringify({count, bars_per_stock: prototype.bars.length, elapsed_seconds: (performance.now() - start) / 1000,
    peak_rss_mb: process.resourceUsage().maxRSS / 1024, counts: r.manifest.counts, synthetic: true}));
}).catch(e => { console.error(e); process.exitCode = 1; });
