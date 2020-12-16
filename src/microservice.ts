import {composeMiddleware, createRpcServer, setLogger} from "@push-rpc/core"
import {createKoaHttpMiddleware} from "@push-rpc/http"
import {createWebsocketServer} from "@push-rpc/websocket"
import Koa from "koa"
import koaMount from "koa-mount"
import * as UUID from "uuid-js"
import {loadConfig, MsConfig} from "./config"
import {initDatabase, transactional} from "./db"
import {documentation} from "./documentApi"
import {connectLoggingService, log, LogServices} from "./logger"
import {initMonitoring, meterRequest, metric} from "./monitoring"
import {PingServiceImpl} from "./PingServiceImpl"
import {defaultProps, MsProps} from "./props"
import {bodyParser, websocketRouter} from "./serverUtils"
import {createServiceContext} from "./serviceContext"

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
    ...defaultProps,
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
    debug: () => {
    }, // don't need debug logs from push-rpc
    // debug: (...params) => log.debug(...params),
  })

  const config: Config = {
    ...(props.config),
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
    ? `, docs at http://localhost:${config.ports.http}/api/${props.name}/docs/`
    : ""

  log.info(
    `Server '${props.name}' started at http://localhost:${config.ports.http}/api/${props.name}, ws://localhost:${config.ports.http}/rpc/${props.name}${doc}`
  )

  return {config, services, koaApp, logServices}
}

function publishApi(props, services, config) {
  const servicesMiddleware = [meterRequest("rpc.call")]
  if (config.db) servicesMiddleware.push(transactional)

  const rpcOptions = {
    localMiddleware: composeMiddleware(...servicesMiddleware),
    listeners: {
      connected: (remoteId, connections) => {
        metric("rpc.connections", connections, "Count")
      },
      disconnected: (remoteId, connections) => {
        metric("rpc.connections", connections, "Count")
      },
      messageIn: (remoteId, data) => {
      },
      messageOut: (remoteId, data) => {
      },
      subscribed: (subscriptions) => {
        metric("rpc.subscriptions", subscriptions, "Count")
      },
      unsubscribed: (subscriptions) => {
        metric("rpc.subscriptions", subscriptions, "Count")
      },
    },
    ...(config.rpcServerOptions),
  }

  // publish via HTTP
  const app = configureKoaApp()

  const {
    onError,
    onConnection,
    middleware: koaMiddleware,
  } = createKoaHttpMiddleware((ctx: Koa.Context) => getHttpRemoteId(ctx.request))

  if (props.documentApi) {
    app.use(koaMount(`/api/${props.name}/docs/`, documentation(props, config)))
  }

  app.use(koaMount(`/api/${props.name}`, koaMiddleware))

  const httpSocketServer = {
    onError,
    onConnection,
    close(cb) {
      server.close(cb)
    },
  }

  createRpcServer(services, httpSocketServer, {
    ...rpcOptions,
    createConnectionContext: createHttpConnectionContext,
    pingSendTimeout: null,
  })

  const server = app.listen(config.ports.http)

  // publish via WS
  const {wss: websocketServer, ...wsSocketServer} = createWebsocketServer()
  createRpcServer(services, wsSocketServer, {
    ...rpcOptions,
    createConnectionContext: createWebsocketConnectionContext,
  })

  websocketRouter(server, {
    [`/rpc/${props.name}`]: websocketServer,
    ...(props.websocketServers),
  })

  return app
}

function validateConfig(config: MsConfig) {
  if (!config.ports?.http) {
    throw new Error("Required config property 'http.port' is missing")
  }

  if (!config.serverId) {
    throw new Error("Required config property 'serverId' is missing")
  }
}

function configureKoaApp() {
  const app = new Koa()
  app.proxy = true
  app.use(bodyParser)

  app.use(async (ctx, next) => {
    try {
      return await next()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "" + e

      ctx.status = 500
      ctx.body = msg

      log.error(`While ${ctx.request.path}:`, e)
    }
  })

  return app
}

function getHttpRemoteId(ctx: Koa.Request) {
  let token = ctx.headers["authorization"]
  token = token ? token.replace("Bearer ", "") : null
  return token || "anon"
}

async function createHttpConnectionContext(socket, req) {
  return {
    ...(await createServiceContext(socket, req)),
    remoteId: getHttpRemoteId(req),
  }
}

async function createWebsocketConnectionContext(socket, req) {
  return {
    ...(await createServiceContext(socket, req)),
    remoteId: UUID.create().toString(),
  }
}
