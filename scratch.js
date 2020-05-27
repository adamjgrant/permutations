let arr = [
  "a", "b", [
    "c", "d", ["e"], [
      "f", ["i", "j", ["k"]], "g", ["h"]
    ]
  ], "z"
]

put_ast_on_leaves = (args = {suffix: "*", arr: []}) => {
  const arr = args.arr, suffix = args.suffix;
  if (arr.constructor.name === "String") return arr
  const arr_has_arrays = arr.some(item => Array.isArray(item));
  if (arr_has_arrays) {
    return arr.map(item => put_ast_on_leaves({suffix: suffix, arr: item }));
  } else {
    return arr.map(item => `${item}${suffix}`);
  }
}

console.log(put_ast_on_leaves({ arr: arr, suffix: "*"}));