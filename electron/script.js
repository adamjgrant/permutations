const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  matchBrackets: true,
  autoCloseBrackets: true,
  mode: "application/ld+json",
  lineWrapping: true
});
const output_element = document.getElementById("output");
const Permute = require("./permute");
let last_permutation;

editor.on("change", (instance, changeObj) => {
  setOutput("Permuting...");
  debounce(permute, "editor", 2000);
});

const permute = () => {
  let output = "Error parsing JSON";

  try {
    const tree  = new Permute(JSON.parse(editor.getValue()));
    let results = [];
    tree.permutations.forEach(permutation => results.push(permutation));
    output = results.join("<br>");
    last_permutation = results;
    setOutput(output);
  } catch(e) {
    setOutput(`${output}: ${e}`)
  }
}

const random_action_element = document.getElementById("random");
random_action_element.addEventListener("click", () => {
  if (!last_permutation) { return alert("Please generate a permutation first"); }
  const random_selection = (last_permutation[~~(last_permutation.length * Math.random())]);
  return navigator.clipboard.writeText(random_selection);
});

const setOutput = (text) => output_element.innerHTML = text;

permute();
