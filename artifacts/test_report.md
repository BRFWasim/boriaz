# Hyperliquid Whales Dashboard - Analyse marché Tab Test Report
**Date:** September 3, 2026, 08:40 UTC  
**URL Tested:** http://127.0.0.1:4317/

## Test Objectives
1. Open the app and click the "Analyse marché" tab (formerly "Analyse BTC")
2. Verify presence of all required sections and data
3. Confirm AI section shows as optional/skipped until clicking "Avis IA"
4. Document UI bugs and capture screenshots

---

## ✅ Test Results Summary

### Goal 1: Navigation
**✅ PASSED** - Successfully navigated to "Analyse marché" tab. Tab is properly highlighted and active.

### Goal 2: Required Sections

#### Watchlist Live Table
**✅ PASSED** - All 8 required assets are present:
- RENDER (1.4487)
- ONDO (0.352055)
- UNISWAP (5.7681)
- BTC (77,933.0)
- SOL (100.775)
- ETH (2,487.5)
- HYPE (82.0595)
- TAO (222.675)

**⚠️ BUG:** All timeframe columns (15M, 1H, 2H) show "n/d" (no data) for all assets.

#### BTC Multi-Timeframe Sections
**✅ PASSED** - All three timeframes present with sparklines:
- **1h (Court terme):** ✅ Visible with sparkline, metrics, and buy zone
- **4h (Moyen terme):** ✅ Visible with sparkline, metrics, and buy zone
- **1d (Long terme):** ✅ Visible with sparkline, metrics, and buy zone

**⚠️ BUGS:**
- EMA200 shows "n/d" for 1h section
- EMA200 shows "n/d" for 4h section
- EMA200 correctly populated (70,535.5) for 1d section ✅

#### SOL Court/Moyen Section
**✅ PASSED** - SOL analysis sections present:
- **1h (Court terme):** ✅ Visible with sparkline and buy zone
- **4h (Moyen terme):** ✅ Visible with sparkline and buy zone

**⚠️ BUG:** SOL EMA200 also shows "n/d" for 4h section

#### Buy Zones for Watchlist
**✅ PASSED** - Complete "ZONES D'ACHAT IDÉALES (WATCHLIST)" section present with all 8 assets:
- RENDER: 1.429 -> 1.448 (patienter, 40/100)
- ONDO: 0.35024 -> 0.35435 (patienter, 40/100)
- UNI: 5.489 -> 5.626 (patienter, 40/100)
- BTC: 77,326 -> 77,765 (acheter zone, 65/100)
- SOL: 100.20 -> 100.78 (patienter, 40/100)
- ETH: 2,410 -> 2,432 (patienter, 35/100)
- HYPE: 81.52 -> 82.07 (patienter, 40/100)
- TAO: 221.39 -> 222.33 (patienter, 40/100)

#### Telegram Section
**✅ PASSED** - Telegram section present with correct functionality:
- Title: "TELEGRAM - @BORIAZBOT"
- Description: "Bilan automatique toutes les 2h - notif immédiate si +1.5% en ~20 min sur RENDER, ONDO, UNI, BTC, SOL, ETH, HYPE, TAO."
- Buttons: "Lier Telegram", "Test", "Forcer bilan 2h"
- Status: Shows next bilan time and confirmation

### Goal 3: AI Section Verification
**✅ PASSED** - AI section correctly shows as optional/skipped:
- "Avis IA (cache 45 min)" button visible but not clicked
- Buy zones header shows "0 token IA" confirming AI is not active
- No AI-generated analysis visible until button is clicked

---

## 🐛 UI Bugs Found

### Critical Data Issues
1. **Watchlist Timeframe Columns Empty**
   - All 15M, 1H, 2H columns show "n/d" for all assets
   - Should display percentage changes for these timeframes
   - This affects real-time monitoring capability

2. **Missing EMA200 Values**
   - BTC 1h section: EMA200 = "n/d"
   - BTC 4h section: EMA200 = "n/d"
   - SOL 4h section: EMA200 = "n/d"
   - BTC 1d section: EMA200 = 70,535.5 ✅ (works correctly)
   - Suggests issue with calculating EMA200 for shorter timeframes with insufficient data

### Minor Issues
3. **Typo in BTC Section**
   - "haussier" misspelled as "hausssier" (three S's instead of two)
   - Visible in 1h section labels

---

## 📸 Screenshots Captured

All screenshots saved to `/workspace/artifacts/`:
1. `analyse_marche_watchlist_top.webp` - Watchlist table and BTC 1h section
2. `analyse_marche_btc_4h.webp` - BTC 4h section with sparkline
3. `analyse_marche_btc_1d.webp` - BTC 1d section with sparkline
4. `analyse_marche_sol.webp` - SOL sections with analysis
5. `analyse_marche_buy_zones.webp` - Buy zones and Telegram section

---

## ✅ Overall Assessment

**Layout & Structure:** Excellent - All required sections are present and well-organized.

**Data Completeness:** Partial - Core price data and technical indicators load correctly, but timeframe percentage changes and some EMA200 values are missing.

**UI Functionality:** Good - Navigation works properly, AI section correctly shows as optional.

**Bugs Severity:** Medium - The missing data ("n/d" values) impacts usability but doesn't break core functionality.

---

## Recommendations

1. **Priority Fix:** Investigate why 15M/1H/2H percentage changes aren't calculating in the watchlist
2. **Secondary Fix:** Debug EMA200 calculation for 1h and 4h timeframes (may need more historical data)
3. **Minor Fix:** Correct typo "hausssier" -> "haussier"
4. **Enhancement:** Consider adding loading states instead of showing "n/d" to differentiate between "loading" vs "unavailable"
