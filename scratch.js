const Tree = require("./permute");
const obj = {
  main: [
    "A", [
      "B", "C", [
        "D", "E", [
          "F", "G", [
            "H", "I"
          ]
        ]
      ]
    ]
  ]
}
const tree = new Tree(obj, 3);
tree.write_to_mermaid_file('test');
