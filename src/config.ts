import * as fs from "fs"
import {ConnectionOptions, NatsConnection} from "nats"
import {DbConfig} from "./db"

export interface MsConfig {
  serverId: string
  nats?: ConnectionOptions
  ports: {
    http: number
  } & Record<string, number>
  db?: DbConfig
  aws?: {
    region: string
    credentials: {
      accessKeyId: string
      secretAccessKey: string
    }
  }
}

export function loadConfig(): any {
  const configJson = process.env.CONFIG || "local-config.json"

  if (configJson) {
    console.log(`Using ${configJson}`)

    const data = fs.readFileSync(configJson, "utf8")
    const config = JSON.parse(data.toString())
    return config
  }

  return {}
}
