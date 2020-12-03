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
    console.log(`Then branches for branch ${JSON.stringify(this.object)}: ${this.then_branches}`)
    // Incoming object could be a bare branch reference.
    const object_leaf = new Leaf(this.object)
    if (object_leaf.is_branch_reference) {
      return this.translate_branch_reference(object_leaf);
    }

    if (this.is_terminal_branch && this.then_branches !== undefined) this.object.push(this.then_branches);

    // Otherwise, assume this is an array
    return this.object.map(_leaf => {
      const leaf = new Leaf(_leaf);
      if (leaf.is_branch_reference) return this.translate_branch_reference(leaf);
      if (leaf.is_branch) {
        const _branch = new Branch(this.tree, leaf.node)
        if (!_branch.is_terminal_branch) {
          console.log(`The branch ${JSON.stringify(_branch.object)} is not terminal`);
          _branch.then_branches = this.then_branches;
        } else { console.log(`The branch ${JSON.stringify(_branch.object)} is terminal`) }
        console.log("***")
        return _branch.translate_object;
      }

      // No more then branches, terminal leaf.
      return leaf.node;
    });
  }

  get is_terminal_branch() {
    return !(this.branches().length && this.has_then_ranches) && this.object.every(item => {
      console.log(`item: ${JSON.stringify(item)}`)
      return new Leaf(item).is_string
    });
  }

  translate_branch_reference(leaf) {
    const branch_object = this.duplicate_branch(this.tree.branch(leaf.node.branch));

    console.log(branch_object, this.then_branches, leaf);
    // Continue recursively
    const branch = new Branch(this.tree, branch_object, this.then_branches);

    // Translate the then and append it inside the branch.
    if (leaf.has_then_reference) {
      console.log("Leaf does have a then reference")
      const then_object = this.translate_then_reference(leaf); // TODO: This is returning ["c", undefined]
      console.log(`about to prepend a then_object with length ${then_object.length}`)
      branch.prepend_then_branch(then_object)
      console.log(`After prepending then object, branch ${JSON.stringify(branch.object)} shows ${branch.then_branches} as then obj`);
    }

    return branch.translate_object;
  }
  
  translate_then_reference(leaf) {
    console.log(`--${JSON.stringify(leaf)}`)
    let then_object = leaf.node.then;
    if (then_object.constructor.name === "String") then_object = [then_object];
    console.log(`--${JSON.stringify(then_object)}`)
    return new Branch(this.tree, then_object).translate_object;
  }

  duplicate_branch(branch) {
    return JSON.parse(JSON.stringify(branch));
  }
  
  prepend_then_branch(branch_to_prepend) {
    if (branch_to_prepend === undefined) return;
    if (this.has_then_branches) {
      console.log(`putting ${this.then_branches} inside ${branch_to_prepend}`);
      this.then_branches = [...branch_to_prepend, this.then_branches]
    }
    else {
      console.log(`Setting empty then branch of ${JSON.stringify(this.object)} to ${branch_to_prepend}`)
      this.then_branches = branch_to_prepend;
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

  get is_branch_reference() {
    return (typeof(this.node) === "object" && this.node["branch"] !== undefined);
  }

  get has_then_reference() {
    return (typeof(this.node) === "object" && this.node["then"] !== undefined);
  }
}

module.exports = Tree;