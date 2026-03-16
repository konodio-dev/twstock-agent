// ═══════════════════════════════════════════════════════════════════
// 台股 IPO 公開申購爬蟲 — 從撿股讚 (wespai.com) 抓取真實資料
// ═══════════════════════════════════════════════════════════════════

var cheerio = require("cheerio");

var IPO_URL = "https://stock.wespai.com/draw";

async function fetchIPO() {
  console.log("[IPO] Fetching from wespai.com...");

  try {
    var res = await fetch(IPO_URL, {
      headers: { "User-Agent": "TWStock-Agent/3.0" }
    });
    var html = await res.text();
    var $ = cheerio.load(html);

    var ipos = [];
    // 表格結構：抽籤日期, 代號, 公司, 發行市場, 申購起日, 申購迄日, 撥券日期,
    //           承銷張數, 承銷價, 收盤價, 報酬率(%), 賺賠, 申購張數,
    //           需有多少錢才能抽, 總合格件, 中籤率(%)
    $("table tbody tr").each(function () {
      var tds = $(this).find("td");
      if (tds.length < 15) return;

      var vals = [];
      tds.each(function () { vals.push($(this).text().trim()); });

      var drawDate = vals[0] || "";
      var stockId = vals[1] || "";
      var companyName = vals[2] || "";
      var marketType = vals[3] || "";
      var applyStart = vals[4] || "";
      var applyEnd = vals[5] || "";
      var settleDate = vals[6] || "";
      var shares = parseInt(vals[7]) || 0;
      var offerPrice = parseFloat(vals[8]) || 0;
      var closePrice = parseFloat(vals[9]) || 0;
      var returnRate = parseFloat(vals[10]) || 0;
      var profitLoss = parseInt(String(vals[11]).replace(/,/g, "")) || 0;
      var applyShares = parseInt(vals[12]) || 0;
      var needMoney = parseInt(String(vals[13]).replace(/,/g, "")) || 0;
      var totalApply = parseInt(String(vals[14]).replace(/,/g, "")) || 0;
      var winRate = parseFloat(vals[15]) || 0;

      if (!stockId || !companyName) return;

      // 判斷狀態
      var today = new Date();
      var todayStr = today.getFullYear() + "/" +
        String(today.getMonth() + 1).padStart(2, "0") + "/" +
        String(today.getDate()).padStart(2, "0");

      var year = today.getFullYear();
      var fullApplyStart = applyStart ? year + "/" + applyStart : "";
      var fullApplyEnd = applyEnd ? year + "/" + applyEnd : "";

      var status = "已結束";
      if (totalApply === 0 && profitLoss === 0) {
        // 尚未開始或進行中
        if (fullApplyEnd >= todayStr) {
          if (fullApplyStart <= todayStr) {
            status = "申購中";
          } else {
            status = "即將申購";
          }
        } else if (drawDate >= todayStr) {
          status = "等待抽籤";
        } else {
          status = "即將申購";
        }
      } else if (totalApply > 0) {
        status = "已開獎";
      }

      // AI 評分
      var score = 50;
      if (returnRate > 50) score += 25;
      else if (returnRate > 30) score += 18;
      else if (returnRate > 15) score += 10;
      else if (returnRate > 5) score += 5;
      else if (returnRate < 0) score -= 15;

      if (marketType.indexOf("初上市") >= 0 || marketType.indexOf("初上櫃") >= 0) score += 10;
      if (profitLoss > 50000) score += 8;
      else if (profitLoss > 10000) score += 5;
      if (winRate > 0 && winRate < 2) score += 5;
      score = Math.max(0, Math.min(100, score));

      ipos.push({
        draw_date: drawDate,
        id: stockId,
        name: companyName,
        market_type: marketType,
        apply_start: fullApplyStart,
        apply_end: fullApplyEnd,
        settle_date: settleDate,
        shares: shares,
        offer_price: offerPrice,
        close_price: closePrice,
        return_rate: returnRate,
        profit_loss: profitLoss,
        apply_shares: applyShares,
        need_money: needMoney,
        total_apply: totalApply,
        win_rate: winRate,
        status: status,
        score: score,
      });
    });

    console.log("  [IPO] Got " + ipos.length + " records");
    return ipos;

  } catch (err) {
    console.error("  [IPO] Error:", err.message);
    return [];
  }
}

module.exports = { fetchIPO: fetchIPO };
