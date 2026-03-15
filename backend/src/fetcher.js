const DATA_SOURCES = {
  TWSE_DAILY_ALL: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TWSE_REALTIME: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
  TPEX_DAILY: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  TWSE_INSTITUTIONAL: "https://www.twse.com.tw/rwd/zh/fund/T86?response=json",
  TWSE_PE_RATIO: "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
  TWSE_DIVIDEND: "https://openapi.twse.com.tw/v1/opendata/t187ap45_L",
  TWSE_COMPANY: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
};

const WATCHLIST = {
  tse: ["2330","2454","2317","2382","2881","2882","2886","2603","2327","2345","2357","3037","3443","3661","3711","4919","6488","6669","6770"],
  otc: ["6547","3293","5765","6781"],
};

function getDateStr(offset) {
  offset = offset || 0;
  var d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0");
}

async function safeFetch(url, opts, retries) {
  opts = opts || {};
  retries = retries || 3;
  for (var i = 0; i < retries; i++) {
    try {
      var res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ "User-Agent": "TWStock-Agent/2.0" }, opts.headers || {}) }));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res;
    } catch (err) {
      console.error("  Retry " + (i+1) + "/" + retries + " for " + url + ": " + err.message);
      if (i === retries - 1) throw err;
      await new Promise(function(r) { setTimeout(r, 2000 * (i+1)); });
    }
  }
}

async function fetchStockPrices() {
  console.log("Fetching stock prices...");
  try {
    var res = await safeFetch(DATA_SOURCES.TWSE_DAILY_ALL);
    var raw = await res.json();
    var prices = {};
    if (Array.isArray(raw)) {
      raw.forEach(function(row) {
        var code = (row.Code || row["證券代號"] || "").trim();
        if (!code) return;
        var close = parseFloat(row.ClosingPrice || row["收盤價"]) || 0;
        var change = parseFloat(row.Change || row["漲跌價差"]) || 0;
        var prev = close - change;
        prices[code] = {
          id: code, name: (row.Name || row["證券名稱"] || "").trim(),
          price: close, open: parseFloat(row.OpeningPrice || row["開盤價"]) || 0,
          high: parseFloat(row.HighestPrice || row["最高價"]) || 0,
          low: parseFloat(row.LowestPrice || row["最低價"]) || 0,
          prev: prev, change: change,
          changeP: prev > 0 ? ((change / prev) * 100).toFixed(2) : "0.00",
          volume: parseInt((row.TradeVolume || row["成交股數"] || "0").replace(/,/g, "")) || 0,
          market: "tse",
        };
      });
    }
    try {
      var res2 = await safeFetch(DATA_SOURCES.TPEX_DAILY);
      var raw2 = await res2.json();
      if (Array.isArray(raw2)) {
        raw2.forEach(function(row) {
          var code = (row.SecuritiesCompanyCode || row["股票代號"] || "").trim();
          if (!code) return;
          var close = parseFloat(row.Close || row["收盤"]) || 0;
          var change = parseFloat(row.Change || row["漲跌"]) || 0;
          var prev = close - change;
          prices[code] = {
            id: code, name: (row.CompanyName || row["公司名稱"] || "").trim(),
            price: close, prev: prev, change: change,
            changeP: prev > 0 ? ((change / prev) * 100).toFixed(2) : "0.00",
            volume: parseInt((row.TradingShares || row["成交股數"] || "0").replace(/,/g, "")) || 0,
            market: "otc",
          };
        });
      }
    } catch(e) { console.error("  TPEx failed:", e.message); }
    console.log("  Got " + Object.keys(prices).length + " stocks");
    return prices;
  } catch (err) { console.error("  Error:", err.message); return {}; }
}

async function fetchInstitutional() {
  console.log("Fetching institutional...");
  try {
    var url = DATA_SOURCES.TWSE_INSTITUTIONAL + "&date=" + getDateStr() + "&selectType=ALLBUT0999";
    var res = await safeFetch(url);
    var data = await res.json();
    var inst = {};
    if (data.data) {
      data.data.forEach(function(row) {
        var code = (row[0] || "").trim();
        if (!code) return;
        function p(v) { return parseInt((v || "0").replace(/,/g, "")) || 0; }
        inst[code] = {
          id: code, name: (row[1] || "").trim(),
          foreign_buy: Math.round(p(row[4]) / 1000),
          trust_buy: Math.round(p(row[10]) / 1000),
          dealer_buy: Math.round(p(row[13]) / 1000),
          total: Math.round(p(row[17]) / 1000),
        };
      });
    }
    console.log("  Got " + Object.keys(inst).length + " records");
    return inst;
  } catch (err) { console.error("  Error:", err.message); return {}; }
}

async function fetchPERatio() {
  console.log("Fetching PE ratios...");
  try {
    var res = await safeFetch(DATA_SOURCES.TWSE_PE_RATIO);
    var raw = await res.json();
    var ratios = {};
    if (Array.isArray(raw)) {
      raw.forEach(function(row) {
        var code = (row.Code || row["證券代號"] || "").trim();
        if (!code) return;
        ratios[code] = {
          id: code, name: (row.Name || row["證券名稱"] || "").trim(),
          pe: parseFloat(row.PEratio || row["本益比"]) || 0,
          dividend_yield: parseFloat(row.DividendYield || row["殖利率(%)"]) || 0,
          pb: parseFloat(row.PBratio || row["股價淨值比"]) || 0,
        };
      });
    }
    console.log("  Got " + Object.keys(ratios).length + " records");
    return ratios;
  } catch (err) { console.error("  Error:", err.message); return {}; }
}

async function fetchDividend() {
  console.log("Fetching dividends...");
  try {
    var res = await safeFetch(DATA_SOURCES.TWSE_DIVIDEND);
    var raw = await res.json();
    var divs = {};
    if (Array.isArray(raw)) {
      raw.forEach(function(row) {
        var code = (row["公司代號"] || "").trim();
        if (!code) return;
        if (!divs[code]) divs[code] = [];
        divs[code].push({
          year: row["股利年度"],
          cash: parseFloat(row["股東配發-盈餘分配之現金股利(元/股)"]) || 0,
        });
      });
    }
    console.log("  Got " + Object.keys(divs).length + " companies");
    return divs;
  } catch (err) { console.error("  Error:", err.message); return {}; }
}

async function runFullUpdate() {
  console.log("Starting full update... " + new Date().toISOString());
  var results = await Promise.all([
    fetchStockPrices(), fetchInstitutional(), fetchPERatio(), fetchDividend()
  ]);
  var prices = results[0], inst = results[1], pe = results[2], divs = results[3];
  var allIds = new Set(Object.keys(prices).concat(WATCHLIST.tse).concat(WATCHLIST.otc));
  var stocks = {};
  allIds.forEach(function(id) {
    var p = prices[id] || {}, i = inst[id] || {}, r = pe[id] || {}, d = divs[id] || [];
    stocks[id] = {
      id: id, name: p.name || r.name || i.name || "", market: p.market || "tse",
      price: p.price || 0, open: p.open || 0, high: p.high || 0, low: p.low || 0,
      prev: p.prev || 0, change: p.change || 0, changeP: p.changeP || "0.00",
      volume: p.volume || 0,
      foreign_buy: i.foreign_buy || 0, trust_buy: i.trust_buy || 0,
      dealer_buy: i.dealer_buy || 0,
      pe: r.pe || 0, dividend_yield: r.dividend_yield || 0, pb: r.pb || 0,
      dividends: d, updated: new Date().toISOString(),
    };
  });
  console.log("Merged " + Object.keys(stocks).length + " stocks");
  return { version: "2.0", generated: new Date().toISOString(), date: getDateStr(), stocks: stocks };
}

module.exports = {
  runFullUpdate: runFullUpdate,
  fetchStockPrices: fetchStockPrices,
  fetchInstitutional: fetchInstitutional,
  fetchPERatio: fetchPERatio,
  fetchDividend: fetchDividend,
  WATCHLIST: WATCHLIST,
  DATA_SOURCES: DATA_SOURCES
};
