import {JSONCodec, NatsConnection} from "nats"

export enum LogSeverity {
  info = "info",
  error = "error",
  warn = "warn",
  debug = "debug",
}

export type GeneralLog = {nodeId: string; severity: LogSeverity; message: string; details?: any}

export const SUBJECT_GENERAL_LOG = "log.general"

export interface Logger {
  info(message: string, details?: any): void
  error(message: string, details?: any): void
  warn(message: string, details?: any): void
  debug(message: string, details?: any): void
}

// local logger by default
export let log: Logger = {
  info: (...params) => console.log("[info] " + params[0], ...params.slice(1)),
  error: (...params) => console.log("[error] " + params[0], ...params.slice(1)),
  warn: (...params) => console.log("[warn] " + params[0], ...params.slice(1)),
  debug: (...params) => console.log("[debug] " + params[0], ...params.slice(1)),
}

export async function connectLoggingService(nodeId, natsConnection: NatsConnection): Promise<void> {
  const codec = JSONCodec()

  log.debug(`Using distributed logs`)
  ;[LogSeverity.info, LogSeverity.error, LogSeverity.warn, LogSeverity.debug].forEach(
    (severity) => {
      log[severity] = (message, details) => {
        const body: GeneralLog = {nodeId, severity, message, details}
        natsConnection.publish(SUBJECT_GENERAL_LOG, codec.encode(body))
      }
    }
  )
}
