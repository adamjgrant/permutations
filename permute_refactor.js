class Tree {
  constructor(object) {
    this.object = object;
  }

  get permutations() {
    const translated_object = this.translate_main;
    // TODO: Implement
    return []
  }

  // Scan through the object and make it a regular ol nested array. No nested objects
  get translate_main() {
    return new Branch(this, this.object.main).translate_object;
  }
  
  branch(key) {
    return this.object[key] || []
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
    const branch_object = this.tree.branch(leaf.node.branch);

    // Translate the then and append it inside the branch.
    if (leaf.has_then_reference) {
      const then_object = this.translate_then_reference(leaf);
      branch_object.push(then_object);
    }

    const branch = new Branch(this.tree, branch_object);
    return branch.translate_object;
  }
  
  translate_then_reference(leaf) {
    let then_object = leaf.node.then;
    if (!Array.isArray(then_object)) then_object = [then_object];
    return new Branch(this.tree, then_object).translate_object;
  }
}

class Leaf {
  constructor(node) {
    this.node = node;
  }

  get is_branch_reference() {
    return (typeof(this.node) === "object" && this.node["branch"] !== undefined);
  }

  get has_then_reference() {
    return (typeof(this.node) === "object" && this.node["then"] !== undefined);
  }
}

module.exports = Tree;