import {RpcConnectionContext, Socket} from "@push-rpc/core"
import {SqlBuilder} from "interpolated-sql"
import * as Koa from "koa"
import * as UUID from "uuid-js"
import {exec} from "./db"

export interface ServiceContext extends RpcConnectionContext {
  // user: User
  sql: SqlBuilder
  commit(): Promise<void>
  rollback(): Promise<void>
}

export async function createServiceContext(
  socket: Socket,
  req: Koa.Request
): Promise<ServiceContext> {
  const token = req.headers["sec-websocket-protocol"]

  return {
    remoteId: UUID.create().toString(),
    // user: getUserFromToken(token),
    sql: exec,
    async commit() {
      await exec`commit`.update()
    },
    async rollback() {
      await exec`rollback`.update()
    },
  }
}
