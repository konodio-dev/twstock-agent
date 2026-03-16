const fs = require("fs");
const path = require("path");
const { runFullUpdate, WATCHLIST } = require("./src/fetcher");

const OUT = path.join(__dirname, "output");

async function main() {
  console.log("Stock Agent v4.0 — TW + US + IPO + TI + AI");
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  try {
    var data = await runFullUpdate();
    var dateStr = data.date;

    // 完整版
    fs.writeFileSync(path.join(OUT, "stock-data-" + dateStr + ".json"), JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(data, null, 2));

    // 精簡版
    var twIds = WATCHLIST.tse.concat(WATCHLIST.otc);
    var slim = {
      version: data.version,
      generated: data.generated,
      date: data.date,
      tw_index: data.tw_index,
      tw_stocks: Object.fromEntries(Object.entries(data.tw_stocks).filter(function(e) { return twIds.includes(e[0]); })),
      us_stocks: data.us_stocks || {},
      us_indices: data.us_indices || {},
      ipo: data.ipo || [],
      market_stats: data.market_stats || {},
      ai_signals: data.ai_signals || [],
      news_alerts: data.news_alerts || [],
      correlation_alerts: data.correlation_alerts || [],
    };
    fs.writeFileSync(path.join(OUT, "watchlist.json"), JSON.stringify(slim));

    var twCount = Object.keys(data.tw_stocks).length;
    var usCount = data.us_stocks ? Object.keys(data.us_stocks).length : 0;
    var ipoCount = data.ipo ? data.ipo.length : 0;
    var tiCount = data.ai_signals ? data.ai_signals.length : 0;
    console.log("Done! TW:" + twCount + " US:" + usCount + " IPO:" + ipoCount + " AI:" + tiCount);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
}
main();
