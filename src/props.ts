import Koa from "koa"
import {RpcServerOptions, Socket} from "@push-rpc/core"
import WebSocket from "ws"
import {MsConfig} from "./config"
import {ServiceContext} from "./serviceContext"

type WebSocketRoutes = {
  [path: string]: WebSocket.Server
}

export type MsProps<Config extends MsConfig, Itf, Impl extends Itf> = {
  role: string
  services?: Impl
  rpcServerOptions?:
    | Partial<RpcServerOptions>
    | ((config: Config) => Promise<Partial<RpcServerOptions>>)
  config?: Partial<Config>
  websocketServers?: WebSocketRoutes | ((rpc: WebSocket.Server) => Promise<WebSocketRoutes>)
  documentApi?: {
    baseDir?: string // default to .
    tsConfig: string // path to tsconfig.json
    skip?: string // prefix of types to skip
    entryFile: string // entry TS module
    entryType: string // entry type, should be exported from entry file
    baseUrl?: string // where services would be deployed
  }
  paths?: {
    doc: string
    http: string
    ws: string
  }
  metricNamespace?: string
  traceDbConnections?: boolean

  createKoaApp?(config: Config): Koa
  createServiceContext?(socket: Socket, req: Koa.Request): Promise<Omit<ServiceContext, "remoteId">>
  getHttpRemoteId?(req: Koa.Request): string

  shutdown?: () => Promise<void>
}
