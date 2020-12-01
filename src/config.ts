import * as fs from "fs"

export interface MsConfig {
  serverId: string
  services?: Record<string, string>
  ports: {
    http: number
  } & Record<string, number>
  db?: {
    host: string
    user: string
    password: string
    database: string
    port?: number
  }
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
