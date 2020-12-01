import {createRpcClient} from "@push-rpc/core"
import {createNodeWebsocket} from "@push-rpc/websocket"

export enum LogSeverity {
  info = "info",
  error = "error",
  warn = "warn",
  debug = "debug",
}

export interface LogService {
  log(req: {nodeId: string, severity: LogSeverity, message: string, details?: any})
}

export interface LogServices {
  log: LogService
}

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

export async function connectLoggingService(nodeId, logServiceAddress): Promise<LogServices> {
  if (!logServiceAddress) {
    log.warn("Log service address is undefined, skipping distributed logs")
    return
  }

  const {remote: logServices} = await createRpcClient<LogServices>(
    1,
    () => createNodeWebsocket(logServiceAddress),
    {
      reconnect: true,
      listeners: {
        connected() {
          log.debug(`Connected to log service at ${logServiceAddress}`)

          Object.assign(log, {
            info(message, details) {
              logServices.log.log({nodeId, severity: LogSeverity.info, message, details})
            },
            error(message, details) {
              logServices.log.log({nodeId, severity: LogSeverity.error, message, details})
            },
            warn(message, details) {
              logServices.log.log({nodeId, severity: LogSeverity.warn, message, details})
            },
            debug(message, details) {
              logServices.log.log({nodeId, severity: LogSeverity.debug, message, details})
            },
          })
        },
        disconnected: () => {},
        subscribed: () => {},
        unsubscribed: () => {},
        messageOut: () => {},
        messageIn: () => {},
      },
    }
  )

  return logServices
}
