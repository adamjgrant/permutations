const default_text = `{
    "main": [
      "Hey there", "Well hello", "Greetings", [
        ". ", [
          "Permy.link", "This permutation generator", [
            " ", [
              "lets you make many \\"permutations\\" of a line of text using specified variations.", {
                "branch": "keep reading"
              }
            ]
          ]
        ]
      ]
    ],
    "keep reading": [
      " ", [
        "Permy has some neat advanced features for keeping your configuration", { "branch": "tidy", "then":  ["too. ", { "branch": "about branches" }] }
      ]
    ],
    "tidy": [" ", ["tidy", "organized", "neat and streamlined", [" "]]],
    "about branches": [
      "You can create branches", "Branches can be created", { "branch": "why do you create branches?" }
    ],
    "why do you create branches?": [
      " which let you converge separate paths or just create named shortcuts. ", [
        "Learn more", "Read on", [
          " about", [
            " permy.link by clicking on the docs link below.", {
              "branch": "smiley"
            }
          ]
        ]
      ]
    ],
    "smiley": ["🤓", "😁", "😀"]
}`;

const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  matchBrackets: true,
  autoCloseBrackets: true,
  mode: "application/ld+json",
  lineWrapping: true,
  lineNumbers: true,
  theme: "solarized dark"
});
const output_element = document.getElementById("output");
const Permute = module.exports;
let last_permutation;

editor.on("change", (instance, changeObj) => {
  k$.status({
    text: "Permuting...", type: "status-blue"
  })
  debounce(permute, "editor", 500);
  debounce(persist, "persistence", 500);
});

const permute = () => {
  let output = "Error parsing JSON";

  try {
    let results = [];
    while(results.length < 5) { results.push(random_permutation()); }
    output = results.map(result => `<li>${result}</li>`).join("");
    last_permutation = results;
    setOutput(output);
  } catch(e) {
    setOutput(`${output}: ${e}`)
  }
}

const random_permutation = () => {
  const tree  = new Permute(JSON.parse(editor.getValue()), true);
  return tree.permutations[0];
}

const persist = () => {
  localStorage.setObject("code", editor.getValue());
}

const random_action_element = document.getElementById("random");
const regenerate_action_element = document.getElementById("regenerate");

random_action_element.addEventListener("click", () => {
  if (!last_permutation) { return alert("Please generate a permutation first"); }
  const random_selection = random_permutation();
  show_flash(`Copied to clipboard: "${random_selection}"`);
  return navigator.clipboard.writeText(random_selection);
});

regenerate_action_element.addEventListener("click", () => { permute(); });

const show_flash = (text) => {
  k$.status({
    text: text, type: 'status-blue'
  })
}

const setOutput = (text) => {
  output_element.innerHTML = text;
  k$.status({
    text: "Done", type: "status-green"
  })
}

const clear_button = document.getElementById("clear");
clear_button.addEventListener("click", () => {
  if (confirm("You will lose anything you've entered, are you sure?")) {
    editor.setValue(`{ 
  "main": [] 
}
    `);
  }
});

const default_button = document.getElementById("default");
const set_default_text = () => { editor.setValue(default_text); }
default_button.addEventListener("click", () => {
  if (confirm("You will lose anything you've entered, are you sure?")) {
    set_default_text();
  }
});

const gist_url_element = document.getElementById("gist_url");
// TODO: XSS Protection!
// gist_url_element.addEventListener("change", get_remote_code);

permute();

// Set initial load
const previous_code = localStorage.getObject("code");
if (previous_code) {
  editor.setValue(previous_code);
}
else {
  set_default_text();
}
