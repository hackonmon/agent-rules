import type { Config, EngineStatus, EventGraph, FillEvent, MarketRow, Opportunity } from '../config/types.js';
import { ArbDetector } from '../arb/detector.js';
import { ClobRestClient } from '../data/clobRest.js';
import { GammaClient } from '../data/gammaClient.js';
import { MarketSocket } from '../data/marketSocket.js';
import { OrderBookStore } from '../data/orderBook.js';
import { UserSocket } from '../data/userSocket.js';
import { buildEventGraphs, flattenTokenIds } from '../model/eventGraph.js';
import { SPORT_PROFILES } from '../model/sportsRegistry.js';
import { PortfolioTracker } from '../portfolio/positions.js';
import { RiskManager } from '../risk/riskManager.js';
import { StakeSizer } from '../risk/stakeSizer.js';
import type { ExecutionEngine } from '../exec/executor.js';
import { LiveExecutor, createLiveClobClient } from '../exec/liveExecutor.js';
import { OrderManager } from '../exec/orderManager.js';
import { SimExecutor } from '../exec/simExecutor.js';
import { Dashboard } from '../ui/dashboard.js';
import { getLogger, initLogger } from '../util/logger.js';

export class Engine {
  private readonly store = new OrderBookStore();
  private readonly gamma: GammaClient;
  private readonly rest: ClobRestClient;
  private readonly detector: ArbDetector;
  private readonly risk: RiskManager;
  private readonly stakeSizer: StakeSizer;
  private readonly portfolio: PortfolioTracker;
  private readonly executor: ExecutionEngine;
  private readonly orderManager: OrderManager;
  private simExecutor: SimExecutor | null = null;
  private liveExecutor: LiveExecutor | null = null;
  private marketSocket: MarketSocket | null = null;
  private userSocket: UserSocket | null = null;
  private dashboard: Dashboard | null = null;

  private graphs: EventGraph[] = [];
  private opportunities: Opportunity[] = [];
  private recentFills: FillEvent[] = [];
  private alerts: string[] = [];
  private paused = false;
  private running = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private readonly startTime = Date.now();

  constructor(private readonly config: Config) {
    initLogger(config);
    this.gamma = new GammaClient(config);
    this.rest = new ClobRestClient(config, this.store);
    this.detector = new ArbDetector(config);
    this.risk = new RiskManager(config);
    this.stakeSizer = new StakeSizer(config);
    this.portfolio = new PortfolioTracker(config.simInitialBalance);

    if (config.mode === 'live') {
      this.liveExecutor = new LiveExecutor({
        createClient: () => createLiveClobClient(config),
      });
      this.executor = this.liveExecutor;
    } else {
      this.simExecutor = new SimExecutor(config, this.store);
      this.executor = this.simExecutor;
    }

    this.orderManager = new OrderManager(this.executor);
    this.risk.resetDaily(this.executor.getBalance());
  }

  async start(): Promise<void> {
    this.running = true;
    const log = getLogger();

    if (this.liveExecutor) {
      await this.liveExecutor.init();
    }

    this.dashboard = new Dashboard({
      onPauseToggle: () => {
        this.paused = !this.paused;
      },
      onFlatten: () => {
        void this.executor.cancelAll();
        this.addAlert('All orders cancelled (flatten)');
      },
      onQuit: () => {
        void this.stop();
      },
    });

    this.executor.onFill((fill) => this.handleFill(fill));

    await this.refreshDiscovery();
    await this.startMarketData();

    if (this.config.mode === 'live' && this.liveExecutor && this.config.clobApiKey) {
      this.userSocket = new UserSocket(
        this.config,
        {
          apiKey: this.config.clobApiKey,
          secret: this.config.clobApiSecret!,
          passphrase: this.config.clobApiPassphrase!,
        },
        {
          onConnect: () => this.addAlert('User WS connected'),
          onDisconnect: () => this.addAlert('User WS disconnected'),
          onFill: (fill) => this.liveExecutor?.handleExternalFill(fill),
          onAlert: (msg) => this.addAlert(msg),
        },
      );
      const conditionIds = [...new Set(this.graphs.flatMap((g) => g.markets.map((m) => m.conditionId)))];
      await this.userSocket.start(conditionIds);
    }

    this.tickTimer = setInterval(() => {
      void this.tick();
    }, this.config.tickIntervalMs);

    this.discoveryTimer = setInterval(() => {
      void this.refreshDiscovery();
    }, this.config.discoveryRefreshMs);

    log.info({ mode: this.config.mode }, 'Engine started');
    this.addAlert(`Engine started in ${this.config.mode.toUpperCase()} mode`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.marketSocket?.stop();
    this.userSocket?.stop();
    await this.executor.cancelAll();
    this.dashboard?.destroy();
    getLogger().info('Engine stopped');
  }

  private async refreshDiscovery(): Promise<void> {
    try {
      const events = await this.gamma.discoverEvents();
      const graphs = buildEventGraphs(events, this.config.sportFocus);
      if (graphs.length === 0) {
        getLogger().warn('Discovery returned no tradable sports events; keeping previous graph');
        this.addAlert(
          this.graphs.length > 0
            ? `Discovery refresh: no new events (keeping ${this.graphs.length})`
            : 'Discovery refresh: 0 events — check network or TAG_IDS',
        );
        return;
      }

      this.graphs = graphs;
      const tokenIds = flattenTokenIds(this.graphs);

      if (tokenIds.length > 0) {
        await this.rest.fetchBooks(tokenIds);
        await this.marketSocket?.resubscribe(tokenIds);
      }

      this.addAlert(
        `Discovery refresh: ${this.graphs.length} events, ${tokenIds.length} tokens (${formatSportCounts(this.graphs)})`,
      );
    } catch (error) {
      getLogger().error({ error }, 'Discovery refresh failed');
      this.addAlert('Discovery refresh failed');
    }
  }

  private async startMarketData(): Promise<void> {
    const tokenIds = flattenTokenIds(this.graphs);
    await this.rest.fetchBooks(tokenIds);

    this.marketSocket = new MarketSocket(this.config, this.store, {
      onConnect: () => this.addAlert('Market WS connected'),
      onDisconnect: () => this.addAlert('Market WS disconnected'),
      onAlert: (msg) => this.addAlert(msg),
    });

    await this.marketSocket.start(tokenIds);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    this.simExecutor?.processRestingOrders();

    for (const graph of this.graphs) {
      await this.orderManager.cancelAllAtGameStart(graph);
    }

    this.opportunities = this.detector.scan(this.graphs, this.store);

    if (!this.paused && !this.risk.isKillSwitchActive()) {
      for (const opp of this.opportunities.slice(0, 3)) {
        const graph = this.graphs.find((g) => g.eventId === opp.eventId);
        if (!graph) continue;

        const sized = this.stakeSizer.apply(opp, this.executor.getBalance());

        const decision = this.risk.approve(sized, graph, this.executor.getBalance());
        if (!decision.approved) continue;
        if (this.orderManager.isInFlight(sized.id)) continue;

        const metaByMarket = new Map(
          graph.markets.map((m) => [m.id, { tickSize: m.minimumTickSize, negRisk: m.negRisk }]),
        );

        const ok = await this.orderManager.executeOpportunity(sized, metaByMarket);
        if (ok) {
          this.risk.markExecuted(sized, graph);
          this.dashboard?.logOrder(`Executed ${sized.relation}: ${sized.description}`);
        }
      }
    }

    if (this.risk.isKillSwitchActive()) {
      this.addAlert('KILL SWITCH: daily loss limit hit');
    }

    const status = this.buildStatus();
    this.dashboard?.render(status);
  }

  private handleFill(fill: FillEvent): void {
    this.portfolio.applyFill(fill);
    this.recentFills.unshift(fill);
    if (this.recentFills.length > 50) this.recentFills.pop();
    this.dashboard?.logFill(fill);
  }

  private buildStatus(): EngineStatus {
    const portfolio = this.portfolio.snapshot(this.store);
    return {
      mode: this.config.mode,
      paused: this.paused,
      uptimeMs: Date.now() - this.startTime,
      wsConnected: this.marketSocket?.connected ?? false,
      userWsConnected: this.userSocket?.connected ?? false,
      trackedEvents: this.graphs.length,
      trackedMarkets: this.graphs.reduce((n, g) => n + g.markets.length, 0),
      trackedTokens: flattenTokenIds(this.graphs).length,
      opportunities: this.opportunities,
      recentFills: this.recentFills,
      alerts: this.alerts.slice(-20),
      portfolio,
      marketRows: this.buildMarketRows(),
    };
  }

  private buildMarketRows(): MarketRow[] {
    const rows: MarketRow[] = [];
    for (const graph of this.graphs) {
      for (const market of graph.markets) {
        const yesBid = this.store.bestBid(market.tokens.yesTokenId);
        const yesAsk = this.store.bestAsk(market.tokens.yesTokenId);
        rows.push({
          sport: graph.sportId ? SPORT_PROFILES[graph.sportId].label : '-',
          eventTitle: graph.title,
          marketType: market.type,
          question: market.question,
          bestBid: yesBid,
          bestAsk: yesAsk,
          impliedProb: this.store.impliedProb(market.tokens.yesTokenId),
        });
      }
    }
    return rows;
  }

  private addAlert(message: string): void {
    const ts = new Date().toISOString().slice(11, 19);
    this.alerts.push(`[${ts}] ${message}`);
    if (this.alerts.length > 100) this.alerts.shift();
    this.dashboard?.logAlert(message);
  }
}

export function parseCliArgs(argv: string[]): {
  mode?: 'sim' | 'live';
  tagIds?: number[];
  eventSlugs?: string[];
  confirmLive?: boolean;
} {
  const result: ReturnType<typeof parseCliArgs> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      result.mode = argv[++i] as 'sim' | 'live';
    } else if (arg === '--tag' && argv[i + 1]) {
      result.tagIds = result.tagIds ?? [];
      result.tagIds.push(Number(argv[++i]));
    } else if (arg === '--event' && argv[i + 1]) {
      result.eventSlugs = result.eventSlugs ?? [];
      result.eventSlugs.push(argv[++i]);
    } else if (arg === '--confirm-live') {
      result.confirmLive = true;
    }
  }

  return result;
}

function formatSportCounts(graphs: EventGraph[]): string {
  const counts = new Map<string, number>();
  for (const graph of graphs) {
    const label = graph.sportId ? SPORT_PROFILES[graph.sportId].label : 'Other';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `${label}:${n}`).join(', ');
}
