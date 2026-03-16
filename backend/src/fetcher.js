// ═══════════════════════════════════════════════════════════════════
// 台股 + 美股 日監測 Agent Pro — 後端資料擷取引擎 v3.0
// ═══════════════════════════════════════════════════════════════════

const DATA_SOURCES = {
  // 台股
  TWSE_DAILY_ALL: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TPEX_DAILY: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  TWSE_INSTITUTIONAL: "https://www.twse.com.tw/rwd/zh/fund/T86?response=json",
  TWSE_PE_RATIO: "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
  TWSE_DIVIDEND: "https://openapi.twse.com.tw/v1/opendata/t187ap45_L",
  // 美股 (Yahoo Finance)
  YAHOO_QUOTE: "https://query1.finance.yahoo.com/v8/finance/chart/",
  YAHOO_QUOTE2: "https://query2.finance.yahoo.com/v8/finance/chart/",
};

const WATCHLIST = {
  tse: ["2330","2454","2317","2382","2881","2882","2886","2603","2327","2345","2357","3037","3443","3661","3711","4919","6488","6669","6770"],
  otc: ["6547","3293","5765","6781"],
  us: ["NVDA","AAPL","MSFT","GOOGL","AMZN","META","TSM","TSLA","AMD","AVGO","QCOM","MU","ASML","ARM","SMCI","PLTR","NFLX","COST","INTC","MRVL"],
};

// 美股追蹤清單的中文名與產業
var US_STOCK_INFO = {
  NVDA: { name:"輝達", sector:"半導體", tw_related:["2330","2382","6669","3661"] },
  AAPL: { name:"蘋果", sector:"消費電子", tw_related:["2317","3037","2454"] },
  MSFT: { name:"微軟", sector:"軟體/雲端", tw_related:["2382","6669","2345"] },
  GOOGL: { name:"Google", sector:"網路/AI", tw_related:["3661","2382"] },
  AMZN: { name:"亞馬遜", sector:"電商/雲端", tw_related:["3661","2382"] },
  META: { name:"Meta", sector:"社群/AI", tw_related:["6669","2382"] },
  TSM: { name:"台積電ADR", sector:"半導體", tw_related:["2330"] },
  TSLA: { name:"特斯拉", sector:"電動車", tw_related:["2317","3037"] },
  AMD: { name:"超微", sector:"半導體", tw_related:["2330","3037","3711"] },
  AVGO: { name:"博通", sector:"半導體", tw_related:["2330","3037"] },
  QCOM: { name:"高通", sector:"半導體", tw_related:["2454"] },
  MU: { name:"美光", sector:"記憶體", tw_related:["6770"] },
  ASML: { name:"艾司摩爾", sector:"半導體設備", tw_related:["2330"] },
  ARM: { name:"安謀", sector:"半導體IP", tw_related:["2454","3443"] },
  SMCI: { name:"超微電腦", sector:"AI伺服器", tw_related:["2382","6669"] },
  PLTR: { name:"Palantir", sector:"AI/大數據", tw_related:[] },
  NFLX: { name:"Netflix", sector:"串流", tw_related:[] },
  COST: { name:"好市多", sector:"零售", tw_related:[] },
  INTC: { name:"英特爾", sector:"半導體", tw_related:["2330","3711"] },
  MRVL: { name:"Marvell", sector:"半導體", tw_related:["2330","3037"] },
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
      var res = await fetch(url, Object.assign({}, opts, {
        headers: Object.assign({ "User-Agent": "TWStock-Agent/3.0" }, opts.headers || {})
      }));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res;
    } catch (err) {
      console.error("  Retry " + (i+1) + "/" + retries + ": " + err.message);
      if (i === retries - 1) throw err;
      await new Promise(function(r) { setTimeout(r, 2000 * (i+1)); });
    }
  }
}

// ─── 台股：收盤股價 ───
async function fetchTWStockPrices() {
  console.log("[TW] Fetching stock prices...");
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
    } catch(e) { console.error("  TPEx:", e.message); }
    console.log("  [TW] " + Object.keys(prices).length + " stocks");
    return prices;
  } catch (err) { console.error("  [TW] Error:", err.message); return {}; }
}

// ─── 台股：三大法人 ───
async function fetchInstitutional() {
  console.log("[TW] Fetching institutional...");
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
    console.log("  [TW] " + Object.keys(inst).length + " records");
    return inst;
  } catch (err) { console.error("  [TW] Error:", err.message); return {}; }
}

// ─── 台股：本益比 / 殖利率 ───
async function fetchPERatio() {
  console.log("[TW] Fetching PE ratios...");
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
    console.log("  [TW] " + Object.keys(ratios).length + " records");
    return ratios;
  } catch (err) { console.error("  [TW] Error:", err.message); return {}; }
}

// ─── 台股：股利 ───
async function fetchDividend() {
  console.log("[TW] Fetching dividends...");
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
    console.log("  [TW] " + Object.keys(divs).length + " companies");
    return divs;
  } catch (err) { console.error("  [TW] Error:", err.message); return {}; }
}

// ═══════════════════════════════════════════════════════════════════
// 美股：Yahoo Finance API
// ═══════════════════════════════════════════════════════════════════
async function fetchUSStockPrices() {
  console.log("[US] Fetching US stock prices...");
  var usStocks = {};

  for (var i = 0; i < WATCHLIST.us.length; i++) {
    var symbol = WATCHLIST.us[i];
    try {
      // Yahoo Finance chart API (免費, 無需 API key)
      var url = DATA_SOURCES.YAHOO_QUOTE + symbol + "?interval=1d&range=5d";
      var res = await safeFetch(url);
      var data = await res.json();

      var result = data.chart && data.chart.result && data.chart.result[0];
      if (!result) continue;

      var meta = result.meta || {};
      var quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
      if (!quote) continue;

      var closes = quote.close || [];
      var opens = quote.open || [];
      var highs = quote.high || [];
      var lows = quote.low || [];
      var volumes = quote.volume || [];

      // 取最後一個交易日
      var lastIdx = closes.length - 1;
      while (lastIdx >= 0 && closes[lastIdx] === null) lastIdx--;
      if (lastIdx < 0) continue;

      var prevIdx = lastIdx - 1;
      while (prevIdx >= 0 && closes[prevIdx] === null) prevIdx--;

      var price = closes[lastIdx];
      var prev = prevIdx >= 0 ? closes[prevIdx] : meta.chartPreviousClose || price;
      var change = price - prev;
      var info = US_STOCK_INFO[symbol] || { name: symbol, sector: "", tw_related: [] };

      usStocks[symbol] = {
        id: symbol,
        name: info.name,
        name_en: meta.shortName || symbol,
        sector: info.sector,
        market: "us",
        currency: meta.currency || "USD",
        price: Math.round(price * 100) / 100,
        open: Math.round((opens[lastIdx] || 0) * 100) / 100,
        high: Math.round((highs[lastIdx] || 0) * 100) / 100,
        low: Math.round((lows[lastIdx] || 0) * 100) / 100,
        prev: Math.round(prev * 100) / 100,
        change: Math.round(change * 100) / 100,
        changeP: prev > 0 ? ((change / prev) * 100).toFixed(2) : "0.00",
        volume: volumes[lastIdx] || 0,
        marketCap: meta.marketCap || 0,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || 0,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow || 0,
        tw_related: info.tw_related,
        // 5日收盤價（做迷你走勢圖用）
        history: closes.filter(function(v) { return v !== null; }),
        updated: new Date().toISOString(),
      };

      // 每次請求間隔避免被封
      await new Promise(function(r) { setTimeout(r, 500); });

    } catch (err) {
      console.error("  [US] " + symbol + " failed:", err.message);
    }
  }

  console.log("  [US] " + Object.keys(usStocks).length + " stocks");
  return usStocks;
}

// ═══════════════════════════════════════════════════════════════════
// 美股主要指數
// ═══════════════════════════════════════════════════════════════════
async function fetchUSIndices() {
  console.log("[US] Fetching indices...");
  var indices = {};
  var symbols = [
    { id: "^GSPC", name: "S&P 500" },
    { id: "^IXIC", name: "NASDAQ" },
    { id: "^SOX", name: "費城半導體" },
    { id: "^DJI", name: "道瓊工業" },
    { id: "^VIX", name: "VIX 恐慌指數" },
  ];

  for (var i = 0; i < symbols.length; i++) {
    var sym = symbols[i];
    try {
      var url = DATA_SOURCES.YAHOO_QUOTE + encodeURIComponent(sym.id) + "?interval=1d&range=5d";
      var res = await safeFetch(url);
      var data = await res.json();
      var result = data.chart && data.chart.result && data.chart.result[0];
      if (!result) continue;

      var meta = result.meta || {};
      var quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
      var closes = quote ? quote.close || [] : [];

      var lastIdx = closes.length - 1;
      while (lastIdx >= 0 && closes[lastIdx] === null) lastIdx--;
      if (lastIdx < 0) continue;

      var prevIdx = lastIdx - 1;
      while (prevIdx >= 0 && closes[prevIdx] === null) prevIdx--;

      var price = closes[lastIdx];
      var prev = prevIdx >= 0 ? closes[prevIdx] : meta.chartPreviousClose || price;

      indices[sym.id] = {
        id: sym.id,
        name: sym.name,
        price: Math.round(price * 100) / 100,
        prev: Math.round(prev * 100) / 100,
        change: Math.round((price - prev) * 100) / 100,
        changeP: prev > 0 ? (((price - prev) / prev) * 100).toFixed(2) : "0.00",
      };

      await new Promise(function(r) { setTimeout(r, 500); });
    } catch (err) {
      console.error("  [US] " + sym.id + " failed:", err.message);
    }
  }

  console.log("  [US] " + Object.keys(indices).length + " indices");
  return indices;
}

// ═══════════════════════════════════════════════════════════════════
// 台美連動分析
// ═══════════════════════════════════════════════════════════════════
function buildCorrelationMap(usStocks, twStocks) {
  var alerts = [];

  Object.keys(usStocks).forEach(function(symbol) {
    var us = usStocks[symbol];
    var changeP = parseFloat(us.changeP);
    if (Math.abs(changeP) < 2) return; // 只抓波動大於 2% 的

    var info = US_STOCK_INFO[symbol] || { tw_related: [] };
    if (!info.tw_related || info.tw_related.length === 0) return;

    var direction = changeP > 0 ? "positive" : "negative";
    var relatedNames = info.tw_related.map(function(twId) {
      var tw = twStocks[twId];
      return tw ? tw.name + "(" + twId + ")" : twId;
    }).join("、");

    alerts.push({
      us_symbol: symbol,
      us_name: us.name,
      us_changeP: us.changeP,
      direction: direction,
      tw_related: info.tw_related,
      tw_related_names: relatedNames,
      message: us.name + (changeP > 0 ? "大漲" : "大跌") + Math.abs(changeP).toFixed(1) + "%，台股供應鏈留意：" + relatedNames,
    });
  });

  return alerts.sort(function(a, b) {
    return Math.abs(parseFloat(b.us_changeP)) - Math.abs(parseFloat(a.us_changeP));
  });
}

// ═══════════════════════════════════════════════════════════════════
// 主要整合流程
// ═══════════════════════════════════════════════════════════════════
async function runFullUpdate() {
  console.log("══════════════════════════════════════");
  console.log("  Stock Agent v3.0 — TW + US Update");
  console.log("  " + new Date().toISOString());
  console.log("══════════════════════════════════════");

  // 台股資料（並行抓取）
  var twResults = await Promise.all([
    fetchTWStockPrices(), fetchInstitutional(), fetchPERatio(), fetchDividend()
  ]);
  var twPrices = twResults[0], inst = twResults[1], pe = twResults[2], divs = twResults[3];

  // 整合台股
  var twAllIds = new Set(Object.keys(twPrices).concat(WATCHLIST.tse).concat(WATCHLIST.otc));
  var twStocks = {};
  twAllIds.forEach(function(id) {
    var p = twPrices[id] || {}, i = inst[id] || {}, r = pe[id] || {}, d = divs[id] || [];
    twStocks[id] = {
      id: id, name: p.name || r.name || i.name || "", market: p.market || "tse",
      price: p.price || 0, open: p.open || 0, high: p.high || 0, low: p.low || 0,
      prev: p.prev || 0, change: p.change || 0, changeP: p.changeP || "0.00",
      volume: p.volume || 0,
      foreign_buy: i.foreign_buy || 0, trust_buy: i.trust_buy || 0, dealer_buy: i.dealer_buy || 0,
      pe: r.pe || 0, dividend_yield: r.dividend_yield || 0, pb: r.pb || 0,
      dividends: d, updated: new Date().toISOString(),
    };
  });

  // 美股資料
  var usStocks = await fetchUSStockPrices();
  var usIndices = await fetchUSIndices();

  // 台美連動分析
  var correlation = buildCorrelationMap(usStocks, twStocks);

  console.log("══════════════════════════════════════");
  console.log("  TW: " + Object.keys(twStocks).length + " stocks");
  console.log("  US: " + Object.keys(usStocks).length + " stocks");
  console.log("  Alerts: " + correlation.length);
  console.log("══════════════════════════════════════");

  return {
    version: "3.0",
    generated: new Date().toISOString(),
    date: getDateStr(),
    tw_stocks: twStocks,
    us_stocks: usStocks,
    us_indices: usIndices,
    correlation_alerts: correlation,
  };
}

module.exports = {
  runFullUpdate: runFullUpdate,
  fetchTWStockPrices: fetchTWStockPrices,
  fetchUSStockPrices: fetchUSStockPrices,
  fetchUSIndices: fetchUSIndices,
  fetchInstitutional: fetchInstitutional,
  fetchPERatio: fetchPERatio,
  fetchDividend: fetchDividend,
  buildCorrelationMap: buildCorrelationMap,
  WATCHLIST: WATCHLIST,
  US_STOCK_INFO: US_STOCK_INFO,
  DATA_SOURCES: DATA_SOURCES,
};
