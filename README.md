Highly-opinionated framework for quick starting Microservices using Node.JS.

## Supports
- Push-RPC for Websocket/HTML API
- JSON-based config files
- (Optional) MySQL connection
- (Optional) Report common set of metrics to AWS CloudWatch
- (Optional) Common "Ping" to check service availability.
- (Optional) Auto generate OpenAPI documentation

## Use

```
yarn add micro-rpc
```

config.json
```
{
  "serverId": "hello1",
  "ports": {
    "http": 8092
  }
}
```

start.js
```
import {startMicroService} from "micro-rpc"

class HelloServiceImpl {
  async getHello() {
    return "hello"
  }
}

startMicroService({
  name: "helloService",
  services: {
    hello: new HelloServiceImpl(),
  },
})
```

To test it:
```
node ./start.js 
```

And then
```
curl -X POST http://localhost:8092/api/helloService/hello/getHello
```