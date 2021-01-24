import {JSONCodec, NatsConnection} from "nats"
import PQueue from "p-queue"
import {log} from "./logger"

export class DataSubject<DataType extends Record<string, unknown>> {
  constructor(private subjectTemplate: string) {}

  protected setNatsConnection(natsConnection: NatsConnection) {
    this.natsConnection = natsConnection
  }

  private renderSubject(params: Partial<DataType>): string {
    const tokens = this.subjectTemplate.split(".")

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].startsWith("$")) {
        const key = tokens[i].substring(1)
        tokens[i] = params[key] == null ? "*" : "" + params[key]
      }
    }

    return tokens.join(".")
  }

  private parseSubject(subject: string): Partial<DataType> {
    const tokens = this.subjectTemplate.split(".")
    const subjectParts = subject.split(".")

    const r /*: Partial<DataType> */ = {} // guarantied by user, who is constructing DataSubject with correct args

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].startsWith("$")) {
        const key = tokens[i].substring(1)

        r[key] = subjectParts?.[i]
      }
    }

    return r
  }

  publish(message: DataType) {
    this.natsConnection.publish(this.renderSubject(message), codec.encode(message))
  }

  subscribe(
    handle: (message: DataType, ctx: NatsContext<Partial<DataType>>) => Promise<void>,
    options: Partial<SubscriptionOptions> = {}
  ): Subscription {
    options = {
      ...defaultSubscriptionOptions,
      ...options,
    }

    const subscription = this.natsConnection.subscribe(this.renderSubject({}))

    const queue = new PQueue({concurrency: options.concurrency})

    ;(async () => {
      for await (const m of subscription) {
        const data: DataType = codec.decode(m.data) as any
        const ctx: NatsContext<Partial<DataType>> = {
          subject: m.subject,
          params: this.parseSubject(m.subject),
        }

        await queue.add(() => handle(data, ctx))
      }
    })()

    workerQueues.push(queue) // TODO remove on onsubscribe & drain

    return {}
  }

  private natsConnection: NatsConnection
}

export type NatsContext<ParamsType> = {
  subject: string
  params: ParamsType
}

export type SubscriptionOptions = {
  concurrency: number
}

const defaultSubscriptionOptions = {
  concurrency: 1,
}

export type Subscription = {}

const codec = JSONCodec()

export function connectSubjects(root: Record<string, any>, natsConnection: NatsConnection) {
  const keys = getObjectProps(root)

  keys.forEach((key) => {
    const item = root[key]

    if (item && typeof item == "object") {
      if ("setNatsConnection" in item) {
        item.setNatsConnection(natsConnection)
      } else {
        connectSubjects(item, natsConnection)
      }
    }
  })
}

function getObjectProps(obj) {
  let props = []

  while (!!obj && obj != Object.prototype) {
    props = props.concat(Object.getOwnPropertyNames(obj))
    obj = Object.getPrototypeOf(obj)
  }

  return Array.from(new Set(props)).filter((p) => p != "constructor")
}

const workerQueues: PQueue[] = []

export async function drainWorkerQueues() {
  log.info("Draining worker queues")

  await Promise.all(workerQueues.map((q) => q.onIdle()))
}
