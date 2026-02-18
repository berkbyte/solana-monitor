# Solana Monitor

**Real-time Solana intelligence dashboard** — live on-chain data, DeFi analytics, whale tracking, and market signals in a unified interface powered by deck.gl 3D globe.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-9945FF?style=flat&logo=solana&logoColor=white)](https://solana.com)

<p align="center">
  <a href="https://solanamonitor.app"><img src="https://img.shields.io/badge/Live_App-solanamonitor.app-14F195?style=for-the-badge&logo=solana&logoColor=white" alt="Live App"></a>
</p>

<p align="center">
  <a href="https://x.com/solanamonitor">𝕏 @solanamonitor</a>
</p>

---

## What is Solana Monitor?

A free, open-source, real-time dashboard for monitoring the entire Solana ecosystem — from on-chain activity and DeFi protocols to whale movements and macro market signals. Everything updates live, rendered on an interactive 3D WebGL globe.

---

## Panels

| # | Panel | Description |
|---|-------|-------------|
| 1 | **Live Charts** | Real-time SOL price charts with TradingView integration |
| 2 | **Token Radar** | New token launches and trending tokens on Solana |
| 3 | **𝕏 Insights** | Twitter/X social sentiment analysis for Solana topics |
| 4 | **Network Status** | TPS, slot height, validator count, epoch progress |
| 5 | **Whale Watch** | Large transaction tracking and whale wallet movements |
| 6 | **Priority Fees** | Current Solana priority fee estimates and trends |
| 7 | **DeFi Overview** | TVL, volume, top protocols across Solana DeFi |
| 8 | **MEV & Jito** | MEV activity, Jito tips, and bundle analytics |
| 9 | **Liquid Staking** | mSOL, jitoSOL, bSOL staking rates and TVL |
| 10 | **Token Analyze** | Deep token analysis — holders, liquidity, risk score |
| 11 | **AI Insights** | AI-generated market briefs and trend detection |
| 12 | **Solana News** | Aggregated news from Solana ecosystem sources |
| 13 | **Crypto Markets** | BTC, ETH, SOL and top crypto prices overview |
| 14 | **Market Radar** | Macro signals — Fear & Greed, funding rates, dominance |
| 15 | **Stablecoins** | USDC, USDT supply and flow tracking |
| 16 | **Crypto ETF Tracker** | Bitcoin & Ethereum ETF inflow/outflow data |
| 17 | **NFT Tracker** | Solana NFT collection floor prices and volume |
| 18 | **Governance** | Solana governance proposals and voting activity |
| 19 | **My Monitors** | Custom user-defined watchlists and alerts |
| 20 | **Solana Globe** | Interactive 3D globe with real-time validator & node visualization |

---

## Tech Stack

- **Frontend:** TypeScript, Vite 6, deck.gl 9, MapLibre GL
- **3D Globe:** deck.gl WebGL rendering with 30+ data layers
- **APIs:** 44 serverless functions (Vercel Edge)
- **Data Sources:** Helius, Jupiter, Birdeye, DeFiLlama, LunarCrush, CoinGecko, and more
- **PWA:** Installable with offline support

---

## Getting Started

```bash
# Clone
git clone https://github.com/berkbyte/solana-monitor.git
cd solana-monitor

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in your API keys

# Run dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Environment Variables

Copy `.env.example` and fill in the required API keys:

| Variable | Service | Required |
|----------|---------|----------|
| `HELIUS_API_KEY` | Helius RPC & DAS | Yes |
| `BIRDEYE_API_KEY` | Token data & prices | Yes |
| `LUNARCRUSH_API_KEY` | Social metrics | Optional |
| `BRIGHT_DATA_API_TOKEN` | X/Twitter search | Optional |
| `COINGECKO_API_KEY` | Market data | Optional |

---

## Build

```bash
# Type check
npx tsc --noEmit

# Production build
npm run build
```

---

## Credits

Forked from [koala73/worldmonitor](https://github.com/koala73/worldmonitor) — rebuilt and adapted for the Solana ecosystem.

---

## License

[MIT](LICENSE)
