import {startMicroService} from "./src"

class HelloServiceImpl {
  async getHello() {
    return "hello"
  }
}

startMicroService({
  role: "helloService",
  services: {
    hello: new HelloServiceImpl(),
  },
})
