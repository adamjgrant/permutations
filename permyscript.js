const Permute = require("./permute");

class PermyScript {
  constructor(string) {
      this.string = string;
      this.tree_object = {main: []}
      this.last_unique_branch_name = "0"
  }

  get unique_branch_name() {
    this.last_unique_branch_name = String(parseInt(this.last_unique_branch_name) + 1);
    return this.last_unique_branch_name;
  }

  get break_into_parts() {
      const array = []
      this.string.split("").reduce((previous, char) => {
          if (char.match(/\(/)) {
              array.push(previous);
              return char;
          }
          else if (char.match(/\)/)) {
              array.push(previous + char);
              return "";
          }
          else {
              return previous + char;
          }
      }, "");

      this.tree_object.main = array;

      return this;
  }

  get convert_parens() {
    this.tree_object.main = this.tree_object.main.map(part => {
        // const part_as_parens = new Part(part);
        // return part_as_parens.is_directive ? part_as_parens : part;
        return new Part(part);
    });

    return this;
  }

  get delegate_to_branches() {
      console.log(this.tree_object)
  }

  get compile() {
    this.break_into_parts
        .convert_parens
        .delegate_to_branches;
  }
}

class Part {
  constructor(string) {
    this.string = string;
  }

  get is_directive() {
      return this.string.substr(0, 1) === "(" && this.string.substr(this.substr.length - 1, 1) === ")"
  }

  get branch() {
    return this.string.replace(/[()]/g, "")
                      .split("|")
  }
}

module.exports = PermyScript