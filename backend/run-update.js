const fs = require("fs");
const path = require("path");
const { runFullUpdate, WATCHLIST } = require("./src/fetcher");

const OUT = path.join(__dirname, "output");

async function main() {
  console.log("Stock Agent v3.0 — TW + US Combined Update");
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  try {
    var data = await runFullUpdate();
    var dateStr = data.date;

    // 完整版
    fs.writeFileSync(path.join(OUT, "stock-data-" + dateStr + ".json"), JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(data, null, 2));

    // 精簡版（只有追蹤清單）
    var twIds = WATCHLIST.tse.concat(WATCHLIST.otc);
    var slim = {
      version: data.version,
      generated: data.generated,
      date: data.date,
      tw_stocks: Object.fromEntries(Object.entries(data.tw_stocks).filter(function(e) { return twIds.includes(e[0]); })),
      us_stocks: data.us_stocks,
      us_indices: data.us_indices,
      correlation_alerts: data.correlation_alerts,
    };
    fs.writeFileSync(path.join(OUT, "watchlist.json"), JSON.stringify(slim));

    console.log("Done! " + Object.keys(data.tw_stocks).length + " TW + " + Object.keys(data.us_stocks).length + " US stocks saved.");
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
}
main();
