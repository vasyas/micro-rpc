import * as url from "url"
import {log} from "./logger"

const raw = require("raw-body")
const inflate = require("inflation")

export async function bodyParser(ctx, next) {
  if (ctx.request.is("json")) ctx.request.body = await parseJsonBody(ctx.req)

  if (ctx.request.is("application/x-www-form-urlencoded"))
    ctx.request.body = await parseFormBody(ctx.req)

  if (ctx.request.is("application/soap+xml")) {
    ctx.request.body = await parseTextBody(ctx.req)

    // make request re-readable for strong-soap
    mockRequest(ctx.req, ctx.request.body)
  }

  await next()
}

function mockRequest(req, body) {
  req.on = (event, handler) => {
    if (event == "data") handler(body)
    else if (event == "end") handler()
    else {
      log.error(`Unknown event ${event}`, new Error())
    }
  }
}

async function parseJsonBody(req) {
  return parseTextBody(req).then((text) => JSON.parse(text /*, dateReviver*/))
}

async function parseFormBody(req) {
  const text = await parseTextBody(req)

  const r = {}

  function decode(s) {
    return decodeURIComponent(s.replace(/\+/g, " "))
  }

  text.split("&").forEach((v) => {
    const [key, value] = v.split("=")

    r[decode(key)] = decode(value)
  })

  return r
}

async function parseTextBody(req) {
  const opts = {
    encoding: "utf8",
    limit: "1mb",
  }

  const reqEncoding = req.headers["content-encoding"] || "identity"
  const length = req.headers["content-length"]
  if (length && reqEncoding === "identity") opts["length"] = ~~length

  return Promise.resolve().then(() => raw(inflate(req), opts))
}

export function websocketRouter(httpServer, routes) {
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = url.parse(request.url).pathname

    const serverKey = Object.keys(routes).find((key) => pathname.indexOf(key) == 0)

    if (!serverKey) {
      socket.destroy()
    } else {
      const server = routes[serverKey]

      server.handleUpgrade(request, socket, head, (ws) => {
        server.emit("connection", ws, request)
      })
    }
  })
}
