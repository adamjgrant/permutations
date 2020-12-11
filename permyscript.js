class PermyScript {
  constructor(string) {
      this.string = string;
  }

  get compile() {
    return this.encapsulate
        .split
        .nest
        .set_to_main
        .as_object
  }

  get set_to_main() {
    return new PermyScript(`{ "main": ${this.string} }`)
  }

  get split() {
    const new_string = this.string.replaceAll("|", "\",\"");
    return new PermyScript(new_string);
  }

  get nest() {
    let new_string = this.string;
    const regex = /\).+]+/g;
    for (let x = 0; x < (this.string.match(regex) || []).length; x++) {
      new_string = `${new_string}]`;
    }
    for (let x = 0; x < (this.string.match(/\(/g) || []).length; x++) {
      new_string = `${new_string}]`;
    }

    // return new PermyScript(new_string);

    new_string = new_string.replaceAll("(", "\", [\"")

    const replacer = (match) => match.replace(")", "");
    new_string = new_string.replace(/(\))"]*$/g, replacer);
    new_string = new_string.replace(/\)/g, "\", [\"");
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