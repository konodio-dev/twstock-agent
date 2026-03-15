const fs = require("fs");
const path = require("path");
const { runFullUpdate } = require("./src/fetcher");

const OUT = path.join(__dirname, "output");

async function main() {
  console.log("台股日監測 Agent — 資料更新 v2.0");
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  try {
    const data = await runFullUpdate();
    const dateStr = data.date;

    fs.writeFileSync(path.join(OUT, "stock-data-" + dateStr + ".json"), JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(data, null, 2));

    const { WATCHLIST } = require("./src/fetcher");
    const ids = [...WATCHLIST.tse, ...WATCHLIST.otc];
    const slim = { ...data, stocks: Object.fromEntries(Object.entries(data.stocks).filter(([id]) => ids.includes(id))) };
    fs.writeFileSync(path.join(OUT, "watchlist.json"), JSON.stringify(slim));

    console.log("Done! Files saved to backend/output/");
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
}
main();
