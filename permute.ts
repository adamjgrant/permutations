// A Tree is an object at the top level.
// A Tree contains Branches.
// Each Branch is [instantiated from] an array of Leaves (Interface: BranchArray)
// A Leaf can be one of string | Branch | BranchLink

interface BranchLink {
  branch: string;
}

interface BranchArray {
   some(arg0: (item: any) => boolean);
   splice: any;
   forEach(arg0: (array_item: any, index: any) => void);
   push(arg0: Branch);
   filter(arg0: (array_item: any) => boolean): string[];
   length: number;
   slice(number: number, number2: number): any[];
   map(arg0: (leaf: any) => any): any[];
   [index: number]: string | Array<BranchArray> | BranchLink;
}

class Sampler {
  branch: Branch;

  constructor(branch : Branch) {
    this.branch = branch;
  }

  // Returns true 1/s of the time.
  private get roll() {
    return ( Math.floor( Math.random() * this.branch.tree.sampling_factor ) === 0 )
  }

  // For this branch, determine whether sampling should occur
  // as a function of the total number of terminal leaves and the items in this branch
  private get sampling_should_occur() : boolean {
    return (this.branch.tree.sampling_factor !== 1)
  }

  public sample() : void {
    if (!this.sampling_should_occur) return
    const mark_sampled_terminal_leaves = (array) : BranchArray => {
      if (array.constructor.name === "String") return array;
      const array_has_arrays = array.some(item => Array.isArray(item));

      if (array_has_arrays) {
        return array.map(item => mark_sampled_terminal_leaves(item));
      } else {
        return array.map(item => {
          if (this.roll) { return item; }
          else {
            this.branch.tree.terminal_leaves_removed++;
            return false;
          }
        });
      }
    }

    const array = JSON.parse(JSON.stringify(this.branch.array));
    this.branch.shadow_array = mark_sampled_terminal_leaves(array);
  }
}

class Tree {
  object: object;
  sampling_factor: number;
  terminal_leaves_removed: number;
  mermaid_writable: boolean;
  mermaid_path: string;
  fs: object;

  constructor(tree: object, sampling_factor: number = 1) {
    this.object = tree;
    this.sampling_factor = sampling_factor;
    this.terminal_leaves_removed = 0;

    this.mermaid_writable = false;
    this.mermaid_path = "";
    this.fs = {};
  }

  public write_to_mermaid_file(path: string) {
    this.mermaid_writable = true;
    this.mermaid_path = `./mermaid/${path}.mm`;
    this.fs = require("fs");
    const content = "graph TD\n";
    // @ts-ignore
    this.fs.writeFile(this.mermaid_path, content, (err) => {
      if (err) throw err;
      this.permutations;
      this.mermaid_writable = false;
    });
  }

  public get main() : Branch { return this.branch("main"); }
  public branch(key) : Branch {
    let branch = new Branch(this.object[key], this);
    return branch;
  }
  public get permutations() : string[] {
    return this.main.permutations;
  }
  private get longest_key() : string {
    return Object.keys(this.object).reduce((longest, key) => {
      if (key.length > longest.length) return key;
      else return longest;
    }, "");
  }

  public new_branch_reference(array: [], key: string = "") {
    //   Make a new key on the tree to host this then branch
    //   Use the longest length key and append an epoch stamp to avoid collisions
    const unique_key = `${this.longest_key}$`;

    this.object[unique_key] = array;
    return unique_key;
  }
}

class Leaf {
  val: string;
  _branches: Array<Branch>;

  constructor(val: string, _branches: Array<Branch> = []) {
    this.val = val;
    this._branches = _branches;
  }

  public get branches() : Array<Branch> {
    return this._branches.map(_branch => new Branch(_branch.array, _branch.tree, this.val));
  }

  public get terminal_leaves() : Array<Leaf> {
    if (!this.branches.length) return [this];
    return this.branches.reduce((arr, branch) => {
      // @ts-ignore
      if (branch.is_vilomah) return arr;
      return arr.concat(branch.terminal_leaves);
    }, []);
  }
}

class Branch {
  array: BranchArray;
  shadow_array : BranchArray;
  tree: Tree;
  prefix: string;
  memoized_leaves: Array<Leaf>;

  constructor(branch: BranchArray, tree: Tree, prefix: string = "") {
    this.array = branch;
    this.shadow_array = [];
    this.tree = tree;
    this.prefix = prefix;
    this.memoized_leaves = [];

    this.translate_branch_pointers();
    this.sample_branches();
  }

  public get permutations(): string[] {
    return this.terminal_leaves.map(leaf => leaf.val);
  }

  public get terminal_leaves(): Array<Leaf> {
    if (this.is_vilomah) return [];
    return this.leaves.reduce((permutations, leaf) => {
      return permutations.concat(leaf.terminal_leaves);
    }, []);
  }

  public get terminal_leaf_count() : number {
    let num_leaves = this.leaves_as_strings.length;
    if (num_leaves === 0) num_leaves = 1;
    // @ts-ignore
    let num_sub_leaves = this.sub_branches.reduce((count, sub_branch) => {
      return sub_branch.terminal_leaf_count + count;
    }, 0);
    if (num_sub_leaves === 0) num_sub_leaves = 1;

    return num_leaves * num_sub_leaves;
  }

  public get leaves(): Array<Leaf> {
    if (this.memoized_leaves.length) return this.memoized_leaves;
    let leaves = this.leaves_as_strings;
    // @ts-ignore

    if (this.sub_branches.length && !leaves.length) {
      leaves = [""];
    }

    this.memoized_leaves = leaves.map((leaf) => {
      if (this.tree.mermaid_writable && this.prefix.length) {
        const content = `    ${this.prefix} --> ${this.prefix}${leaf}\n`;
        // @ts-ignore
        this.tree.fs.appendFile(this.tree.mermaid_path, content, function (err) {
          if (err) throw err;
        });
      }

      return new Leaf(`${this.prefix}${leaf}`, this.sub_branches)
    });

    return this.memoized_leaves;
  }

  private get leaves_as_strings() {
    return this.array.filter(array_item => array_item.constructor.name === "String");
  }

  // Does this branch have leaves but they are all replaced with "false" markers?
  get is_vilomah() {
    let terminal_values = [];
    const parse = (array) => {
      if (array.constructor.name === "String") return array;
      if (array === false) return false;
      const array_has_arrays = array.some(item => Array.isArray(item));

      if (array_has_arrays) {
        return array.map(item => parse(item));
      } else {
        return terminal_values = terminal_values.concat(array);
      }
    }

    parse(this.shadow_array);
    return terminal_values.every(val => val === false);
  }

  translate_branch_pointers() {
    this.array.forEach((array_item, index) => {
      if (array_item.constructor.name === "Object" && array_item["branch"]) {
        let branch: string[] = JSON.parse(JSON.stringify(this.tree.object[array_item.branch]));

        if (array_item['then']) {
          if (array_item.then.constructor.name === "String") array_item.then = [array_item.then];
          const unique_key = this.tree.new_branch_reference(array_item.then);
          //   Put a { "branch": "<that long key>" } on the deep end of the array below.
          const reference = {"branch": unique_key};
          branch = this.add_reference_to_branch_deep_end({branch: branch, reference: reference});
        }

        // @ts-ignore
        this.array[index] = branch;
      }
    });
  }

  private add_reference_to_branch_deep_end(args = {branch: [], reference: {}}) {
    const branch = args.branch, reference = args.reference;
    if (branch.constructor.name === "String") return branch;
    const branch_has_arrays = branch.some(item => Array.isArray(item));

    if (branch_has_arrays) {
      return branch.map(item => this.add_reference_to_branch_deep_end({branch: item, reference: reference}));
    } else {
      branch.push(reference);
      return branch
    }
  }

  private sample_branches() : void { new Sampler(this).sample(); }

  public get sub_branches() : Array<Branch> {
    // Take the raw nested array and turn it into Branches.
    // @ts-ignore
    return this.array.filter(item => Array.isArray(item))
      // @ts-ignore
      .map(array_item => new Branch(array_item, this.tree, undefined));
  }
}

module.exports = Tree;