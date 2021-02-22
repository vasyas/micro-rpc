import Koa from "koa"
import {MsConfig} from "./config"
import {log} from "./logger"
import {MsProps} from "./props"
import {bodyParser} from "./serverUtils"
import {createServiceContext} from "./serviceContext"

export function getDefaultProps<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  props: MsProps<Config, Itf, Impl>
): Partial<MsProps<Config, Itf, Impl>> {
  return {
    rpcServerOptions: {},
    config: {},
    websocketServers: {},
    metricNamespace: "Service",
    paths: {
      doc: `/api/${props.role}/docs/`,
      http: `/api/${props.role}`,
      ws: `/rpc/${props.role}`,
    },
    createKoaApp,
    createServiceContext,
    getHttpRemoteId,
  }
}

export function createKoaApp() {
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

export function getHttpRemoteId(ctx: Koa.Request) {
  let token = ctx.headers["authorization"]
  token = token ? token.replace("Bearer ", "") : null
  return token || "anon"
}
