import Application from "koa"
import {MsConfig} from "./config"
import {MsProps} from "./props"

let openApi

try {
  openApi = require("@push-rpc/openapi")
} catch (e) {}

export function documentation<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  props: MsProps<Config, Itf, Impl>,
  config: Config
): Application {
  const app = new Application()

  app.use(async (ctx, next) => {
    if (ctx.request.path == "/" || ctx.request.path == "index.html") {
      ctx.body = index(props.name)
      ctx.type = "text/html"
      return
    }

    if (ctx.request.path == "api.yml") {
      ctx.body = await createApiYaml(props, config)
      ctx.type = "text/yaml"
      return
    }
  })

  return app
}

async function createApiYaml<Config extends MsConfig, Itf, Impl extends Itf = Itf>(
  props: MsProps<Config, Itf, Impl>,
  config: Config
): Promise<string> {
  if (!openApi) {
    throw new Error("Please install @push-rpc/openapi")
  }

  const baseUrl = props.documentApi.baseUrl || `http://localhost:${config.ports.http}`

  const template = {
    openapi: "3.0.0",
    info: {
      title: `${props.name} service`,
      version: "1.0.0",
    },
    servers: [
      {
        url: `${baseUrl}/api/${props.name}`,
        description: "Server",
      },
    ],
  }

  return openApi.generateYml({
    ...props.documentApi,
    template,
    baseDir: props.documentApi.baseDir || ".",
  })
}

const index = (serverName) => `
<!DOCTYPE html>
<html>
  <head>
    <title>${serverName} service</title>

    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link
      href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700"
      rel="stylesheet"
    />

    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <redoc spec-url="./api.yml"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
  </body>
</html>
`
