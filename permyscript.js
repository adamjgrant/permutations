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

  get extract_to_parens() {
    this.tree_object.main = this.string.replace(/(\(.*\))/,
        (match, p1) => {
          const branch_name             = this.unique_branch_name;
          this.tree_object[branch_name] = new PermyScriptParens(p1).branch;
          return JSON.stringify({ branch: branch_name });
        }
    )
    return this.tree_object.main
  }

  get compile() {
    this.extract_to_parens;
  }
}

class PermyScriptParens {
  constructor(string) {
    this.string = string.replace(/[()]/g, "");
  }

  get branch() {
    console.log(this.string)
    return this.string.split("|")
  }
}

module.exports = PermyScript