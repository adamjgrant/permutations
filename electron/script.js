const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  matchBrackets: true,
  autoCloseBrackets: true,
  mode: "application/ld+json",
  lineWrapping: true
});
const output_element = document.getElementById("output");
const Permute = module.exports;
let last_permutation;

// Set initial load
const previous_code = localStorage.getObject("code")
if (previous_code) editor.setValue(previous_code);
// End set initial load

editor.on("change", (instance, changeObj) => {
  setOutput("Permuting...");
  debounce(permute, "editor", 2000);
  debounce(persist, "persistence", 2000);
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

const persist = () => {
  localStorage.setObject("code", editor.getValue());
}

const random_action_element = document.getElementById("random");

random_action_element.addEventListener("click", () => {
  if (!last_permutation) { return alert("Please generate a permutation first"); }
  const random_selection = (last_permutation[~~(last_permutation.length * Math.random())]);
  show_flash(`Copied to clipboard: "${random_selection}"`);
  return navigator.clipboard.writeText(random_selection);
});

const flash_element = document.getElementById("flash");
let flash_timeout;
const show_flash = (text) => { 
  window.clearTimeout(flash_timeout);
  flash_element.innerHTML = text;
  flash_element.classList.add("show");
  flash_timeout = window.setTimeout(() => { 
    flash_element.classList.remove("show");
  }, 1000);
}

const setOutput = (text) => output_element.innerHTML = text;

permute();
