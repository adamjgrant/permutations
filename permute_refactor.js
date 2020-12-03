class Tree {
  constructor(object) {
    this.object = object;
  }

  get one() {
    return this.translated_branch.one();
  }

  get permutations() {
    return this.translated_branch.terminal_leaves();
  }

  get translated_branch() {
    const translated_object = this.translate_main;
    return new Branch(this, translated_object);
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

  terminal_leaves(prefix = "") {
    if (!this.branches().length) return this.leaves().map(leaf => `${prefix}${leaf}`);
    return this.leaves().reduce((arr, leaf) => {
      return arr.concat(this.branches().reduce((arr, branch) => {
        return arr.concat(new Branch(this.tree, branch).terminal_leaves(`${prefix}${leaf}`));
      }, []));
    }, [])
  }

  one(prefix = "") {
    const new_prefix = `${prefix}${this.leaves(true)}`;
    if (!this.branches().length) return new_prefix;
    return (new Branch(this.tree, this.branches(true))).one(new_prefix);
  }

  leaves(random = false) {
    let _leaves = this.object.filter(item => new Leaf(item).is_terminal);
    const leaves = _leaves.length ? _leaves : [""];
    return random ? leaves[~~(leaves.length * Math.random())] : leaves;
  }

  branches(random = false) {
    const _branches = this.object.filter(item => new Leaf(item).is_branch)
    return random ? _branches[~~(_branches.length * Math.random())] : _branches;
  }

  // Translations
  get translate_object() {
    // Incoming object could be a bare branch reference.
    const object_leaf = new Leaf(this.object)
    if (object_leaf.is_branch_reference) {
      return this.translate_branch_reference(object_leaf);
    }

    // Otherwise, assume this is an array
    return this.object.map(_leaf => {
      const leaf = new Leaf(_leaf);
      if (leaf.is_branch_reference) return this.translate_branch_reference(leaf);
      if (leaf.is_branch) return new Branch(this.tree, leaf.node).translate_object;
      return leaf.node;
    });
  }

  translate_branch_reference(leaf) {
    const branch_object = this.duplicate_branch(this.tree.branch(leaf.node.branch));

    // Translate the then and append it inside the branch.
    if (leaf.has_then_reference) {
      const then_object = this.translate_then_reference(leaf);
      branch_object.push(then_object);
    }

    // Continue recursively
    const branch = new Branch(this.tree, branch_object);
    return branch.translate_object;
  }
  
  translate_then_reference(leaf) {
    let then_object = leaf.node.then;
    if (then_object.constructor.name === "String") then_object = [then_object];
    return new Branch(this.tree, then_object).translate_object;
  }

  duplicate_branch(branch) {
    return JSON.parse(JSON.stringify(branch));
  }
}

class Leaf {
  constructor(node) { this.node = node; }

  get is_branch() { return Array.isArray(this.node); }

  get is_terminal() { return this.node.constructor.name === "String"; }

  get is_branch_reference() {
    return (typeof(this.node) === "object" && this.node["branch"] !== undefined);
  }

  get has_then_reference() {
    return (typeof(this.node) === "object" && this.node["then"] !== undefined);
  }
}

module.exports = Tree;