class PermyScript {
  constructor(string) {
      this.string = string;
  }

  get compile() {
    return this.encapsulate
        .split
        .nest
        .as_object
  }

  get split() {
    const new_string = this.string.replaceAll("|", "\",\"");
    return new PermyScript(new_string);
  }

  get nest() {
    let new_string = this.string;
    for (let x = 0; x < (this.string.match(/\(/g) || []).length; x++) {
      new_string = `${new_string}]]`;
    }
    new_string = new_string.replaceAll("(", "\", [\"")
    new_string = new_string.replaceAll(")", "\", [\"");
    return new PermyScript(new_string);
  }

  get encapsulate() {
    return new PermyScript(`["${this.string}"]`);
  }

  get as_object() {
    return JSON.parse(this.string);
  }
}

module.exports = PermyScript