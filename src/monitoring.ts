import {FilteringSubject, QueueStats} from "typed-subjects"
import {log} from "./logger"

const CloudWatchBuddy = require("cloudwatch-buddy")

let cwbMetrics

export type Unit = "Seconds" | "Milliseconds" | "Count"

export function metric(name, value, unit: Unit) {
  if (!cwbMetrics) return

  // console.log("metric", {name, value, unit, nodeId})

  cwbMetrics.stat(name, value, unit, {
    nodeId,
  })
}

export function globalMetric(name, value, unit: Unit) {
  if (!cwbMetrics) return

  cwbMetrics.stat(name, value, unit)
}

let nodeId = null

export function initMonitoring(awsConfig, _nodeId, namespace) {
  nodeId = _nodeId

  if (awsConfig) {
    log.info(`Report stats to AWS CloudWatch, node ${_nodeId}`)
  } else {
    log.info("Stats reporting disabled")
    return
  }

  cwbMetrics = new CloudWatchBuddy(awsConfig).metrics({
    namespace,
    timeout: 60,
  })
}

export function call(duration: number, error: boolean, prefix: string) {
  metric(prefix + ".count", 1, "Count")
  metric(prefix + ".duration", duration, "Milliseconds")
  if (error) metric(prefix + ".error", 1, "Count")
}

export function globalCall(duration: number, error: boolean, prefix: string) {
  globalMetric(prefix + ".count", 1, "Count")
  globalMetric(prefix + ".duration", duration, "Milliseconds")
  if (error) globalMetric(prefix + ".error", 1, "Count")
}

export function monitorWorkerQueue() {
  return {
    queue: (name, stats: QueueStats) => {
      metric(`queue.${name}.queued`, stats.queued, "Count")
      metric(`queue.${name}.running`, stats.running, "Count")
    },
  }
}

export function meterRequest(group, saveMetrics = call) {
  return async (ctx, next, params) => {
    const beginTime = new Date().getTime()
    let error = false

    try {
      return await next(params)
    } catch (e) {
      error = true

      throw e
    } finally {
      const duration = new Date().getTime() - beginTime

      saveMetrics(duration, error, group)
    }
  }
}

export type ServerRps = {serverId: string; rps: number}

export function measureServerRps(
  subject: FilteringSubject<ServerRps>,
  serverId: string,
  period: number = 5 * 1000
) {
  let served = 0

  setInterval(function () {
    try {
      subject.publish({serverId, rps: (served * 1000) / period})
      served = 0
    } catch (e) {
      log.error("Failed to send RPS metrics", e)
    }
  }, period)

  return async (ctx, next, params) => {
    try {
      return await next(params)
    } finally {
      served++
    }
  }
}
