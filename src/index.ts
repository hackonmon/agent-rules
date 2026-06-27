#!/usr/bin/env node
import { loadConfig } from './config/config.js';
import { Engine, parseCliArgs } from './core/engine.js';
import { getLogger, initLogger } from './util/logger.js';

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const config = loadConfig({
    mode: cli.mode,
    tagIds: cli.tagIds,
    eventSlugs: cli.eventSlugs,
    confirmLive: cli.confirmLive,
  });

  initLogger(config);
  const log = getLogger();

  const engine = new Engine(config);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down');
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await engine.start();
  } catch (error) {
    log.error({ error }, 'Fatal engine error');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
