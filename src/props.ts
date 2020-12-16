import Koa from "koa"
import {RpcServerOptions, Socket} from "@push-rpc/core"
import WebSocket from "ws"
import {MsConfig} from "./config"
import {ServiceContext} from "./serviceContext"

export type MsProps<Config extends MsConfig, Itf, Impl extends Itf> = {
  name: string
  services: Impl
  rpcServerOptions?: Partial<RpcServerOptions>
  config?: Partial<Config>
  websocketServers?: {
    [path: string]: WebSocket.Server
  }
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

  createKoaApp?(): Koa
  createServiceContext?(socket: Socket, req: Koa.Request): Promise<ServiceContext>
  getHttpRemoteId?(req: Koa.Request): string
}
