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

export async function closeDatabase() {
  await pool.end()
}

// after this timeout transaction will be returned back to the pool
const TRANSACTION_TIMEOUT = 15 * 1000

export async function transactional(ctx, next, params = undefined) {
  let connection,
    inTransaction = false

  let transactionTimer

  function closeConnection() {
    if (transactionTimer) {
      clearTimeout(transactionTimer)
    }

    releaseConnection(connection)
    connection = null
  }

  async function openConnection() {
    if (connection) {
      closeConnection()
    }

    connection = await getConnection()

    transactionTimer = setTimeout(async () => {
      if (connection) {
        log.error(`Transaction timed out`, ctx)

        if (inTransaction) {
          try {
            await ctx.rollback()
          } catch (e) {
            log.error(`Unable to rollback timed out transaction`)
          }
        } else {
          closeConnection()
        }
      }
    }, TRANSACTION_TIMEOUT)
  }

  try {
    ctx.begin = async () => {
      await openConnection()

      await connection.query("START TRANSACTION")
      inTransaction = true
    }

    ctx.commit = async () => {
      if (connection) {
        await connection.query("COMMIT")
        inTransaction = false

        closeConnection()
      }
    }

    ctx.rollback = async () => {
      if (connection) {
        await connection.query("ROLLBACK")
        inTransaction = false

        closeConnection()
      }
    }

    ctx.sql = (parts, ...params) => {
      return new Sql(parts, params, async () => {
        if (!connection) {
          if (ctx.transactional) {
            await ctx.begin()
          } else {
            await openConnection()
          }
        }

        return connection
      })
    }

    const r = await next(params)

    if (inTransaction) {
      await ctx.commit()
    }

    return r
  } catch (e) {
    if (inTransaction) {
      await ctx.rollback()
    }

    throw e
  } finally {
    if (connection) {
      closeConnection()
    }
  }
}

export function sql(parts, ...params) {
  return new Sql(parts, params)
}

export function execute(parts, ...params) {
  return exec(parts, ...params)
}

function provider(name) {
  return async function (...args) {
    const connection = await getConnection()

    try {
      return await connection[name](...args)
    } finally {
      releaseConnection(connection)
    }
  }
}

export function exec(parts, ...params) {
  const singleExecuteConnectionSupplier = async () => {
    return {
      execute: provider("execute"),
      query: provider("query"),
    }
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
