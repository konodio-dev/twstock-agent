#!/usr/bin/env python3
"""
Standalone stock analyzer for Taiwan stocks.
Fetches price/institutional/revenue/dividend data, runs multi-factor analysis,
writes frontend/data/enhanced.json and exits.

Requirements: pip install yfinance pandas numpy requests
Env: FINMIND_API_TOKEN (optional, for institutional/revenue/dividend data)
"""

import json
import math
import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests
import yfinance as yf

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WATCHLIST = [
    "2330", "2317", "2454", "2382", "2308", "3711", "2881", "2882", "2891", "2886",
    "2303", "3008", "2412", "1216", "2002", "2603", "3037", "6669", "2345", "1590",
]

STOCK_PROFILES = {
    "2330": {"name": "台積電", "industry": "半導體-晶圓代工"},
    "2317": {"name": "鴻海", "industry": "電子代工-EMS"},
    "2454": {"name": "聯發科", "industry": "半導體-IC設計"},
    "2382": {"name": "廣達", "industry": "電子代工-伺服器"},
    "2308": {"name": "台達電", "industry": "電源管理-散熱"},
    "3711": {"name": "日月光投控", "industry": "半導體-封測"},
    "2881": {"name": "富邦金", "industry": "金融-金控"},
    "2882": {"name": "國泰金", "industry": "金融-金控"},
    "2891": {"name": "中信金", "industry": "金融-金控"},
    "2886": {"name": "兆豐金", "industry": "金融-官股金控"},
    "2303": {"name": "聯電", "industry": "半導體-晶圓代工"},
    "3008": {"name": "大立光", "industry": "光學鏡頭"},
    "2412": {"name": "中華電", "industry": "電信"},
    "1216": {"name": "統一", "industry": "食品-通路"},
    "2002": {"name": "中鋼", "industry": "鋼鐵"},
    "2603": {"name": "長榮", "industry": "航運-貨櫃"},
    "3037": {"name": "欣興", "industry": "PCB-載板"},
    "6669": {"name": "緯穎", "industry": "伺服器-ODM"},
    "2345": {"name": "智邦", "industry": "網通設備"},
    "1590": {"name": "亞德客-KY", "industry": "氣動元件-自動化"},
}

SCORE_WEIGHTS = {"fundamental": 0.40, "chip": 0.30, "technical": 0.20, "industry": 0.10}

HOT_INDUSTRIES = [
    "半導體", "AI", "伺服器", "PCB-載板", "網通", "電源管理",
    "晶圓代工", "IC設計", "封測", "先進封裝",
]

FINMIND_TOKEN = os.environ.get("FINMIND_API_TOKEN", "")
FINMIND_BASE = "https://api.finmindtrade.com/api/v4"

BULLISH_KW = [
    "上調", "調升", "看好", "利多", "突破", "創新高", "營收成長", "大漲",
    "買超", "加碼", "強勢", "回溫", "復甦", "擴產", "產能滿載",
]
BEARISH_KW = [
    "下調", "調降", "看壞", "利空", "跌破", "創新低", "營收衰退", "大跌",
    "賣超", "減碼", "弱勢", "疲軟", "衰退", "砍單", "庫存",
]

# ---------------------------------------------------------------------------
# Utility — sanitize values for JSON
# ---------------------------------------------------------------------------

def _safe(v):
    """Convert numpy/pandas types to native Python types, handle NaN/Inf."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        v = float(v)
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, dict):
        return {k: _safe(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [_safe(i) for i in v]
    return v


# ---------------------------------------------------------------------------
# Data Fetching
# ---------------------------------------------------------------------------

def fetch_yfinance(stock_id: str) -> pd.DataFrame | None:
    """Fetch ~3 months of daily OHLCV from Yahoo Finance."""
    ticker = f"{stock_id}.TW"
    try:
        data = yf.download(ticker, period="3mo", progress=False, auto_adjust=True)
        if data is None or data.empty:
            print(f"  [yfinance] No data for {ticker}")
            return None
        # Flatten multi-level columns if present
        if isinstance(data.columns, pd.MultiIndex):
            data.columns = data.columns.get_level_values(0)
        data = data.rename(columns=str.lower)
        return data
    except Exception as e:
        print(f"  [yfinance] Error fetching {ticker}: {e}")
        return None


def _finmind_get(dataset: str, stock_id: str, start: str, end: str | None = None) -> list:
    """Generic FinMind API getter."""
    if not FINMIND_TOKEN:
        return []
    params = {
        "dataset": dataset,
        "data_id": stock_id,
        "start_date": start,
        "token": FINMIND_TOKEN,
    }
    if end:
        params["end_date"] = end
    try:
        resp = requests.get(f"{FINMIND_BASE}/data", params=params, timeout=15)
        resp.raise_for_status()
        body = resp.json()
        if body.get("status") != 200:
            print(f"  [FinMind] {dataset} status {body.get('status')}: {body.get('msg', '')}")
            return []
        return body.get("data", [])
    except Exception as e:
        print(f"  [FinMind] Error fetching {dataset}/{stock_id}: {e}")
        return []


def fetch_finmind_revenue(stock_id: str) -> list:
    """Monthly revenue — last 24 months."""
    start = (datetime.now() - timedelta(days=730)).strftime("%Y-%m-%d")
    return _finmind_get("TaiwanStockMonthRevenue", stock_id, start)


def fetch_finmind_institutional(stock_id: str) -> list:
    """Institutional buy/sell — last 60 trading days."""
    start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    return _finmind_get("TaiwanStockInstitutionalInvestorsBuySell", stock_id, start)


def fetch_finmind_dividend(stock_id: str) -> list:
    """Dividend history — last 5 years."""
    start = (datetime.now() - timedelta(days=1825)).strftime("%Y-%m-%d")
    return _finmind_get("TaiwanStockDividend", stock_id, start)


# ---------------------------------------------------------------------------
# Technical Analysis
# ---------------------------------------------------------------------------

def compute_rsi(df: pd.DataFrame, period: int = 14) -> float | None:
    """Wilder's RSI with division-by-zero protection."""
    close = df["close"]
    if len(close) < period + 1:
        return None
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    last_gain = avg_gain.iloc[-1]
    last_loss = avg_loss.iloc[-1]
    if last_loss == 0:
        return 100.0 if last_gain > 0 else 50.0
    rs = last_gain / (last_loss + 1e-10)
    return float(100.0 - 100.0 / (1.0 + rs))


def compute_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> dict | None:
    """MACD line, signal line, histogram."""
    close = df["close"]
    if len(close) < slow + signal:
        return None
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return {
        "macd": float(macd_line.iloc[-1]),
        "signal": float(signal_line.iloc[-1]),
        "histogram": float(histogram.iloc[-1]),
        "cross_up": bool(histogram.iloc[-1] > 0 and histogram.iloc[-2] <= 0) if len(histogram) >= 2 else False,
        "cross_down": bool(histogram.iloc[-1] < 0 and histogram.iloc[-2] >= 0) if len(histogram) >= 2 else False,
    }


def compute_bollinger(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> dict | None:
    """Bollinger Bands: middle, upper, lower, %B, bandwidth."""
    close = df["close"]
    if len(close) < period:
        return None
    sma = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = sma + std_dev * std
    lower = sma - std_dev * std
    last_close = float(close.iloc[-1])
    last_upper = float(upper.iloc[-1])
    last_lower = float(lower.iloc[-1])
    last_mid = float(sma.iloc[-1])
    band_width = last_upper - last_lower
    pct_b = (last_close - last_lower) / (band_width + 1e-10)
    return {
        "upper": last_upper,
        "middle": last_mid,
        "lower": last_lower,
        "pct_b": pct_b,
        "bandwidth": band_width / (last_mid + 1e-10),
    }


def compute_ma_crossover(df: pd.DataFrame, short: int = 5, long: int = 20) -> dict | None:
    """Moving average crossover signal."""
    close = df["close"]
    if len(close) < long:
        return None
    ma_short = close.rolling(short).mean()
    ma_long = close.rolling(long).mean()
    diff_now = ma_short.iloc[-1] - ma_long.iloc[-1]
    diff_prev = ma_short.iloc[-2] - ma_long.iloc[-2] if len(ma_short) >= 2 else diff_now
    return {
        "ma_short": float(ma_short.iloc[-1]),
        "ma_long": float(ma_long.iloc[-1]),
        "golden_cross": bool(diff_now > 0 and diff_prev <= 0),
        "death_cross": bool(diff_now < 0 and diff_prev >= 0),
        "bullish": bool(diff_now > 0),
    }


def compute_kdj(df: pd.DataFrame, n: int = 9, m1: int = 3, m2: int = 3) -> dict | None:
    """KDJ oscillator."""
    if len(df) < n:
        return None
    low_min = df["low"].rolling(n).min()
    high_max = df["high"].rolling(n).max()
    rsv = (df["close"] - low_min) / (high_max - low_min + 1e-10) * 100

    k_vals = [50.0]
    d_vals = [50.0]
    rsv_list = rsv.dropna().tolist()
    for r in rsv_list:
        k = k_vals[-1] * (m1 - 1) / m1 + r / m1
        d = d_vals[-1] * (m2 - 1) / m2 + k / m2
        k_vals.append(k)
        d_vals.append(d)

    k = k_vals[-1]
    d = d_vals[-1]
    j = 3 * k - 2 * d
    return {"k": float(k), "d": float(d), "j": float(j)}


def compute_volume_analysis(df: pd.DataFrame) -> dict | None:
    """Volume ratio vs 20-day average."""
    if len(df) < 20:
        return None
    vol = df["volume"]
    avg_20 = vol.rolling(20).mean().iloc[-1]
    if avg_20 == 0:
        return {"ratio": 0, "avg_20": 0, "latest": 0}
    latest = float(vol.iloc[-1])
    return {
        "ratio": float(latest / avg_20),
        "avg_20": float(avg_20),
        "latest": latest,
    }


def compute_atr(df: pd.DataFrame, period: int = 14) -> float | None:
    """Average True Range — Wilder's EMA."""
    if len(df) < period + 1:
        return None
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    return float(atr.iloc[-1])


def full_technical_analysis(stock_id: str, df: pd.DataFrame) -> dict:
    """Combine all technical indicators into a single dict."""
    close = df["close"]
    price = float(close.iloc[-1])

    rsi = compute_rsi(df)
    macd = compute_macd(df)
    bb = compute_bollinger(df)
    ma_cross = compute_ma_crossover(df)
    kdj = compute_kdj(df)
    vol = compute_volume_analysis(df)
    atr = compute_atr(df)
    atr_pct = (atr / price * 100) if atr and price else None

    # MA60
    ma60 = float(close.rolling(60).mean().iloc[-1]) if len(close) >= 60 else None

    # Support / Resistance — pivot + ATR
    if len(df) >= 2:
        h = float(df["high"].iloc[-1])
        l = float(df["low"].iloc[-1])
        c = price
        pivot = (h + l + c) / 3.0
        atr_val = atr if atr else (h - l)
        support = round(pivot - atr_val, 2)
        resistance = round(pivot + atr_val, 2)
    else:
        support = resistance = price

    # --- Technical score (0-100) ---
    score = 50  # neutral baseline

    # RSI contribution (-15 to +15)
    if rsi is not None:
        if rsi < 30:
            score += 15  # oversold = bullish
        elif rsi < 40:
            score += 8
        elif rsi > 70:
            score -= 15  # overbought = bearish
        elif rsi > 60:
            score -= 5

    # MACD contribution (-10 to +10)
    if macd:
        if macd["histogram"] > 0:
            score += 5
        else:
            score -= 5
        if macd.get("cross_up"):
            score += 5
        elif macd.get("cross_down"):
            score -= 5

    # Bollinger %B contribution (-10 to +10)
    if bb:
        pct_b = bb["pct_b"]
        if pct_b < 0.2:
            score += 10  # near lower band = bullish
        elif pct_b > 0.8:
            score -= 10

    # MA crossover contribution (-5 to +5)
    if ma_cross:
        if ma_cross["bullish"]:
            score += 5
        else:
            score -= 5

    # KDJ contribution (-5 to +5)
    if kdj:
        if kdj["k"] < 20 and kdj["j"] < 0:
            score += 5  # oversold
        elif kdj["k"] > 80 and kdj["j"] > 100:
            score -= 5  # overbought

    # Volume contribution (-5 to +5)
    if vol and ma_cross:
        if vol["ratio"] > 1.5 and ma_cross["bullish"]:
            score += 5  # volume confirms uptrend
        elif vol["ratio"] > 1.5 and not ma_cross["bullish"]:
            score -= 5  # volume confirms downtrend

    score = max(0, min(100, score))

    # Verdict
    if score >= 75:
        verdict = "強勢"
    elif score >= 60:
        verdict = "偏多"
    elif score >= 40:
        verdict = "中性"
    elif score >= 25:
        verdict = "偏空"
    else:
        verdict = "弱勢"

    return _safe({
        "price": price,
        "rsi": rsi,
        "macd": macd,
        "bb": bb,
        "kdj": kdj,
        "atr": atr,
        "atr_pct": atr_pct,
        "support": support,
        "resistance": resistance,
        "ma60": ma60,
        "volume": vol,
        "ma_crossover": ma_cross,
        "tech_score": score,
        "verdict": verdict,
    })


# ---------------------------------------------------------------------------
# Fundamental Analysis
# ---------------------------------------------------------------------------

def analyze_revenue(revenue_data: list) -> dict:
    """Compute MoM and YoY changes from FinMind monthly revenue data."""
    if not revenue_data:
        return {"latest_revenue": None, "mom_change": None, "yoy_change": None, "months": []}

    # Sort by date
    sorted_data = sorted(revenue_data, key=lambda x: x.get("date", ""))
    latest = sorted_data[-1] if sorted_data else {}
    latest_rev = latest.get("revenue", 0)

    mom_change = None
    yoy_change = None

    if len(sorted_data) >= 2:
        prev = sorted_data[-2].get("revenue", 0)
        if prev and prev > 0:
            mom_change = (latest_rev - prev) / prev * 100

    if len(sorted_data) >= 13:
        prev_year = sorted_data[-13].get("revenue", 0)
        if prev_year and prev_year > 0:
            yoy_change = (latest_rev - prev_year) / prev_year * 100

    months = []
    for item in sorted_data[-12:]:
        months.append({
            "date": item.get("date", ""),
            "revenue": item.get("revenue", 0),
        })

    return _safe({
        "latest_revenue": latest_rev,
        "mom_change": mom_change,
        "yoy_change": yoy_change,
        "months": months,
    })


def compute_fundamental_score(pe_data: dict | None, revenue_analysis: dict, industry: str) -> dict:
    """Industry-aware PE thresholds + revenue YoY scoring."""
    score = 50  # neutral

    # Industry-based PE thresholds
    if "半導體" in industry or "IC設計" in industry or "晶圓代工" in industry or "封測" in industry:
        pe_fair = 20
    elif "金融" in industry or "金控" in industry:
        pe_fair = 12
    elif "電信" in industry:
        pe_fair = 15
    elif "食品" in industry or "通路" in industry:
        pe_fair = 18
    elif "鋼鐵" in industry:
        pe_fair = 10
    elif "航運" in industry:
        pe_fair = 8
    else:
        pe_fair = 15

    # PE scoring (-20 to +20)
    if pe_data and pe_data.get("pe"):
        pe = pe_data["pe"]
        if pe > 0:
            ratio = pe / pe_fair
            if ratio < 0.7:
                score += 20  # significantly undervalued
            elif ratio < 0.9:
                score += 10
            elif ratio > 1.5:
                score -= 20  # significantly overvalued
            elif ratio > 1.2:
                score -= 10

    # Revenue YoY scoring (-15 to +15)
    yoy = revenue_analysis.get("yoy_change")
    if yoy is not None:
        if yoy > 30:
            score += 15
        elif yoy > 15:
            score += 10
        elif yoy > 5:
            score += 5
        elif yoy < -20:
            score -= 15
        elif yoy < -10:
            score -= 10
        elif yoy < 0:
            score -= 5

    # MoM scoring (-5 to +5)
    mom = revenue_analysis.get("mom_change")
    if mom is not None:
        if mom > 10:
            score += 5
        elif mom < -10:
            score -= 5

    score = max(0, min(100, score))

    return _safe({
        "score": score,
        "pe_fair": pe_fair,
        "pe_actual": pe_data.get("pe") if pe_data else None,
        "yoy_change": yoy,
        "mom_change": mom,
    })


# ---------------------------------------------------------------------------
# Chip (Institutional) Analysis
# ---------------------------------------------------------------------------

def compute_chip_score(inst_data: list) -> dict:
    """Score based on foreign/trust/dealer net buy/sell over multiple periods."""
    if not inst_data:
        return _safe({"score": 50, "foreign_net": 0, "trust_net": 0, "dealer_net": 0,
                       "periods": {}, "trend": "unknown"})

    sorted_data = sorted(inst_data, key=lambda x: x.get("date", ""))

    def _sum_net(data_slice: list, name_key: str = "name") -> dict:
        foreign = 0
        trust = 0
        dealer = 0
        for row in data_slice:
            n = row.get(name_key, "")
            buy = row.get("buy", 0) or 0
            sell = row.get("sell", 0) or 0
            net = buy - sell
            if "外資" in n or "Foreign" in n:
                foreign += net
            elif "投信" in n or "Trust" in n:
                trust += net
            elif "自營" in n or "Dealer" in n:
                dealer += net
        return {"foreign": foreign, "trust": trust, "dealer": dealer}

    # Multi-period analysis
    n = len(sorted_data)
    periods = {}
    for label, days in [("5d", 5), ("20d", 20), ("60d", 60)]:
        # Each day can have multiple rows (one per institution type)
        # Get unique dates
        dates = sorted(set(r.get("date", "") for r in sorted_data))
        recent_dates = dates[-days:] if len(dates) >= days else dates
        recent_data = [r for r in sorted_data if r.get("date", "") in recent_dates]
        periods[label] = _sum_net(recent_data)

    total = _sum_net(sorted_data)

    # Scoring
    score = 50
    p5 = periods.get("5d", {})
    p20 = periods.get("20d", {})

    # Foreign investor weight (heaviest)
    if p5.get("foreign", 0) > 0:
        score += 10
    elif p5.get("foreign", 0) < 0:
        score -= 10

    if p20.get("foreign", 0) > 0:
        score += 5
    elif p20.get("foreign", 0) < 0:
        score -= 5

    # Trust (investment trust) — often a leading indicator
    if p5.get("trust", 0) > 0:
        score += 8
    elif p5.get("trust", 0) < 0:
        score -= 8

    if p20.get("trust", 0) > 0:
        score += 4
    elif p20.get("trust", 0) < 0:
        score -= 4

    # Dealer — minor weight
    if p5.get("dealer", 0) > 0:
        score += 3
    elif p5.get("dealer", 0) < 0:
        score -= 3

    score = max(0, min(100, score))

    # Trend detection
    f5 = p5.get("foreign", 0)
    f20 = p20.get("foreign", 0)
    p60 = periods.get("60d", {})
    f60 = p60.get("foreign", 0)

    if f5 > 0 and f20 > 0 and f60 > 0:
        if abs(f5) > abs(f20) / 4:  # 5d pace > 20d pace
            trend = "accelerating_buy"
        else:
            trend = "consistent_buy"
    elif f5 < 0 and f20 < 0 and f60 < 0:
        if abs(f5) > abs(f20) / 4:
            trend = "accelerating_sell"
        else:
            trend = "consistent_sell"
    elif f5 > 0 and f20 < 0:
        trend = "reversal_buy"
    elif f5 < 0 and f20 > 0:
        trend = "decelerating_buy"
    else:
        trend = "mixed"

    return _safe({
        "score": score,
        "foreign_net": total.get("foreign", 0),
        "trust_net": total.get("trust", 0),
        "dealer_net": total.get("dealer", 0),
        "periods": periods,
        "trend": trend,
    })


# ---------------------------------------------------------------------------
# Industry Scoring
# ---------------------------------------------------------------------------

def compute_industry_score(stock_id: str) -> dict:
    """Score based on whether the stock's industry is in HOT_INDUSTRIES."""
    profile = STOCK_PROFILES.get(stock_id, {})
    industry = profile.get("industry", "")

    score = 50  # neutral baseline
    matched = []

    for hot in HOT_INDUSTRIES:
        if hot in industry:
            score += 10
            matched.append(hot)

    # AI-adjacent bonus
    ai_related = ["伺服器", "IC設計", "晶圓代工", "封測", "PCB-載板", "網通", "電源管理", "散熱"]
    for kw in ai_related:
        if kw in industry and "AI" not in matched:
            score += 5
            matched.append("AI-adjacent")
            break

    score = max(0, min(100, score))

    return _safe({
        "score": score,
        "industry": industry,
        "hot_matches": matched,
    })


# ---------------------------------------------------------------------------
# Multi-Factor Scoring
# ---------------------------------------------------------------------------

def compute_total_score(fundamental: dict, chip: dict, tech_score: int,
                        industry: dict, atr_pct: float | None) -> dict:
    """Weighted total score with dynamic weights based on volatility."""
    weights = dict(SCORE_WEIGHTS)

    # Dynamic weight adjustment based on ATR volatility
    if atr_pct is not None:
        if atr_pct > 3.0:
            # High volatility — increase technical weight
            weights["technical"] = 0.30
            weights["fundamental"] = 0.30
            weights["chip"] = 0.25
            weights["industry"] = 0.15
        elif atr_pct < 1.0:
            # Low volatility — increase fundamental weight
            weights["fundamental"] = 0.50
            weights["chip"] = 0.25
            weights["technical"] = 0.15
            weights["industry"] = 0.10

    f_score = fundamental.get("score", 50)
    c_score = chip.get("score", 50)
    t_score = tech_score
    i_score = industry.get("score", 50)

    total = (
        f_score * weights["fundamental"]
        + c_score * weights["chip"]
        + t_score * weights["technical"]
        + i_score * weights["industry"]
    )

    return _safe({
        "total": round(total, 1),
        "fundamental_score": f_score,
        "chip_score": c_score,
        "tech_score": t_score,
        "industry_score": i_score,
        "weights_used": weights,
    })


# ---------------------------------------------------------------------------
# Target Prices
# ---------------------------------------------------------------------------

def compute_targets(price: float, tech: dict, pe_data: dict | None,
                    revenue_analysis: dict) -> dict:
    """Short-term (technical S/R) + long-term (PE-based) targets."""
    support = tech.get("support", price * 0.95)
    resistance = tech.get("resistance", price * 1.05)

    short_term = {
        "low": support,
        "high": resistance,
        "range_pct": round((resistance - support) / price * 100, 2) if price else 0,
    }

    # Long-term PE-based target
    long_term = {"low": None, "high": None}
    if pe_data and pe_data.get("pe") and pe_data["pe"] > 0:
        pe = pe_data["pe"]
        eps = price / pe if pe else 0
        if eps > 0:
            yoy = revenue_analysis.get("yoy_change")
            growth = 1.0 + (yoy / 100.0 if yoy else 0)
            growth = max(0.8, min(1.5, growth))  # clamp
            future_eps = eps * growth
            # PE range: 0.8x to 1.2x current PE
            long_term["low"] = round(future_eps * pe * 0.8, 2)
            long_term["high"] = round(future_eps * pe * 1.2, 2)

    return _safe({
        "short_term": short_term,
        "long_term": long_term,
    })


# ---------------------------------------------------------------------------
# Recommendation
# ---------------------------------------------------------------------------

def generate_recommendation(score_result: dict, stock_id: str, price: float,
                            name: str, targets: dict) -> dict:
    """Map total score to recommendation level."""
    total = score_result.get("total", 50)

    if total >= 80:
        action = "strong_buy"
        label = "強力買進"
        reason = f"{name}多項指標強勢，建議積極布局"
    elif total >= 68:
        action = "buy"
        label = "買進"
        reason = f"{name}基本面與籌碼面俱佳，可考慮進場"
    elif total >= 58:
        action = "accumulate"
        label = "逢低布局"
        reason = f"{name}整體評分偏多，適合分批進場"
    elif total >= 42:
        action = "hold"
        label = "持有觀望"
        reason = f"{name}指標中性，建議持有觀察"
    elif total >= 32:
        action = "cautious"
        label = "謹慎操作"
        reason = f"{name}部分指標轉弱，建議減少部位"
    elif total >= 20:
        action = "reduce"
        label = "減碼"
        reason = f"{name}多項指標偏空，建議逐步減碼"
    else:
        action = "sell"
        label = "賣出"
        reason = f"{name}指標全面轉弱，建議出場觀望"

    short_target = targets.get("short_term", {})

    return _safe({
        "action": action,
        "label": label,
        "reason": reason,
        "total_score": total,
        "target_low": short_target.get("low"),
        "target_high": short_target.get("high"),
    })


# ---------------------------------------------------------------------------
# Sentiment (keyword-based)
# ---------------------------------------------------------------------------

def analyze_sentiment(headlines: list[str]) -> dict:
    """Simple keyword-based sentiment with diminishing returns."""
    if not headlines:
        return {"score": 50, "bullish_count": 0, "bearish_count": 0, "label": "中性"}

    bullish_count = 0
    bearish_count = 0

    for headline in headlines:
        for kw in BULLISH_KW:
            if kw in headline:
                bullish_count += 1
                break
        for kw in BEARISH_KW:
            if kw in headline:
                bearish_count += 1
                break

    # Diminishing returns: sqrt scaling
    bull_effect = math.sqrt(bullish_count) * 10 if bullish_count else 0
    bear_effect = math.sqrt(bearish_count) * 10 if bearish_count else 0

    score = 50 + bull_effect - bear_effect
    score = max(0, min(100, score))

    if score >= 65:
        label = "偏多"
    elif score <= 35:
        label = "偏空"
    else:
        label = "中性"

    return _safe({
        "score": round(score, 1),
        "bullish_count": bullish_count,
        "bearish_count": bearish_count,
        "label": label,
    })


# ---------------------------------------------------------------------------
# PE Data helper
# ---------------------------------------------------------------------------

def get_pe_from_yfinance(stock_id: str) -> dict | None:
    """Try to get PE ratio from yfinance info."""
    try:
        ticker = yf.Ticker(f"{stock_id}.TW")
        info = ticker.info
        pe = info.get("trailingPE") or info.get("forwardPE")
        if pe:
            return {"pe": float(pe)}
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Dividend helper
# ---------------------------------------------------------------------------

def analyze_dividend(dividend_data: list) -> dict:
    """Summarize dividend history."""
    if not dividend_data:
        return _safe({"years": [], "avg_yield": None, "latest_cash": None})

    years = {}
    for row in dividend_data:
        year = row.get("date", "")[:4]
        cash = row.get("CashEarningsDistribution", 0) or 0
        stock = row.get("StockEarningsDistribution", 0) or 0
        if year not in years:
            years[year] = {"cash": 0, "stock": 0}
        years[year]["cash"] += cash
        years[year]["stock"] += stock

    year_list = [{"year": y, **v} for y, v in sorted(years.items())]
    latest_cash = year_list[-1]["cash"] if year_list else None

    return _safe({
        "years": year_list[-5:],  # last 5 years
        "avg_yield": None,  # would need price history to compute
        "latest_cash": latest_cash,
    })


# ---------------------------------------------------------------------------
# Main orchestrator per stock
# ---------------------------------------------------------------------------

def analyze_stock(stock_id: str) -> dict:
    """Run full analysis for a single stock."""
    profile = STOCK_PROFILES.get(stock_id, {"name": stock_id, "industry": ""})
    name = profile["name"]
    industry = profile["industry"]

    print(f"  Analyzing {stock_id} ({name})...")

    # 1. Fetch data
    df = fetch_yfinance(stock_id)
    revenue_data = fetch_finmind_revenue(stock_id)
    inst_data = fetch_finmind_institutional(stock_id)
    dividend_data = fetch_finmind_dividend(stock_id)
    pe_data = get_pe_from_yfinance(stock_id)

    # 2. Technical analysis (requires price data)
    if df is not None and not df.empty:
        tech = full_technical_analysis(stock_id, df)
    else:
        tech = _safe({
            "price": None, "rsi": None, "macd": None, "bb": None,
            "kdj": None, "atr": None, "atr_pct": None,
            "support": None, "resistance": None, "ma60": None,
            "volume": None, "ma_crossover": None,
            "tech_score": 50, "verdict": "無資料",
        })

    # 3. Fundamental analysis
    revenue_analysis = analyze_revenue(revenue_data)
    fundamental = compute_fundamental_score(pe_data, revenue_analysis, industry)

    # 4. Chip (institutional) analysis
    chip = compute_chip_score(inst_data)

    # 5. Industry scoring
    industry_result = compute_industry_score(stock_id)

    # 6. Multi-factor total score
    score_result = compute_total_score(
        fundamental, chip, tech.get("tech_score", 50),
        industry_result, tech.get("atr_pct"),
    )

    # 7. Target prices
    price = tech.get("price") or 0
    targets = compute_targets(price, tech, pe_data, revenue_analysis)

    # 8. Recommendation
    recommendation = generate_recommendation(score_result, stock_id, price, name, targets)

    # 9. Sentiment (no headlines available in standalone mode)
    sentiment = analyze_sentiment([])

    # 10. Dividend
    dividend = analyze_dividend(dividend_data)

    return _safe({
        "stock_id": stock_id,
        "name": name,
        "industry": industry,
        "technical": tech,
        "fundamental": fundamental,
        "chip": chip,
        "industry_score": industry_result,
        "total_score": score_result,
        "targets": targets,
        "recommendation": recommendation,
        "sentiment": sentiment,
        "revenue": revenue_analysis,
        "dividend": dividend,
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Starting enhanced stock analysis...")
    output = {
        "generated_at": datetime.now(ZoneInfo("Asia/Taipei")).isoformat(),
        "market_regime": "normal",
        "stocks": {},
    }

    for stock_id in WATCHLIST:
        try:
            result = analyze_stock(stock_id)
            output["stocks"][stock_id] = result
            time.sleep(0.3)  # Rate limiting
        except Exception as e:
            print(f"Error analyzing {stock_id}: {e}")

    # Write output
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "data", "enhanced.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Enhanced analysis written: {len(output['stocks'])} stocks → {os.path.abspath(out_path)}")


if __name__ == "__main__":
    main()
