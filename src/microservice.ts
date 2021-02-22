import {
  composeMiddleware,
  createRpcServer,
  Middleware,
  RpcServerOptions,
  setLogger,
  Socket,
} from "@push-rpc/core"
import {createKoaHttpMiddleware} from "@push-rpc/http"
import {createWebsocketServer} from "@push-rpc/websocket"
import Koa from "koa"
import koaMount from "koa-mount"
import loglevel from "loglevel"
import {connect, NatsConnection} from "nats"
import {drainWorkerQueues, setWorkerQueuesListener} from "typed-subjects"
import * as UUID from "uuid-js"
import {loadConfig, MsConfig} from "./config"
import {dumpPoolStats, initDatabase, transactional} from "./db"
import {getDefaultProps} from "./defaults"
import {documentation} from "./documentApi"
import {connectLoggingService, log} from "./logger"
import {initMonitoring, meterRequest, metric} from "./monitoring"
import {PingServiceImpl} from "./PingServiceImpl"
import {MsProps} from "./props"
import {websocketRouter} from "./serverUtils"

export type MsSetup<Config extends MsConfig, Impl> = {
  config: Config
  natsConnection: NatsConnection
  services?: Impl
  koaApp?: Koa
}

export async function startMicroService<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  providedProps: MsProps<Config, Itf, Impl>
): Promise<MsSetup<Config, Impl>> {
  console.log(`Starting server '${providedProps.role}'`)

  const props = {
    ...getDefaultProps(providedProps),
    ...providedProps,
  }

  setLogger({
    info: (...params) => log.info(...params),
    error: (...params) => log.error(...params),
    warn: (...params) => log.warn(...params),
    debug: () => {},
    // don't need debug logs from push-rpc
    // debug: (...params) => log.debug(...params),
  })

  configureLoglevel()

  const config: Config = {
    ...props.config,
    ...(await loadConfig()),
  }

  validateConfig(providedProps, config)

  const natsConnection = await connect(
    config.nats ? {...config.nats, name: config.serverId} : {name: config.serverId}
  )
  await connectLoggingService(config.serverId, natsConnection)

  log.info("Connected to NATS, Client ID " + natsConnection.info?.client_id)

  // setWorkerQueuesListener((size) => metric("workerQueues", size, "Count"))

  process.on("SIGINT", async () => {
    log.info("Got SIGINT, doing graceful shutdown")

    log.info("Shutdown: drain message queue")
    await natsConnection.drain()

    await drainWorkerQueues()

    process.exit(0)
  })

  if (config.db) {
    await initDatabase(config.db, props.traceDbConnections)

    if (props.traceDbConnections) {
      process.on("SIGUSR2", dumpPoolStats)
    }
  }

  initMonitoring(config.aws, config.serverId, props.metricNamespace)

  if (props.services) {
    const services = {
      ping: new PingServiceImpl(),
      ...props.services,
    }

    const koaApp = await publishApi(props, services, config)

    const doc = props.documentApi
      ? `, docs at http://localhost:${config.ports.http}${props.paths.doc}`
      : ""

    log.info(
      `Server '${props.role}' started at http://localhost:${config.ports.http}${props.paths.http}, ws://localhost:${config.ports.http}${props.paths.ws}${doc}`
    )

    return {config, services, koaApp, natsConnection}
  } else {
    log.info(`Server '${props.role}' started`)

    return {config, natsConnection}
  }
}

async function publishApi<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  props: MsProps<Config, Itf, Impl>,
  services: Impl,
  config: Config
) {
  const rpcServerOptions: Partial<RpcServerOptions> =
    typeof props.rpcServerOptions == "function"
      ? await props.rpcServerOptions(config)
      : props.rpcServerOptions

  const servicesMiddleware: Middleware[] = [meterRequest("rpc.call")]
  if (config.db) servicesMiddleware.push(transactional)
  if (rpcServerOptions.localMiddleware) servicesMiddleware.push(rpcServerOptions.localMiddleware)

  const rpcOptions = {
    ...rpcServerOptions,
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
      ? await props.websocketServers(websocketServer)
      : props.websocketServers),
  })

  return app
}

function validateConfig(props, config: MsConfig) {
  if (!!props.services && !config.ports?.http) {
    throw new Error("Config property 'ports.http' is required to publish Push-RPC services")
  }

  ;[
    "documentApi",
    "websocketServers",
    "createKoaApp",
    "createServiceContext",
    "getHttpRemoteId",
  ].forEach((prop) => {
    if (!props.services && props[prop]) {
      throw new Error(prop + "property can only be specified when publishing services")
    }
  })

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

function configureLoglevel() {
  loglevel.methodFactory = (methodName, logLevel, loggerName) => {
    return (...args) => {
      log[methodName](...args)
    }
  }

  loglevel.enableAll()
}
