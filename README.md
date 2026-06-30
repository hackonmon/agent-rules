# Polymarket Cross-Line Arbitrage Bot

<img width="1983" height="793" alt="0f0acf14-94f9-4fc7-a95f-a5179ae14f57" src="https://github.com/user-attachments/assets/dce3d178-dd49-4c06-b639-6e4bd3908463" />

> A polymarket trading bot that detects temporary pricing inefficiencies across connected Polymarket sports markets.

<p align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-orange.svg)](#)
[![Polymarket](https://img.shields.io/badge/Platform-Polymarket-6f42c1.svg)](#)

</p>


## Why Open Source?

This repository is **not a commercial product**.

It exists for one reason:

> **To share a real working trading system instead of publishing endless AI-generated articles that provide no practical value.**

There are thousands of blog posts explaining arbitrage.

Very few people actually build one.

This project is my attempt to bridge that gap.

Everything inside this repository comes from building, testing, breaking, and rebuilding real trading infrastructure.

---

### A Few Honest Notes

This bot **will not magically print money.**

I don't hide that.

Markets evolve.

Edges disappear.

Liquidity changes.

Competition increases.

This repository is **a foundation**, not a guaranteed income machine.

However, it contains many of the engineering ideas, mathematical models, and architecture that I used before becoming consistently profitable.

If you're interested in quantitative trading, prediction markets, market microstructure, or TypeScript architecture, I hope you'll learn something useful.

---

### Trading is Mathematics

While building this project I also created:

**STAKE-MATH**

A Node.js library implementing Kelly-based stake sizing and probability mathematics.

Trading is not gambling.

Trading is probability management.

Without mathematics, risk management becomes guessing.

Many of the position sizing models used here are based on the Kelly Criterion, fractional Kelly, expected value, and bankroll optimization.

Those mathematical foundations have been responsible for far more of my long-term success than any individual trading strategy.

---

### My Recommendation

If you decide to experiment with this project:

- start with simulation mode
- understand every trade the bot makes
- test your own ideas
- use small position sizes
- never risk money you cannot afford to lose

Happy Trading ❤️

---

# Features

- ⚡ Real-time Polymarket CLOB streaming
- 🧠 Cross-line arbitrage detection
- 📈 Kelly Criterion stake sizing
- 💰 Paper trading & Live trading
- 🛡 Risk management engine
- 📊 Beautiful terminal dashboard
- 🧩 Modular architecture
- 📝 Structured logging
- 🚀 Production-oriented TypeScript codebase

---

# Strategy

Sports markets inside a single event should satisfy several no-arbitrage relationships.

Whenever one market reprices faster than another after new information arrives, temporary inefficiencies can appear.

The bot continuously:

```
Gamma API
      │
      ▼
Discover connected markets
      │
      ▼
Stream live CLOB orderbooks
      │
      ▼
Detect pricing violations
      │
      ▼
Risk evaluation
      │
      ▼
Kelly stake sizing
      │
      ▼
Submit limit orders
      │
      ▼
Track positions & PnL
```

Current arbitrage checks include:

- Complementary YES/NO pairs
- Totals ladder relationships
- Spread ladder relationships
- Moneyline vs Spread
- Three-way market sums
- BTTS relationships

---

# Supported Sports

By default the bot focuses on the markets where liquidity is strongest.

| Sport | Markets |
|--------|----------|
| 🏀 NBA | Games, Futures, Draft, Trades, Props |
| ⚽ FIFA World Cup | Match Winner, Groups, Knockout, Tournament Winner |

```
SPORT_FOCUS=nba,world_cup
```

Discovery logs look like:

```
Discovery refresh:

40 events
520 tokens

NBA: 10
World Cup: 30
```

Adding another sport only requires creating another profile inside

```
src/model/sportsRegistry.ts
```

---

# Quick Start

```bash
git clone https://github.com/PolySports/polymarket-cross-line-arbitrage-bot.git

cd polymarket-cross-line-arbitrage-bot

cp .env.example .env

npm install

npm run start:sim
```

---

# CLI

```bash
npm start -- --mode sim
```

```bash
npm start -- --mode live --confirm-live
```

```bash
npm start -- --event nba-lal-bos-2026-01-15
```

```bash
npm start -- --tag 100381
```

---

# CLI Options

| Flag | Description |
|------|-------------|
| `--mode sim` | Simulation mode |
| `--mode live` | Live trading |
| `--event` | Watch specific event |
| `--tag` | Filter Gamma tags |
| `--confirm-live` | Required safety confirmation |

---

# Terminal Dashboard

```
┌───────────────────────────────────────────────────────────────┐
│ Header                                                       │
│ Mode • WS Status • Balance • PnL • Uptime                    │
├───────────────────────────────────────────────────────────────┤
│ Tracked Markets            │ Opportunities                   │
├────────────────────────────┴──────────────────────────────────┤
│ PnL Chart                                           Exposure  │
├───────────────────────────────────────────────────────────────┤
│ Orders / Fills             │ Alerts                          │
└───────────────────────────────────────────────────────────────┘

[p] Pause

[f] Flatten

[q] Quit
```

Logs are written separately using **Pino** so they never corrupt the dashboard.

---

# Configuration

See `.env.example`.

Important variables:

| Variable | Default | Description |
|------------|------------|-----------------------------|
| MODE | sim | sim or live |
| MIN_NET_EDGE_BPS | 50 | Minimum edge |
| MAX_POSITION_USD | 500 | Max Kelly stake |
| KELLY_FRACTION | 0.5 | Half Kelly |
| MIN_STAKE_USD | 5 | Minimum trade |
| MAX_EVENT_EXPOSURE_USD | 200 | Event exposure cap |
| DAILY_LOSS_LIMIT_USD | 100 | Kill switch |
| SIM_INITIAL_BALANCE | 10000 | Paper balance |

---

# Kelly Stake Sizing

The project sizes positions using the Kelly Criterion.

```
f* = (p − price)
     ───────────
      (1-price)
```

```
stake = bankroll
      × Kelly
      × Fractional Kelly
```

Position sizes are automatically clamped between:

- Minimum stake
- Maximum position
- Event exposure limits

Supported for:

- Locked arbitrage
- Relative value
- Hedged ladder trades

Default configuration uses **Half Kelly (0.5)** to reduce variance.

---

# Architecture

```
                Gamma REST
                     │
                     ▼
               Event Graph
                     │
                     ▼
              Market Classifier
                     │
                     ▼
           CLOB REST / WebSocket
                     │
                     ▼
             OrderBook Store
                     │
                     ▼
            Arbitrage Detector
                     │
                     ▼
              Risk Management
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
 Sim Executor              Live Executor
        │                         │
        └────────────┬────────────┘
                     ▼
            Portfolio + Dashboard
```

---

# Live Trading

Live mode requires:

```
PRIVATE_KEY

CLOB_API_KEY

CLOB_API_SECRET

CLOB_API_PASSPHRASE
```

and either

```
--confirm-live
```

or

```
CONFIRM_LIVE=true
```

Execution uses

```
@polymarket/clob-client-v2
```

against production endpoints.

---

# Project Structure

```
src/

├── arb/
│   └── Arbitrage detection

├── config/
│   └── Zod configuration

├── core/
│   └── Engine

├── data/
│   ├── Gamma
│   ├── CLOB REST
│   └── WebSocket

├── exec/
│   ├── Simulation
│   ├── Live
│   └── Order Manager

├── model/
│   ├── Event Graph
│   └── Classifier

├── portfolio/
│   └── PnL

├── risk/
│   └── Exposure controls

├── ui/
│   └── blessed-contrib dashboard

└── util/
    ├── Logging
    ├── Math
    └── Rate limiting
```

---

# Testing

```bash
npm test
```

---

# Roadmap

- [ ] Additional sports
- [ ] Historical backtesting
- [ ] Strategy plugins
- [ ] Multi-exchange support
- [ ] Automatic parameter optimization
- [ ] Portfolio analytics
- [ ] Web dashboard
- [ ] Discord notifications

---

# Contributing

Contributions are welcome.

Whether you're interested in:

- quantitative trading
- prediction markets
- TypeScript
- market microstructure
- performance optimization

feel free to open an Issue or Pull Request.

---

# Disclaimer

This repository is provided **for educational purposes only**.

Nothing contained here should be interpreted as financial advice.

Prediction markets involve substantial financial risk.

Always test thoroughly using simulation before deploying capital.

Past performance does not guarantee future results.

---

<p align="center">

### Built with ❤️ for the Polymarket developer community.

If this repository helped you learn something new, consider giving it a ⭐.

</p>
