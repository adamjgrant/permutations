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
  constructor(tree, object, then_branches) {
    this.tree = tree;
    this.object = object;
    this.then_branches = then_branches;
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
    let _leaves = this.object.filter(item => new Leaf(item).is_string) || [];
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
    if (object_leaf.has_directive("branch")) {
      return this.translate_branch_reference(object_leaf);
    }

    if (this.is_terminal_branch && this.then_branches !== undefined) this.object.push(this.then_branches);

    // Otherwise, assume this is an array
    return this.object.map(_leaf => {
      const leaf = new Leaf(_leaf);
      if (leaf.has_directive("branch")) return this.translate_branch_reference(leaf);
      if (leaf.is_branch) {
        const _branch = new Branch(this.tree, leaf.node)
        if (!_branch.is_terminal_branch) _branch.then_branches = this.then_branches;
        return _branch.translate_object;
      }

      // No more then branches, terminal leaf.
      return leaf.node;
    });
  }

  get is_terminal_branch() {
    return !(this.branches().length && this.has_then_branches) && this.object.every(item => new Leaf(item).is_string);
  }

  translate_branch_reference(leaf) {
    const branch_object = this.duplicate_branch(this.tree.branch(leaf.node.branch));

    // Continue recursively
    const branch = new Branch(this.tree, branch_object, this.then_branches);

    // Translate the then and append it inside the branch.
    if (leaf.has_directive("then")) {
      const then_object = this.translate_then_reference(leaf);
      branch.prepend_then_branch(then_object)
    }

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
  
  prepend_then_branch(branch_to_prepend) {
    if (branch_to_prepend === undefined) return;
    let branch = new Branch(this.tree, branch_to_prepend, this.then_branches);
    if (branch.is_terminal_branch) {
      if (this.has_then_branches) {
        this.then_branches = [...branch_to_prepend, this.then_branches]
      } else {
        this.then_branches = branch_to_prepend;
      }
      return this.then_branches;
    }
    else {
      const recursed_branches = branch.branches().map(_branch => {
        return new Branch(this.tree, branch, this.then_branches).prepend_then_branch(_branch)
      })
      this.then_branches = [...branch.leaves(), ...recursed_branches];
      return this.then_branches;
    }
  }

  get has_then_branches() {
    return this.then_branches !== undefined;
  }
}

class Leaf {
  constructor(node) { this.node = node; }

  get is_branch() { return Array.isArray(this.node); }

  get is_string() { return this.node.constructor.name === "String"; }

  has_directive(name = "branch") {
    return (typeof(this.node) === "object" && this.node[name] !== undefined);
  }
}

module.exports = Tree;