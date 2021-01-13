import {composeMiddleware, createRpcServer, Middleware, setLogger, Socket} from "@push-rpc/core"
import {createKoaHttpMiddleware} from "@push-rpc/http"
import {createWebsocketServer} from "@push-rpc/websocket"
import Koa from "koa"
import koaMount from "koa-mount"
import * as UUID from "uuid-js"
import {loadConfig, MsConfig} from "./config"
import {initDatabase, transactional} from "./db"
import {getDefaultProps} from "./defaults"
import {documentation} from "./documentApi"
import {connectLoggingService, log, LogServices} from "./logger"
import {initMonitoring, meterRequest, metric} from "./monitoring"
import {PingServiceImpl} from "./PingServiceImpl"
import {MsProps} from "./props"
import {websocketRouter} from "./serverUtils"

export type MsSetup<Config extends MsConfig, Impl> = {
  config: Config
  services: Impl
  koaApp: Koa
  logServices: LogServices
}

export async function startMicroService<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  props: MsProps<Config, Itf, Impl>
): Promise<MsSetup<Config, Impl>> {
  console.log(`Starting server '${props.name}'`)

  props = {
    ...getDefaultProps(props),
    ...props,
  }

  const services = {
    ping: new PingServiceImpl(),
    ...props.services,
  }

  setLogger({
    info: (...params) => log.info(...params),
    error: (...params) => log.error(...params),
    warn: (...params) => log.warn(...params),
    debug: () => {},
    // don't need debug logs from push-rpc
    // debug: (...params) => log.debug(...params),
  })

  const config: Config = {
    ...props.config,
    ...(await loadConfig()),
  }

  validateConfig(config)

  const logServices = await connectLoggingService(config.serverId, config.services?.log)

  if (config.db) {
    await initDatabase(config.db)
  }

  initMonitoring(config.aws, config.serverId, props.metricNamespace)

  const koaApp = await publishApi(props, services, config)

  const doc = props.documentApi
    ? `, docs at http://localhost:${config.ports.http}${props.paths.doc}`
    : ""

  log.info(
    `Server '${props.name}' started at http://localhost:${config.ports.http}${props.paths.http}, ws://localhost:${config.ports.http}${props.paths.ws}${doc}`
  )

  return {config, services, koaApp, logServices}
}

function publishApi<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  props: MsProps<Config, Itf, Impl>,
  services: Impl,
  config: Config
) {
  const servicesMiddleware: Middleware[] = [meterRequest("rpc.call")]
  if (config.db) servicesMiddleware.push(transactional)
  if (props.rpcServerOptions.localMiddleware)
    servicesMiddleware.push(props.rpcServerOptions.localMiddleware)

  const rpcOptions = {
    ...props.rpcServerOptions,
    localMiddleware: composeMiddleware(...servicesMiddleware),
    listeners: {
      connected: (remoteId, connections) => {
        metric("rpc.connections", connections, "Count")
      },
      disconnected: (remoteId, connections) => {
        metric("rpc.connections", connections, "Count")
      },
      messageIn: (remoteId, data) => {},
      messageOut: (remoteId, data) => {},
      subscribed: (subscriptions) => {
        metric("rpc.subscriptions", subscriptions, "Count")
      },
      unsubscribed: (subscriptions) => {
        metric("rpc.subscriptions", subscriptions, "Count")
      },
    },
  }

  // publish via HTTP
  const app = props.createKoaApp(config)

  const {
    onError,
    onConnection,
    middleware: koaMiddleware,
  } = createKoaHttpMiddleware((ctx: Koa.Context) => props.getHttpRemoteId(ctx.request))

  if (props.documentApi) {
    app.use(koaMount(props.paths.doc, documentation(props, config)))
  }

  app.use(koaMount(props.paths.http, koaMiddleware))

  const httpSocketServer = {
    onError,
    onConnection,
    close(cb) {
      server.close(cb)
    },
  }

  createRpcServer(services, httpSocketServer, {
    ...rpcOptions,
    createConnectionContext: (socket, req) => createHttpConnectionContext(socket, req, props),
    pingSendTimeout: null,
  })

  const server = app.listen(config.ports.http)

  // publish via WS
  const {wss: websocketServer, ...wsSocketServer} = createWebsocketServer()
  createRpcServer(services, wsSocketServer, {
    ...rpcOptions,
    createConnectionContext: (socket, req) => createWebsocketConnectionContext(socket, req, props),
  })

  websocketRouter(server, {
    [props.paths.ws]: websocketServer,
    ...(typeof props.websocketServers == "function"
      ? props.websocketServers(websocketServer)
      : props.websocketServers),
  })

  return app
}

function validateConfig(config: MsConfig) {
  if (!config.ports?.http) {
    throw new Error("Required config property 'ports.http' is missing")
  }

  if (!config.serverId) {
    throw new Error("Required config property 'serverId' is missing")
  }
}

async function createHttpConnectionContext<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  socket: Socket,
  req: Koa.Request,
  props: MsProps<Config, Itf, Impl>
) {
  return {
    ...(await props.createServiceContext(socket, req)),
    remoteId: props.getHttpRemoteId(req),
  }
}

async function createWebsocketConnectionContext<
  Config extends MsConfig,
  Itf,
  Impl extends Itf = Itf
>(socket: Socket, req: Koa.Request, props: MsProps<Config, Itf, Impl>) {
  return {
    ...(await props.createServiceContext(socket, req)),
    remoteId: UUID.create().toString(),
  }
}
