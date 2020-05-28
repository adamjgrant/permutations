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
    return (Math.floor(Math.random() * this.branch.tree.sampling_factor) === 0)
  }

  // For this branch, determine whether sampling should occur
  // as a function of the total number of terminal leaves and the items in this branch
  private get sampling_should_occur() : boolean {
    return (this.branch.tree.sampling_factor !== 1 || !this.branch.sampled)
    // const terminal_leaf_sampling_factor : number = this.branch.terminal_leaf_count / this.branch.tree.sampling_factor;
    // const int_terminal_leaf_sampling_factor      = this.roll ? Math.floor(terminal_leaf_sampling_factor) : Math.ceil(terminal_leaf_sampling_factor);
    // const length_of_branch                       = this.branch.array.length;
    // return length_of_branch >= int_terminal_leaf_sampling_factor;
  }

  public sample() {
    // If sampling should occur, Perform that sampling removal on this branch's array
    if (!this.sampling_should_occur) return

    // Traverse the raw branch array and recreate it. Skip the terminals only 1/sampling_factor of the time.
    const parse = (array : BranchArray) => {
      if (array.constructor.name === "String") return array;
      // @ts-ignore
      if (array === false) return false;
      const array_has_arrays = array.some(item => Array.isArray(item));

      if (array_has_arrays) {
        return array.map(item => parse(item));
      } else {
        // Mark the terminal leaf as skippable (s-1)/s of the time.
        return array.map(item => {
          return this.roll ? item : false;
        });
      }
    }

    const new_array = parse(this.branch.array);
    this.branch.array = new_array;
    this.branch.sampled = true;
  }
}

class Tree {
  object: object;
  sampling_factor: number;
  main_branch: Branch;

  constructor(tree: object, sampling_factor: number = 1) {
    this.object = tree;
    this.sampling_factor = sampling_factor;
    this.main_branch = undefined;
  }

  public get main() : Branch {
    if (this.main_branch) return this.main_branch;
    let main_branch = this.branch("main");
    main_branch.translate_branch_pointers();
    main_branch.sample_branches();
    console.log(main_branch.array);
    this.main_branch = main_branch;
    return main_branch;
  }
  public branch(key) : Branch {
    let branch = new Branch(this.object[key], this);
    return branch;
  }
  public get permutations() : string[] { return this.main.permutations; }
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
    return this._branches.map(_branch => new Branch(_branch.array, _branch.tree, this.val, _branch.sampled));
  }

  append_branch(branch: Branch) {
    const terminal_branch = new Branch(branch.array, branch.tree, this.val, branch.sampled);
    // @ts-ignore
    this._branches.push(terminal_branch);
    // @ts-ignore
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
  tree: Tree;
  prefix: string;
  memoized_leaves: Array<Leaf>;
  sampled: boolean

  constructor(branch: BranchArray, tree: Tree, prefix: string = "", sampled : boolean = false) {
    this.array = branch;
    this.tree = tree;
    this.prefix = prefix;
    this.memoized_leaves = [];
    this.sampled = sampled;

    this.translate_branch_pointers();
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
      return new Leaf(`${this.prefix}${leaf}`, this.sub_branches)
    });

    return this.memoized_leaves;
  }

  private get leaves_as_strings() {
    return this.array.filter(array_item => array_item.constructor.name === "String");
  }

  // Does this branch have leaves but they are all replaced with "false" markers?
  // TODO: Sampling may be called after we get to this step
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

    parse(this.array);
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

  public sample_branches() : void {
    const sampler = new Sampler(this);
    // This will mutate this.array for us.
    sampler.sample();
  }

  private sub_branch_array_filter(array_item) { return Array.isArray(array_item) }

  public get sub_branches() : Array<Branch> {
    // Take the raw nested array and turn it into Branches.
    // @ts-ignore
    return this.array.filter(this.sub_branch_array_filter)
      .map(array_item => {
        // @ts-ignore
        let new_branch = new Branch(array_item, this.tree);
        new_branch.sampled = this.sampled;
        return new_branch;
      });
  }
}

module.exports = Tree;