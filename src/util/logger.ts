import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import type { Config } from '../config/types.js';

let loggerInstance: pino.Logger | null = null;

export function initLogger(config: Config): pino.Logger {
  mkdirSync(dirname(config.logFile), { recursive: true });
  loggerInstance = pino(
    {
      level: config.logLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ dest: config.logFile, sync: false }),
  );
  return loggerInstance;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    loggerInstance = pino({ level: 'info' });
  }
  return loggerInstance;
}
