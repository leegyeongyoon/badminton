import fs from 'fs';
import path from 'path';
import winston from 'winston';

/**
 * Resolve the directory where rotating log files are written.
 *
 * Default: a `logs/` directory under the server package (two levels up from
 * src/utils). Override with the `LOG_DIR` env var (e.g. a mounted volume in
 * production). The directory is created recursively if missing.
 *
 * File logging is best-effort: if the directory can't be created or written
 * (e.g. read-only filesystem, permission denied) we fall back to console-only
 * so logging never crashes boot.
 */
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');

let fileLoggingEnabled = false;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  // Probe writability so a non-writable dir falls back to console-only instead
  // of throwing later when winston opens the stream.
  fs.accessSync(LOG_DIR, fs.constants.W_OK);
  fileLoggingEnabled = true;
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(
    `[logger] file logging disabled — could not use LOG_DIR "${LOG_DIR}": ${
      (err as Error).message
    }`,
  );
}

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
  }),
];

if (fileLoggingEnabled) {
  // Errors-only file for fast triage of 500s / crashes.
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5 MB per file
      maxFiles: 5,
      tailable: true,
    }),
  );
  // Combined file capturing everything at the logger level.
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5 MB per file
      maxFiles: 5,
      tailable: true,
    }),
  );
}

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports,
});

/** Absolute path of the active log directory (or null if file logging is off). */
export const logDir = fileLoggingEnabled ? LOG_DIR : null;
