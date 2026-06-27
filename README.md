# Polymarket Cross-Line Arbitrage Bot

TypeScript bot that detects and trades **cross-line mispricings** across connected sports markets within a single Polymarket event (moneyline, spread, totals, draw, BTTS). Runs in **simulation** (paper trading) or **live** (CLOB V2) mode with a **blessed-contrib** terminal dashboard.

## Strategy

Sports markets inside one event should satisfy no-arbitrage relationships. When one line reprices faster than another after a game-state change, temporary violations appear. The bot:

- Discovers connected markets via Gamma API
- Streams live order books via CLOB WebSocket
- Detects violations (complementary pairs, totals/spread ladders, ML vs spread, 3-way sums)
- Places limit orders through a shared execution pipeline
- Tracks PnL, exposure, and risk limits

## Sport focus (NBA + World Cup)

By default the bot tracks **only NBA and World Cup** markets. Other sports can be added later in [`src/model/sportsRegistry.ts`](src/model/sportsRegistry.ts).

```env
SPORT_FOCUS=nba,world_cup
```

| Sport | What it tracks | Sources |
|-------|----------------|---------|
| **NBA** | NBA games + NBA futures (draft, trades, props) | Tag `745`, series `10345`, games tag filtered by NBA |
| **World Cup** | FIFA World Cup matches, groups, winner markets | Series `11433`, tags `102232` / `100350` |

Discovery alerts now show sport breakdown, e.g. `Discovery refresh: 40 events, 520 tokens (NBA:10, World Cup:30)`.

To add a sport later: define a new profile in `sportsRegistry.ts` and append it to `SPORT_FOCUS`.

## Quick Start

```bash
cp .env.example .env
npm install
npm run start:sim
```

### CLI Options

```bash
npm start -- --mode sim
npm start -- --mode live --confirm-live --event nba-lal-bos-2026-01-15
npm start -- --tag 100381 --mode sim
```

| Flag | Description |
|------|-------------|
| `--mode sim\|live` | Execution mode (default: sim) |
| `--event <slug>` | Track specific event slug (repeatable) |
| `--tag <id>` | Filter by Gamma tag ID (repeatable) |
| `--confirm-live` | Required safety gate for live trading |

## Terminal UI

```
┌─ Header: mode, WS status, balance, PnL, uptime ─────────────────┐
├─ Tracked Markets ──────┬─ Opportunities ──────────────────────────┤
├─ PnL Chart ────────────┴─ Exposure Gauge ────────────────────────┤
├─ Orders / Fills ───────┬─ Alerts ────────────────────────────────┤
└─ [p] pause [f] flatten [q] quit ─────────────────────────────────┘
```

Logs are written to `logs/bot.log` (pino) so they don't corrupt the TUI.

## Configuration

See [`.env.example`](.env.example). Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `sim` | `sim` or `live` |
| `MIN_NET_EDGE_BPS` | `50` | Minimum net edge to trade |
| `MAX_POSITION_USD` | `500` | Max Kelly stake (USD) per opportunity |
| `KELLY_FRACTION` | `0.5` | Fractional Kelly (0.5 = half-Kelly) |
| `MIN_STAKE_USD` | `5` | Minimum Kelly stake per trade |
| `MAX_EVENT_EXPOSURE_USD` | `200` | Max exposure per event |
| `DAILY_LOSS_LIMIT_USD` | `100` | Kill-switch threshold |
| `SIM_INITIAL_BALANCE` | `10000` | Paper trading balance |

## Kelly stake sizing

Position size is computed with the **Kelly criterion** for binary markets (same math as the `stake-math` npm API):

```
f* = (p - price) / (1 - price)
stake = bankroll × f* × KELLY_FRACTION   (clamped to MIN_STAKE_USD … MAX_POSITION_USD)
shares per leg = stake / sum(leg prices)
```

- **Locked arbs** (YES+NO, 3-way sum, ladder hedges): win probability ≈ 1
- **Relative-value trades** (ML vs spread): probability derived from net edge
- Default **half-Kelly** (`KELLY_FRACTION=0.5`) reduces variance

Implemented locally in [`src/util/stakeMath.ts`](src/util/stakeMath.ts) — **do not install `stake-math` or `polymarket-stake-math` from npm**; published versions include a malicious `postinstall` script that downloads remote code.

## Architecture

```
Gamma REST → EventGraph → Classifier
                ↓
CLOB WS/REST → OrderBookStore → ArbDetector → RiskManager
                                    ↓
                          SimExecutor / LiveExecutor
                                    ↓
                          Portfolio + Dashboard
```

## Live Mode

Live mode requires:

- `PRIVATE_KEY`
- `CLOB_API_KEY`, `CLOB_API_SECRET`, `CLOB_API_PASSPHRASE`
- `--confirm-live` or `CONFIRM_LIVE=true`

Uses `@polymarket/clob-client-v2` against CLOB V2 production endpoints.

## Tests

```bash
npm test
```

## Project Structure

```
src/
  arb/          # Relation checks + detector
  config/       # Zod-validated config + shared types
  core/         # Engine orchestrator
  data/         # Gamma, CLOB REST/WS, order books
  exec/         # Sim + live executors, order manager
  model/        # Market classifier, event graph
  portfolio/    # Positions + PnL
  risk/         # Exposure caps, kill switch
  ui/           # blessed-contrib dashboard
  util/         # Math, logging, rate limiting
```

## Disclaimer

This software is for educational purposes. Trading prediction markets involves financial risk. Always test thoroughly in simulation before live trading.
