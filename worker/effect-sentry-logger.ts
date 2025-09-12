import { Logger, LogLevel, type Layer, HashMap } from 'effect';
import { logger as sentryLogger } from '@sentry/cloudflare';

/**
 * Maps Effect log levels to Sentry log levels
 */
function mapLogLevel(effectLevel: LogLevel.LogLevel): 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' {
  switch (effectLevel._tag) {
    case 'Trace':
      return 'trace';
    case 'Debug':
      return 'debug';
    case 'Info':
      return 'info';
    case 'Warning':
      return 'warn';
    case 'Error':
      return 'error';
    case 'Fatal':
      return 'fatal';
    case 'All':
      return 'debug'; // Default to debug for "All"
    case 'None':
      return 'debug'; // Default to debug for "None"
    default:
      return 'info';
  }
}

/**
 * Creates a Sentry logger that sends logs of specified levels to Sentry
 * while still maintaining the original terminal output.
 *
 * @param minLevel - Minimum log level to send to Sentry (defaults to 'Warning')
 * @param keepTerminalOutput - Whether to keep logging to terminal (defaults to true)
 */
export const createSentryLogger = (minLevel: LogLevel.LogLevel = LogLevel.Warning): Logger.Logger<unknown, void> => {
  return Logger.make(({ logLevel, message, cause, annotations }) => {
    // Only send to Sentry if log level meets minimum threshold
    if (LogLevel.greaterThanEqual(logLevel, minLevel)) {
      const sentryLevel = mapLogLevel(logLevel);

      // Prepare extra context for Sentry
      const extra: Record<string, unknown> = {
        'sentry.origin': 'effect.logging',
      };

      // Add annotations
      if (HashMap.size(annotations) > 0) {
        const annotationsObj: Record<string, unknown> = {};
        for (const [key, value] of annotations) {
          annotationsObj[key] = value;
        }
        extra['annotations'] = annotationsObj;
      }

      // Add cause if present
      if (cause._tag !== 'Empty') {
        extra['cause'] = String(cause);
      }

      // Format the message
      let formattedMessage: string;

      if (Array.isArray(message)) {
        // First item is the string message
        formattedMessage = String(message[0] || '');

        // Process remaining items
        for (let i = 1; i < message.length; i++) {
          const arg = message[i];
          if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
            // Merge object properties into extra
            Object.assign(extra, arg);
          } else {
            // Add non-object values under arg_${index} key
            extra[`arg_${i}`] = arg;
          }
        }
      } else {
        formattedMessage = String(message);
      }

      // Send to Sentry with the appropriate method
      switch (sentryLevel) {
        case 'trace':
          sentryLogger.trace(formattedMessage, extra);
          break;
        case 'debug':
          sentryLogger.debug(formattedMessage, extra);
          break;
        case 'info':
          sentryLogger.info(formattedMessage, extra);
          break;
        case 'warn':
          sentryLogger.warn(formattedMessage, extra);
          break;
        case 'error':
          sentryLogger.error(formattedMessage, extra);
          break;
        case 'fatal':
          sentryLogger.fatal(formattedMessage, extra);
          break;
      }
    }
  });
};

/**
 * Creates a layer that adds the Sentry logger to the logging system.
 * This will send warn and error level logs to Sentry while keeping terminal output.
 */
export const SentryLoggerLayer = Logger.add(createSentryLogger());

/**
 * Creates a layer that replaces the default logger with the Sentry logger.
 * Use this if you want only Sentry logging (no terminal output).
 */
export const SentryLoggerReplaceLayer = Logger.replace(Logger.defaultLogger, createSentryLogger(LogLevel.Warning));

/**
 * Creates a layer with custom configuration.
 *
 * @param minLevel - Minimum log level to send to Sentry
 */
export const createSentryLoggerLayer = (minLevel: LogLevel.LogLevel = LogLevel.Warning): Layer.Layer<never> => {
  return Logger.add(createSentryLogger(minLevel));
};
