import {enableTrace, Sql, SqlBuilder} from "interpolated-sql"
import {log} from "./logger"
import * as monitoring from "./monitoring"

const mysql = require("mysql2/promise")

let pool

export async function initDatabase(config: DbConfig, trace = false) {
  enableTrace(trace)

  pool = await mysql.createPool({...config, decimalNumbers: true, multipleStatements: true})

  // setup monitoring
  const impl = pool.pool

  impl.on("connection", (connection) => {
    // bind to connection
    sendPoolMetric()
  })

  await exec`select 1`.first()

  impl.on("enqueue", sendPoolMetric)
}

// after this timeout transaction will be returned back to the pool
const TRANSACTION_TIMEOUT = 15 * 1000

export async function transactional(ctx, next, params = undefined) {
  let connection,
    inTransaction = false

  let transactionTimer

  try {
    ctx.sql = (parts, ...params) => {
      return new Sql(parts, params, async () => {
        if (!connection) {
          connection = await getConnection()

          if (ctx.transactional) {
            await connection.query("START TRANSACTION")
            inTransaction = true
          }

          transactionTimer = setTimeout(() => {
            if (connection) {
              log.error(`Transaction timed out`, ctx)

              try {
                connection.query("ROLLBACK")
              } catch (e) {
                log.error(`Unable to rollback timed out transaction`)
              }

              releaseConnection(connection)
            }
          }, TRANSACTION_TIMEOUT)
        }

        return connection
      })
    }

    const r = await next(params)

    if (connection && inTransaction) {
      await connection.query("COMMIT")
    }

    return r
  } catch (e) {
    if (connection && inTransaction) {
      await connection.query("ROLLBACK")
    }

    throw e
  } finally {
    if (connection) {
      if (transactionTimer) {
        clearTimeout(transactionTimer)
      }

      releaseConnection(connection)
    }
  }
}

export function sql(parts, ...params) {
  return new Sql(parts, params)
}

export function execute(parts, ...params) {
  return exec(parts, ...params)
}

export function exec(parts, ...params) {
  const singleExecuteConnectionSupplier = async () => {
    let connection = await getConnection()
    ;["execute", "query"].forEach((method) => {
      const impl = connection[method]

      connection[method] = async (...args) => {
        try {
          const r = await impl.call(connection, ...args)
          return r
        } finally {
          releaseConnection(connection)
        }
      }
    })

    return connection
  }

  return new Sql(parts, params, singleExecuteConnectionSupplier)
}

function sendPoolMetric() {
  const impl = pool.pool

  const total = impl._allConnections.length
  const free = impl._freeConnections.length
  const used = total - free

  const waiting = impl._connectionQueue.length

  monitoring.metric("db.pool.total", total, "Count")
  monitoring.metric("db.pool.used", used, "Count")
  monitoring.metric("db.pool.waiting", waiting, "Count")
}

async function getConnection() {
  return pool.getConnection()
}

function releaseConnection(connection) {
  // node-mysql2 doesn't provide a way to listen to connection release: https://github.com/sidorares/node-mysql2/issues/586
  // call hook manually
  connection.release()
  sendPoolMetric()
}

export interface DatabaseContext {
  sql: SqlBuilder
}

export interface DbConfig {
  host: string
  user: string
  password: string
  database: string
  port?: number
}

export function stopDb() {
  pool && pool.end()
  pool = null
}
