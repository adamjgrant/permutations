class Tree {
  constructor(object) {
    this.object = object;
  }

  get permutate() {
    return this.translate_main
  }

  // Scan through the object and make it a regular ol nested array. No nested objects
  get translate_main() {
    return new Branch(this, this.object.main).translate_object;
  }
}

class Branch {
  constructor(tree, object) {
    this.tree = tree;
    this.object = object;
  }

  get translate_object() {
    return this.object.map(_leaf => {
      const leaf = new Leaf(_leaf);
      if (leaf.is_branch_reference) {
        return this.translate_branch_reference(leaf);
      }
      else { return leaf.node; }
    });
  }

  translate_branch_reference(leaf) {
    const branch_object = this.tree.object[leaf.node.branch];

    const branch = new Branch(this.tree, branch_object);
    return branch.translate_object;
  }
}

class Leaf {
  constructor(node) {
    this.node = node;
  }

  get is_branch_reference() {
    return (typeof(this.node) === "object" && this.node["branch"] !== undefined);
  }
}

module.exports = Tree;