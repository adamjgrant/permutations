// A Tree is an object at the top level.
// A Tree contains Branches.
// Each Branch is [instantiated from] an array of Leaves (Interface: BranchArray)
// A Leaf can be one of string | Branch | BranchLink
class Tree {
    constructor(tree, sampling_factor = 1) {
        this.object = tree;
        this.sampling_factor = sampling_factor;
    }
    get main() { return this.branch("main"); }
    branch(key) {
        let branch = new Branch(this.object[key], this);
        return branch;
    }
    get permutations() { return this.main.permutations; }
    get longest_key() {
        return Object.keys(this.object).reduce((longest, key) => {
            if (key.length > longest.length)
                return key;
            else
                return longest;
        }, "");
    }
    new_branch_reference(array, key = "") {
        //   Make a new key on the tree to host this then branch
        //   Use the longest length key and append an epoch stamp to avoid collisions
        const unique_key = `${this.longest_key}$`;
        this.object[unique_key] = array;
        return unique_key;
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
    append_branch(branch) {
        const terminal_branch = new Branch(branch.array, branch.tree, this.val);
        // @ts-ignore
        this._branches.push(terminal_branch);
        // @ts-ignore
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
        this.sampled = false;
    }
    get permutations() {
        return this.terminal_leaves.map(leaf => leaf.val);
    }
    get terminal_leaves() {
        return this.leaves.reduce((permutations, leaf) => {
            return permutations.concat(leaf.terminal_leaves);
        }, []);
    }
    get terminal_leaf_count() {
        let num_leaves = this.leaves_as_strings.length;
        if (num_leaves === 0)
            num_leaves = 1;
        // @ts-ignore
        let num_sub_leaves = this.sub_branches(false).reduce((count, sub_branch) => {
            return sub_branch.terminal_leaf_count + count;
        }, 0);
        if (num_sub_leaves === 0)
            num_sub_leaves = 1;
        return num_leaves * num_sub_leaves;
    }
    get leaves() {
        if (this.memoized_leaves.length)
            return this.memoized_leaves;
        let leaves = this.leaves_as_strings;
        // @ts-ignore
        if (this.sub_branches().length && !leaves.length) {
            leaves = [""];
        }
        this.memoized_leaves = leaves.map((leaf) => {
            return new Leaf(`${this.prefix}${leaf}`, this.sub_branches());
        });
        return this.memoized_leaves;
    }
    get leaves_as_strings() {
        return this.array.filter(array_item => array_item.constructor.name === "String");
    }
    translate_branch_pointers() {
        this.array.forEach((array_item, index) => {
            if (array_item.constructor.name === "Object" && array_item["branch"]) {
                let branch = JSON.parse(JSON.stringify(this.tree.object[array_item.branch]));
                if (array_item['then']) {
                    if (array_item.then.constructor.name === "String")
                        array_item.then = [array_item.then];
                    const unique_key = this.tree.new_branch_reference(array_item.then);
                    //   Put a { "branch": "<that long key>" } on the deep end of the array below.
                    const reference = { "branch": unique_key };
                    branch = this.add_reference_to_branch_deep_end({ branch: branch, reference: reference });
                }
                // @ts-ignore
                this.array[index] = branch;
            }
        });
    }
    add_reference_to_branch_deep_end(args = { branch: [], reference: {} }) {
        const branch = args.branch, reference = args.reference;
        if (branch.constructor.name === "String")
            return branch;
        const branch_has_arrays = branch.some(item => Array.isArray(item));
        if (branch_has_arrays) {
            return branch.map(item => this.add_reference_to_branch_deep_end({ branch: item, reference: reference }));
        }
        else {
            branch.push(reference);
            return branch;
        }
    }
    sample_branches() {
        if (this.tree.sampling_factor === 1)
            return;
        if (this.sampled)
            return;
        let branches_to_sample = this.terminal_leaf_count / this.tree.sampling_factor;
        // Round up this value only 1/sampling_factor of the time
        const one_sampleth_of_the_time = Math.floor(Math.random() * this.tree.sampling_factor) === 0;
        branches_to_sample = one_sampleth_of_the_time ? Math.ceil(branches_to_sample) : Math.floor(branches_to_sample);
        if (branches_to_sample > this.array.length)
            branches_to_sample = this.array.length;
        // With thanks to https://stackoverflow.com/a/19270021/393243
        let result = new Array(branches_to_sample), len = this.array.length, taken = new Array(len);
        if (branches_to_sample > len)
            throw new RangeError("getRandom: more elements taken than available");
        while (branches_to_sample--) {
            var x = Math.floor(Math.random() * len);
            result[branches_to_sample] = this.array[x in taken ? taken[x] : x];
            taken[x] = --len in taken ? taken[len] : len;
        }
        this.sampled = true;
        this.array = result;
    }
    sub_branch_array_filter(array_item) { return Array.isArray(array_item); }
    sub_branches(sample = true) {
        this.translate_branch_pointers();
        if (sample)
            this.sample_branches();
        // Take the raw nested array and turn it into Branches.
        // @ts-ignore
        return this.array.filter(this.sub_branch_array_filter)
            // @ts-ignore
            .map(array_item => new Branch(array_item, this.tree));
    }
}
module.exports = Tree;
//# sourceMappingURL=permute.js.map