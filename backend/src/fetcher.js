// ═══════════════════════════════════════════════════════════════════
// 台股 + 美股 日監測 Agent Pro — 後端資料擷取引擎 v4.0
// 新增：技術指標 KD / RSI / MACD + 台股加權指數 + 市場統計
// ═══════════════════════════════════════════════════════════════════

var ipoScraper = require("./ipo-scraper");

const DATA_SOURCES = {
  TWSE_DAILY_ALL: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  TPEX_DAILY: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  TWSE_INSTITUTIONAL: "https://www.twse.com.tw/rwd/zh/fund/T86?response=json",
  TWSE_PE_RATIO: "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
  TWSE_DIVIDEND: "https://openapi.twse.com.tw/v1/opendata/t187ap45_L",
  // 台股歷史日K (個股月報) — 用來算技術指標
  TWSE_STOCK_MONTH: "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json",
  // 台股大盤指數
  TWSE_INDEX: "https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json",
  // 台股當日漲跌家數
  TWSE_MARKET_STATS: "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK",
  // 美股
  YAHOO_QUOTE: "https://query1.finance.yahoo.com/v8/finance/chart/",
  YAHOO_QUOTE2: "https://query2.finance.yahoo.com/v8/finance/chart/",
};

const WATCHLIST = {
  tse: ["2330","2454","2317","2382","2881","2882","2886","2603","2327","2345","2357","3037","3443","3661","3711","4919","6488","6669","6770"],
  otc: ["6547","3293","5765","6781"],
  us: ["NVDA","AAPL","MSFT","GOOGL","AMZN","META","TSM","TSLA","AMD","AVGO","QCOM","MU","ASML","ARM","SMCI","PLTR","NFLX","COST","INTC","MRVL"],
};

var US_STOCK_INFO = {
  NVDA: { name:"輝達", sector:"半導體", tw_related:["2330","2382","6669","3661"] },
  AAPL: { name:"蘋果", sector:"消費電子", tw_related:["2317","3037","2454"] },
  MSFT: { name:"微軟", sector:"軟體/雲端", tw_related:["2382","6669","2345"] },
  GOOGL: { name:"Google", sector:"網路/AI", tw_related:["3661","2382"] },
  AMZN: { name:"亞馬遜", sector:"電商/雲端", tw_related:["2345","3711"] },
  META: { name:"Meta", sector:"社群/VR", tw_related:["3037","2454"] },
  TSM: { name:"台積電ADR", sector:"半導體", tw_related:["2330"] },
  TSLA: { name:"特斯拉", sector:"電動車", tw_related:["2317","3443","6488"] },
  AMD: { name:"超微", sector:"半導體", tw_related:["2330","3037","2454"] },
  AVGO: { name:"博通", sector:"半導體", tw_related:["2330","2454","3711"] },
  QCOM: { name:"高通", sector:"半導體/通訊", tw_related:["2454","3037","6770"] },
  MU: { name:"美光", sector:"記憶體", tw_related:["2330","2327","3037"] },
  ASML: { name:"ASML", sector:"半導體設備", tw_related:["2330","3443"] },
  ARM: { name:"ARM", sector:"半導體IP", tw_related:["2330","2454","6770"] },
  SMCI: { name:"超微電腦", sector:"AI伺服器", tw_related:["2382","6669","3661"] },
  PLTR: { name:"Palantir", sector:"AI軟體", tw_related:["6669","3661"] },
  NFLX: { name:"Netflix", sector:"串流影音", tw_related:[] },
  COST: { name:"好市多", sector:"零售", tw_related:[] },
  INTC: { name:"英特爾", sector:"半導體", tw_related:["2330","3037"] },
  MRVL: { name:"Marvell", sector:"半導體", tw_related:["2330","3711"] },
};

function getDateStr() {
  var d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0");
}

async function safeFetch(url, opts, retries) {
  opts = opts || {};
  retries = retries || 3;
  for (var i = 0; i < retries; i++) {
    try {
      var res = await fetch(url, Object.assign({}, opts, {
        headers: Object.assign({ "User-Agent": "TWStock-Agent/4.0" }, opts.headers || {})
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

// ═══════════════════════════════════════════════════════════════════
// 技術指標計算
// ═══════════════════════════════════════════════════════════════════

function calcRSI(closes, period) {
  period = period || 14;
  if (closes.length < period + 1) return null;
  var gains = 0, losses = 0;
  for (var i = 1; i <= period; i++) {
    var diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  var avgGain = gains / period;
  var avgLoss = losses / period;
  for (var j = period + 1; j < closes.length; j++) {
    var d = closes[j] - closes[j - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  var rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

function calcKD(highs, lows, closes, kPeriod, dPeriod) {
  kPeriod = kPeriod || 9;
  dPeriod = dPeriod || 3;
  if (closes.length < kPeriod) return { k: null, d: null };

  var rsvList = [];
  for (var i = kPeriod - 1; i < closes.length; i++) {
    var highMax = -Infinity, lowMin = Infinity;
    for (var j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > highMax) highMax = highs[j];
      if (lows[j] < lowMin) lowMin = lows[j];
    }
    var rsv = highMax === lowMin ? 50 : ((closes[i] - lowMin) / (highMax - lowMin)) * 100;
    rsvList.push(rsv);
  }

  // 計算 K 值（EMA of RSV）
  var k = 50; // 初始值
  for (var m = 0; m < rsvList.length; m++) {
    k = (2 / 3) * k + (1 / 3) * rsvList[m];
  }

  // 計算 D 值（EMA of K）— 簡化版，用最後幾個 RSV 推算
  var kValues = [];
  var kk = 50;
  for (var n = 0; n < rsvList.length; n++) {
    kk = (2 / 3) * kk + (1 / 3) * rsvList[n];
    kValues.push(kk);
  }
  var d = 50;
  for (var p = 0; p < kValues.length; p++) {
    d = (2 / 3) * d + (1 / 3) * kValues[p];
  }

  return {
    k: Math.round(k * 100) / 100,
    d: Math.round(d * 100) / 100,
  };
}

function calcMACD(closes, fastP, slowP, signalP) {
  fastP = fastP || 12;
  slowP = slowP || 26;
  signalP = signalP || 9;
  if (closes.length < slowP + signalP) return { macd: null, signal: null, histogram: null };

  function ema(data, period) {
    var k = 2 / (period + 1);
    var result = [data[0]];
    for (var i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  var emaFast = ema(closes, fastP);
  var emaSlow = ema(closes, slowP);
  var dif = [];
  for (var i = 0; i < closes.length; i++) {
    dif.push(emaFast[i] - emaSlow[i]);
  }
  var signalLine = ema(dif, signalP);
  var last = closes.length - 1;
  var macdVal = dif[last];
  var sigVal = signalLine[last];

  return {
    macd: Math.round(macdVal * 100) / 100,
    signal: Math.round(sigVal * 100) / 100,
    histogram: Math.round((macdVal - sigVal) * 100) / 100,
  };
}

// ─── 抓台股個股歷史日K（最近 2 個月）───
async function fetchTWStockHistory(stockId) {
  try {
    var now = new Date();
    var yyyymm = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0");
    var url = DATA_SOURCES.TWSE_STOCK_MONTH + "&date=" + yyyymm + "01&stockNo=" + stockId;
    var res = await safeFetch(url, {}, 2);
    var json = await res.json();

    var closes = [], highs = [], lows = [];
    if (json.data) {
      json.data.forEach(function(row) {
        var c = parseFloat((row[6] || "").replace(/,/g, ""));
        var h = parseFloat((row[4] || "").replace(/,/g, ""));
        var l = parseFloat((row[5] || "").replace(/,/g, ""));
        if (!isNaN(c) && c > 0) { closes.push(c); highs.push(h || c); lows.push(l || c); }
      });
    }

    // 也抓上個月
    var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var yyyymm2 = prevMonth.getFullYear() + String(prevMonth.getMonth() + 1).padStart(2, "0");
    var url2 = DATA_SOURCES.TWSE_STOCK_MONTH + "&date=" + yyyymm2 + "01&stockNo=" + stockId;
    await new Promise(function(r) { setTimeout(r, 500); });
    var res2 = await safeFetch(url2, {}, 2);
    var json2 = await res2.json();

    var prevCloses = [], prevHighs = [], prevLows = [];
    if (json2.data) {
      json2.data.forEach(function(row) {
        var c = parseFloat((row[6] || "").replace(/,/g, ""));
        var h = parseFloat((row[4] || "").replace(/,/g, ""));
        var l = parseFloat((row[5] || "").replace(/,/g, ""));
        if (!isNaN(c) && c > 0) { prevCloses.push(c); prevHighs.push(h || c); prevLows.push(l || c); }
      });
    }

    // 合併：上個月 + 本月
    var allCloses = prevCloses.concat(closes);
    var allHighs = prevHighs.concat(highs);
    var allLows = prevLows.concat(lows);

    return { closes: allCloses, highs: allHighs, lows: allLows };
  } catch (err) {
    return { closes: [], highs: [], lows: [] };
  }
}

// ─── 批次計算追蹤清單的技術指標 ───
async function fetchTechnicalIndicators() {
  console.log("[TI] Computing technical indicators for watchlist...");
  var indicators = {};
  var allIds = WATCHLIST.tse.concat(WATCHLIST.otc);

  for (var i = 0; i < allIds.length; i++) {
    var id = allIds[i];
    try {
      var hist = await fetchTWStockHistory(id);
      if (hist.closes.length >= 14) {
        var rsi = calcRSI(hist.closes, 14);
        var kd = calcKD(hist.highs, hist.lows, hist.closes, 9, 3);
        var macd = calcMACD(hist.closes, 12, 26, 9);

        // 判斷訊號
        var signal = "neutral";
        if (rsi !== null) {
          if (rsi > 80 && kd.k > 80) signal = "overbought";
          else if (rsi < 20 && kd.k < 20) signal = "oversold";
          else if (macd.histogram > 0 && kd.k > kd.d) signal = "bullish";
          else if (macd.histogram < 0 && kd.k < kd.d) signal = "bearish";
        }

        indicators[id] = {
          rsi: rsi, k: kd.k, d: kd.d,
          macd: macd.macd, macd_signal: macd.signal, macd_hist: macd.histogram,
          signal: signal,
          data_points: hist.closes.length,
        };
      }
      // 每支間隔 800ms 避免被 TWSE 封鎖
      await new Promise(function(r) { setTimeout(r, 800); });
    } catch (err) {
      console.error("  [TI] " + id + " failed:", err.message);
    }
  }
  console.log("  [TI] " + Object.keys(indicators).length + " stocks computed");
  return indicators;
}

// ═══════════════════════════════════════════════════════════════════
// 台股加權指數
// ═══════════════════════════════════════════════════════════════════
async function fetchTWSEIndex() {
  console.log("[TW] Fetching TWSE index...");
  try {
    var now = new Date();
    var yyyymm = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0");
    var url = DATA_SOURCES.TWSE_INDEX + "&date=" + yyyymm + "01";
    var res = await safeFetch(url);
    var json = await res.json();

    if (!json.data || json.data.length === 0) return null;

    var lastRow = json.data[json.data.length - 1];
    var prevRow = json.data.length > 1 ? json.data[json.data.length - 2] : null;

    var close = parseFloat((lastRow[1] || "").replace(/,/g, "")) || 0;
    var prev = prevRow ? (parseFloat((prevRow[1] || "").replace(/,/g, "")) || 0) : close;
    var change = close - prev;

    return {
      name: "加權指數",
      price: close,
      prev: prev,
      change: Math.round(change * 100) / 100,
      changeP: prev > 0 ? ((change / prev) * 100).toFixed(2) : "0.00",
      date: lastRow[0] || "",
    };
  } catch (err) {
    console.error("  [TW] Index error:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 市場統計（漲跌家數等）
// ═══════════════════════════════════════════════════════════════════
function isRealStock(s) {
  // 過濾權證(6碼7/0開頭)、牛熊證、購售權證
  var id = s.id || "";
  if (id.length > 4 && /^[037]/.test(id)) return false; // 權證
  if (/購|售|牛|熊|展延/.test(s.name || "")) return false;
  if (id.length === 6) return false; // 所有6碼都排除
  return true;
}

function computeMarketStats(twStocks) {
  var up = 0, down = 0, flat = 0, limit_up = 0, limit_down = 0;
  var totalVol = 0;
  var topGainers = [], topLosers = [], topVolume = [];

  var allList = Object.values(twStocks).filter(function(s) { return s.price > 0; });
  var list = allList.filter(isRealStock);

  list.forEach(function(s) {
    var cp = parseFloat(s.changeP) || 0;
    if (cp > 0) up++;
    else if (cp < 0) down++;
    else flat++;
    if (cp >= 9.5) limit_up++;
    if (cp <= -9.5) limit_down++;
    totalVol += s.volume || 0;
  });

  // Top 10 漲幅
  topGainers = list.slice().sort(function(a, b) {
    return parseFloat(b.changeP) - parseFloat(a.changeP);
  }).slice(0, 10).map(function(s) {
    return { id: s.id, name: s.name, price: s.price, changeP: s.changeP, volume: s.volume };
  });

  // Top 10 跌幅
  topLosers = list.slice().sort(function(a, b) {
    return parseFloat(a.changeP) - parseFloat(b.changeP);
  }).slice(0, 10).map(function(s) {
    return { id: s.id, name: s.name, price: s.price, changeP: s.changeP, volume: s.volume };
  });

  // Top 10 成交量
  topVolume = list.slice().sort(function(a, b) {
    return (b.volume || 0) - (a.volume || 0);
  }).slice(0, 10).map(function(s) {
    return { id: s.id, name: s.name, price: s.price, changeP: s.changeP, volume: s.volume };
  });

  return {
    up: up, down: down, flat: flat,
    limit_up: limit_up, limit_down: limit_down,
    total_volume: totalVol,
    top_gainers: topGainers,
    top_losers: topLosers,
    top_volume: topVolume,
  };
}

// ═══════════════════════════════════════════════════════════════════
// AI 策略訊號（基於技術指標 + 法人動向）
// ═══════════════════════════════════════════════════════════════════
function generateAISignals(twStocks, indicators) {
  var signals = [];
  var watchIds = WATCHLIST.tse.concat(WATCHLIST.otc);

  watchIds.forEach(function(id) {
    var stock = twStocks[id];
    var ti = indicators[id];
    if (!stock || !ti || !ti.rsi) return;

    var reasons = [];
    var score = 0; // -100 to +100

    // RSI 訊號
    if (ti.rsi > 80) { reasons.push("RSI " + ti.rsi + " 超買"); score -= 25; }
    else if (ti.rsi < 20) { reasons.push("RSI " + ti.rsi + " 超賣"); score += 25; }
    else if (ti.rsi > 60) { reasons.push("RSI " + ti.rsi + " 偏多"); score += 10; }
    else if (ti.rsi < 40) { reasons.push("RSI " + ti.rsi + " 偏空"); score -= 10; }

    // KD 訊號
    if (ti.k > 80 && ti.d > 80) { reasons.push("KD 高檔鈍化"); score -= 20; }
    else if (ti.k < 20 && ti.d < 20) { reasons.push("KD 低檔鈍化"); score += 20; }
    if (ti.k > ti.d && ti.k < 50) { reasons.push("KD 黃金交叉"); score += 15; }
    if (ti.k < ti.d && ti.k > 50) { reasons.push("KD 死亡交叉"); score -= 15; }

    // MACD 訊號
    if (ti.macd_hist > 0) { reasons.push("MACD 多方"); score += 10; }
    else if (ti.macd_hist < 0) { reasons.push("MACD 空方"); score -= 10; }

    // 法人動向
    var net = (stock.foreign_buy || 0) + (stock.trust_buy || 0) + (stock.dealer_buy || 0);
    if (net > 500) { reasons.push("三大法人買超 " + net + " 張"); score += 15; }
    else if (net < -500) { reasons.push("三大法人賣超 " + Math.abs(net) + " 張"); score -= 15; }

    // 殖利率
    if (stock.dividend_yield > 5) { reasons.push("殖利率 " + stock.dividend_yield + "%"); score += 10; }

    // 決定建議
    var recommendation = "觀望";
    if (score >= 30) recommendation = "偏多操作";
    else if (score >= 15) recommendation = "留意買點";
    else if (score <= -30) recommendation = "偏空避險";
    else if (score <= -15) recommendation = "留意賣點";

    if (reasons.length > 0) {
      signals.push({
        id: id, name: stock.name, price: stock.price,
        changeP: stock.changeP, score: score,
        recommendation: recommendation,
        reasons: reasons,
        ti: { rsi: ti.rsi, k: ti.k, d: ti.d, macd: ti.macd, macd_hist: ti.macd_hist },
      });
    }
  });

  // 按分數絕對值排序（最強烈的訊號優先）
  signals.sort(function(a, b) { return Math.abs(b.score) - Math.abs(a.score); });
  return signals;
}

// ═══════════════════════════════════════════════════════════════════
// 即時快訊（根據當日資料自動產生）
// ═══════════════════════════════════════════════════════════════════
function generateNewsAlerts(twStocks, usStocks, marketStats, indicators, correlation) {
  var alerts = [];
  var now = new Date().toISOString();

  // 1. 漲停 / 跌停個股
  Object.values(twStocks).forEach(function(s) {
    var cp = parseFloat(s.changeP);
    if (cp >= 9.5) {
      alerts.push({ type: "limit_up", priority: "high", emoji: "🔴", title: s.name + "(" + s.id + ") 漲停！", detail: "收盤 " + s.price + " 元，漲幅 " + s.changeP + "%", time: now });
    } else if (cp <= -9.5) {
      alerts.push({ type: "limit_down", priority: "high", emoji: "🟢", title: s.name + "(" + s.id + ") 跌停！", detail: "收盤 " + s.price + " 元，跌幅 " + s.changeP + "%", time: now });
    }
  });

  // 2. 法人大單（追蹤清單中買賣超前 5 大）
  var watchIds = WATCHLIST.tse.concat(WATCHLIST.otc);
  var instList = watchIds.map(function(id) {
    var s = twStocks[id];
    if (!s) return null;
    var net = (s.foreign_buy || 0) + (s.trust_buy || 0) + (s.dealer_buy || 0);
    return { id: id, name: s.name, net: net, price: s.price };
  }).filter(function(x) { return x && Math.abs(x.net) > 200; });
  instList.sort(function(a, b) { return Math.abs(b.net) - Math.abs(a.net); });
  instList.slice(0, 5).forEach(function(item) {
    var dir = item.net > 0 ? "買超" : "賣超";
    alerts.push({ type: "institutional", priority: "medium", emoji: "🏦", title: item.name + " 法人" + dir + " " + Math.abs(item.net) + " 張", detail: "收盤價 " + item.price + " 元", time: now });
  });

  // 3. 技術面訊號
  watchIds.forEach(function(id) {
    var ti = indicators[id], s = twStocks[id];
    if (!ti || !s) return;
    if (ti.signal === "overbought") {
      alerts.push({ type: "technical", priority: "medium", emoji: "⚠️", title: s.name + " KD+RSI 超買警示", detail: "K=" + ti.k + " D=" + ti.d + " RSI=" + ti.rsi, time: now });
    } else if (ti.signal === "oversold") {
      alerts.push({ type: "technical", priority: "medium", emoji: "💡", title: s.name + " KD+RSI 超賣訊號", detail: "K=" + ti.k + " D=" + ti.d + " RSI=" + ti.rsi, time: now });
    }
  });

  // 4. 台美連動
  correlation.forEach(function(c) {
    alerts.push({ type: "correlation", priority: "high", emoji: "🔗", title: c.message, detail: "", time: now });
  });

  // 5. 市場概況
  if (marketStats.limit_up > 5) {
    alerts.push({ type: "market", priority: "medium", emoji: "🎯", title: "今日 " + marketStats.limit_up + " 檔漲停", detail: "市場氣氛偏多", time: now });
  }
  if (marketStats.limit_down > 5) {
    alerts.push({ type: "market", priority: "medium", emoji: "💨", title: "今日 " + marketStats.limit_down + " 檔跌停", detail: "市場氣氛偏空", time: now });
  }

  // 按優先度排序
  var priorityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort(function(a, b) { return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2); });

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════
// 台股收盤
// ═══════════════════════════════════════════════════════════════════
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

// ─── 三大法人 ───
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

// ─── 本益比 / 殖利率 ───
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

// ─── 股利 ───
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
// 美股 Yahoo Finance
// ═══════════════════════════════════════════════════════════════════
async function fetchUSStockPrices() {
  console.log("[US] Fetching US stock prices...");
  var usStocks = {};

  for (var i = 0; i < WATCHLIST.us.length; i++) {
    var symbol = WATCHLIST.us[i];
    try {
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
        id: symbol, name: info.name, name_en: meta.shortName || symbol,
        sector: info.sector, market: "us", currency: meta.currency || "USD",
        price: Math.round(price * 100) / 100,
        open: Math.round((opens[lastIdx] || 0) * 100) / 100,
        high: Math.round((highs[lastIdx] || 0) * 100) / 100,
        low: Math.round((lows[lastIdx] || 0) * 100) / 100,
        prev: Math.round(prev * 100) / 100,
        change: Math.round(change * 100) / 100,
        changeP: prev > 0 ? ((change / prev) * 100).toFixed(2) : "0.00",
        volume: volumes[lastIdx] || 0,
        marketCap: meta.marketCap || 0,
        tw_related: info.tw_related,
        history: closes.filter(function(v) { return v !== null; }),
        updated: new Date().toISOString(),
      };
      await new Promise(function(r) { setTimeout(r, 500); });
    } catch (err) {
      console.error("  [US] " + symbol + " failed:", err.message);
    }
  }
  console.log("  [US] " + Object.keys(usStocks).length + " stocks");
  return usStocks;
}

// ─── 美股主要指數 ───
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
        id: sym.id, name: sym.name,
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

// ─── 台美連動分析 ───
function buildCorrelationMap(usStocks, twStocks) {
  var alerts = [];
  Object.keys(usStocks).forEach(function(symbol) {
    var us = usStocks[symbol];
    var changeP = parseFloat(us.changeP);
    if (Math.abs(changeP) < 2) return;
    var info = US_STOCK_INFO[symbol] || { tw_related: [] };
    if (!info.tw_related || info.tw_related.length === 0) return;
    var direction = changeP > 0 ? "positive" : "negative";
    var relatedNames = info.tw_related.map(function(twId) {
      var tw = twStocks[twId];
      return tw ? tw.name + "(" + twId + ")" : twId;
    }).join("、");
    alerts.push({
      us_symbol: symbol, us_name: us.name, us_changeP: us.changeP,
      direction: direction, tw_related: info.tw_related, tw_related_names: relatedNames,
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
  console.log("  台美股日監測 Agent Pro v4.0");
  console.log("  " + new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }));
  console.log("══════════════════════════════════════");

  // Phase 1: 基本資料
  var twResults = await Promise.all([
    fetchTWStockPrices(),
    fetchInstitutional(),
    fetchPERatio(),
    fetchDividend(),
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

  // Phase 2: 美股 + 指數
  var usStocks = await fetchUSStockPrices();
  var usIndices = await fetchUSIndices();
  var twseIndex = await fetchTWSEIndex();

  // Phase 3: IPO
  var ipoData = await ipoScraper.fetchIPO();

  // Phase 4: 技術指標（追蹤清單）
  var indicators = await fetchTechnicalIndicators();

  // 把技術指標塞回個股資料
  Object.keys(indicators).forEach(function(id) {
    if (twStocks[id]) {
      twStocks[id].ti = indicators[id];
    }
  });

  // Phase 5: 台美連動
  var correlation = buildCorrelationMap(usStocks, twStocks);

  // Phase 6: 市場統計
  var marketStats = computeMarketStats(twStocks);

  // Phase 7: AI 策略訊號
  var aiSignals = generateAISignals(twStocks, indicators);

  // Phase 8: 即時快訊
  var newsAlerts = generateNewsAlerts(twStocks, usStocks, marketStats, indicators, correlation);

  console.log("══════════════════════════════════════");
  console.log("  TW: " + Object.keys(twStocks).length + " stocks");
  console.log("  US: " + Object.keys(usStocks).length + " stocks");
  console.log("  IPO: " + ipoData.length + " records");
  console.log("  TI: " + Object.keys(indicators).length + " indicators");
  console.log("  AI Signals: " + aiSignals.length);
  console.log("  News: " + newsAlerts.length);
  console.log("  Alerts: " + correlation.length);
  console.log("══════════════════════════════════════");

  return {
    version: "4.0",
    generated: new Date().toISOString(),
    date: getDateStr(),
    tw_index: twseIndex,
    tw_stocks: twStocks,
    us_stocks: usStocks,
    us_indices: usIndices,
    ipo: ipoData,
    market_stats: marketStats,
    ai_signals: aiSignals,
    news_alerts: newsAlerts,
    correlation_alerts: correlation,
  };
}

module.exports = {
  runFullUpdate: runFullUpdate,
  WATCHLIST: WATCHLIST,
  US_STOCK_INFO: US_STOCK_INFO,
};
