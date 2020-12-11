class PermyScript {
  constructor(string) {
      this.string = string;
  }

  get extract_to_parens() {
    return this.string.replace(/(\(.*\))/,
        (match, p1) => new PermyScriptParens(p1)
    )
  }

  get compile() {

  }
}

class PermyScriptParens {
  constructor(string) {
    this.string = string;
  }
}

module.exports = PermyScript