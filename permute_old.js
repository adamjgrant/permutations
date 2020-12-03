// A Tree is an object at the top level.
// A Tree contains Branches.
// Each Branch is [instantiated from] an array of Leaves (Interface: BranchArray)
// A Leaf can be one of string | Branch | BranchLink
class Tree {
  constructor(tree, one_random = false) {
    this.raw_object = tree;
    this.one_random = one_random;
    this.errors = [];
  }
  get main() { return this.branch("main"); }
  branch(key) {
    let branch = new Branch(this.translated_object[key], this);
    return branch;
  }
  // Change all branch references recursively to arrays
  get translated_object() {
    const raw_obj_main = this.raw_object["main"];
    return { "main": this.translate_branch_pointers(raw_obj_main) };
  }
  get permutations() { return this.main.permutations; }
  get longest_key() {
    return Object.keys(this.raw_object).reduce((longest, key) => {
      if (key.length > longest.length)
        return key;
      else
        return longest;
    }, "");
  }
  randomly_orphaned_array(arr) {
    const random_selection = arr[~~(arr.length * Math.random())];
    let _arr = [];
    if (random_selection !== undefined)
      _arr.push(random_selection);
    return _arr;
  }
  new_branch_reference(array, key = "") {
    //   Make a new key on the tree to host this then branch
    //   Use the longest length key and append an epoch stamp to avoid collisions
    const unique_key = `${this.longest_key}$`;
    this.raw_object[unique_key] = array;
    return unique_key;
  }
  translate_branch_pointers(array_item, then_array = []) {
    if (array_item.constructor.name === "Object" && array_item["branch"]) {
      let referenced_branch_array = this.raw_object[array_item.branch];
      if (referenced_branch_array === undefined || referenced_branch_array === null) {
        this.errors.push(`The branch "${array_item.branch}" could not be found.`);
      }
      let _referenced_branch_array = JSON.parse(JSON.stringify(referenced_branch_array));
      if (array_item['then']) {
        // Force this to be inside an array if it's a solitary string.
        if (array_item.then.constructor.name === "String")
          array_item.then = [array_item.then];
        array_item.then = this.translate_branch_pointers(array_item.then, then_array);
        array_item.then.push(then_array);
        then_array = array_item;
      }
      // @ts-ignore
      return this.translate_branch_pointers(_referenced_branch_array, then_array);
    }
    else {
      // This array item is a string or array, we're done.
      return array_item.push(then_array);
    }
  }
}
class Leaf {
  constructor(val, _branches = []) {
    this.val = val;
    this._branches = _branches;
  }
  get branches() {
    return this._branches.map(_branch => new Branch(_branch.array, _branch.tree, this.val));
  }
  get terminal_leaves() {
    if (!this.branches.length)
      return [this];
    return this.branches.reduce((arr, branch) => {
      // @ts-ignore
      return arr.concat(branch.terminal_leaves);
    }, []);
  }
}
class Branch {
  constructor(branch, tree, prefix = "") {
    this.array = branch;
    this.tree = tree;
    this.prefix = prefix;
    this.memoized_leaves = [];
  }
  get permutations() {
    return this.terminal_leaves.map(leaf => leaf.val);
  }
  get terminal_leaves() {
    return this.leaves.reduce((permutations, leaf) => {
      return permutations.concat(leaf.terminal_leaves);
    }, []);
  }
  get leaves() {
    if (this.memoized_leaves.length)
      return this.memoized_leaves;
    // @ts-ignore
    let leaves = this.tree.one_random ? this.tree.randomly_orphaned_array(this.leaves_as_strings) : this.leaves_as_strings;
    // @ts-ignore
    // console.log(this.array, this.sub_branches);
    if (this.sub_branches.length && !leaves.length) {
      leaves = [""];
    }
    this.memoized_leaves = leaves.map((leaf) => {
      return new Leaf(`${this.prefix}${leaf}`, this.sub_branches);
    });
    return this.memoized_leaves;
  }
  get leaves_as_strings() {
    return this.array.filter(array_item => array_item.constructor.name === "String");
  }
  get sub_branches() {
    // Take the raw nested array and turn it into Branches.
    // @ts-ignore
    const _sub_branches = this.array.filter(array_item => Array.isArray(array_item)).map(array_item => new Branch(array_item, this.tree));
    // @ts-ignore
    return this.tree.one_random ? this.tree.randomly_orphaned_array(_sub_branches) : _sub_branches;
  }
}
module.exports = Tree;
//# sourceMappingURL=permute.js.map