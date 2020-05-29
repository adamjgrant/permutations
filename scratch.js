const Tree = require("./permute");
const obj = {
  main: [
    "A", [
      "B", "C", [
        "D", "E", [
          "F", "G"
        ]
      ]
    ]
  ]
}
const tree = new Tree(obj, 2);
tree.write_to_mermaid_file('test');