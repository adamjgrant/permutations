// A Tree is an object at the top level.
// A Tree contains Branches.
// Each Branch is [instantiated from] an array of Leaves (Interface: BranchArray)
// A Leaf can be one of string | Branch | BranchLink

interface BranchLink {
  branch: string;
}

interface BranchArray {
   splice: any;
   forEach(arg0: (array_item: any, index: any) => void);
   push(arg0: Branch);
   filter(arg0: (array_item: any) => boolean): string[];
   length: number;
   slice(number: number, number2: number): any[];
   map(arg0: (leaf: any) => any): any[];
   [index: number]: string | Array<BranchArray> | BranchLink;
}

class Tree {
    raw_object: object;
    one_random: boolean;
    errors: string[];

    constructor(tree: object, one_random: boolean = false) {
      this.raw_object = tree;
      this.one_random = one_random;
      this.errors = [];
    }
    public get main() : Branch { return this.branch("main"); }
    public branch(key) : Branch {
      let branch = new Branch(this.translated_object[key], this);
      return branch;
    }
    // Change all branch references recursively to arrays
    public get translated_object() {
      const raw_obj_main = this.raw_object["main"];
      return { "main": this.translate_branch_pointers(raw_obj_main) };
    }
    public get permutations() : string[] { return this.main.permutations; }
    private get longest_key() : string {
      return Object.keys(this.raw_object).reduce((longest, key) => {
        if (key.length > longest.length) return key;
        else return longest;
      }, "");
    }

    public randomly_orphaned_array(arr: []) : any[] {
      const random_selection = arr[~~(arr.length * Math.random())];
      let _arr = [];
      if (random_selection !== undefined) _arr.push(random_selection);
      return _arr;
    }

    public new_branch_reference(array: [], key: string = "") {
      //   Make a new key on the tree to host this then branch
      //   Use the longest length key and append an epoch stamp to avoid collisions
      const unique_key = `${this.longest_key}$`;

      this.raw_object[unique_key] = array;
      return unique_key;
    }

    private translate_branch_pointers(array_item, then_array : string[] = []) : string[] {
      if (array_item.constructor.name === "Object" && array_item["branch"]) {
        let referenced_branch_array = this.raw_object[array_item.branch];
        if (referenced_branch_array === undefined || referenced_branch_array === null) {
          this.errors.push(`The branch "${array_item.branch}" could not be found.`);
        }

        let _referenced_branch_array : string[] = JSON.parse(JSON.stringify(referenced_branch_array));

        if (array_item['then']) {
          // Force this to be inside an array if it's a solitary string.
          if (array_item.then.constructor.name === "String") array_item.then = [array_item.then];
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

      return arr.concat(branch.terminal_leaves);
    }, []);
  }
}

class Branch {
  array: BranchArray;
  tree: Tree;
  prefix: string;
  memoized_leaves: Array<Leaf>;

  constructor(branch: BranchArray, tree: Tree, prefix: string = "") {
    this.array                  = branch;
    this.tree                   = tree;
    this.prefix                 = prefix;
    this.memoized_leaves        = [];
  }

  public get permutations() : string[] {
    return this.terminal_leaves.map(leaf => leaf.val);
  }

  public get terminal_leaves() : Array<Leaf> {
    return this.leaves.reduce((permutations, leaf) => {
      return permutations.concat(leaf.terminal_leaves);
    }, []);
  }

  public get leaves() : Array<Leaf> {
    if (this.memoized_leaves.length) return this.memoized_leaves;
    // @ts-ignore
    let leaves       = this.tree.one_random ? this.tree.randomly_orphaned_array(this.leaves_as_strings) : this.leaves_as_strings;
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

  private get leaves_as_strings() {
    return this.array.filter(array_item => array_item.constructor.name === "String");
  }

  public get sub_branches() : Array<Branch> {
    // Take the raw nested array and turn it into Branches.
    // @ts-ignore
    const _sub_branches = this.array.filter(array_item => Array.isArray(array_item)).map(array_item => new Branch(array_item, this.tree));

    // @ts-ignore
    return this.tree.one_random ? this.tree.randomly_orphaned_array(_sub_branches) : _sub_branches;
  }
}

module.exports = Tree;
