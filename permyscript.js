class PermyScript {
  constructor(string) {
      this.string = string;
  }

  get compile() {
    return JSON.parse(this.encapsulate.string);
  }

  get encapsulate() {
    return new PermyScript(`["${this.string}"]`);
  }
}

module.exports = PermyScript