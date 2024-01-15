import appRoot from "app-root-path";
import { createLogger, format, transports } from "winston";

const LOG_PATH =
  process.env.LOG_PATH ?? `${appRoot}/logs/trackdechets-search.log`;

/**
 * Set process.env.FORCE_LOGGER_CONSOLE to switch to Console instead of log file
 */

// Avoid using undefined console.log() in jest context
const LOG_TO_CONSOLE =
  process.env.FORCE_LOGGER_CONSOLE === "true" &&
  process.env.JEST_WORKER_ID === undefined;
// use http transport when datadog agent installation is impossible (eg. one-off container)
const LOG_TO_HTTP =
  process.env.LOG_TO_HTTP === "true" &&
  process.env.JEST_WORKER_ID === undefined;

const logFormat = format.combine(
  format.label({ label: "trackdechets-sirene-search" }),
  format.timestamp({
    format: "HH-MM:ss YYYY-MM-DD"
  }),
  format.prettyPrint(),
  format.colorize(),
  format.align(),
  format.printf(info => {
    return `[${info.timestamp}] [${info.label}]@level@[${info.level}]: ${info.message}`;
  })
);

const logger_transports_fallbacks = [
  LOG_TO_CONSOLE
    ? new transports.Console({
        format: logFormat
      })
    : LOG_TO_HTTP
    ? new transports.Http({
        host: "http-intake.logs.datadoghq.com",
        path: `/api/v2/logs?dd-api-key=${process.env.DD_API_KEY}&ddsource=${
          process.env.DD_APP_SOURCE || "airflow"
        }&service=${process.env.DD_APP_NAME || "airflow"}`,
        ssl: true
      })
    : new transports.File({ filename: LOG_PATH })
];

const logger = createLogger({
  level: "info",
  exitOnError: false,
  format: format.combine(
    format.errors({ stack: true }),
    format.metadata(),
    format.json()
  ),
  transports: logger_transports_fallbacks,
  // capture exceptions, also for datadog to report it
  exceptionHandlers: logger_transports_fallbacks
});

export { logger };
