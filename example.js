import {startMicroService} from "./src"

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
