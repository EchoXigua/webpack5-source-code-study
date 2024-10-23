const schema = require("./options.json");

class Server {
  static get schema() {
    return schema;
  }
}

module.exports = Server;
