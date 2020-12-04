import {RpcServerOptions} from "@push-rpc/core"
import WebSocket from "ws"
import {MsConfig} from "./config"

export type MsProps<Config extends MsConfig, Itf, Impl extends Itf> = {
  name: string
  services?: Impl
  rpcServerOptions?: Partial<RpcServerOptions>
  config?: Config
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
  metricNamespace?: string
}
