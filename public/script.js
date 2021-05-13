class Component extends Mozart {};
let m = Component.index;

// Everything below is getting refactored into Mozart

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
const output_random_element = document.getElementById("output-random"),
      output_all_element    = document.getElementById("output-all");

const Permute = module.exports;
let last_permutation;

editor.on("change", (instance, changeObj) => {
  k$.status({
    text: "Permuting...", type: "status-blue"
  })
  debounce(permute, "editor", 500);
  debounce(setAllNotice, "set_all_notice", 1000);
  debounce(persist, "persistence", 500);
});

const permute = () => {
  let output = "Error parsing JSON";

  try {
    let results = [];
    while(results.length < 5) { results.push(random_permutation()); }
    output = results.map(result => `<li>${result}</li>`).join("");
    last_permutation = results;
    setRandomOutput(output);
  } catch(e) {
    setRandomOutput(`${output}: ${e}`)
  }
}

const random_permutation = () => {
  const tree  = new Permute(JSON.parse(editor.getValue()));
  return tree.one;
}

const persist = () => {
  localStorage.setObject("code", editor.getValue());
}

const random_action_element = document.getElementById("random");
const regenerate_action_element = document.getElementById("regenerate");

random_action_element.addEventListener("click", () => {
  if (!last_permutation) { k$.status({ text: "Please generate a permutation first" }); }
  const random_selection = random_permutation();
  k$.status({ text: `Copied to clipboard: "${random_selection}"`});
  return navigator.clipboard.writeText(random_selection);
});

regenerate_action_element.addEventListener("click", () => { permute(); });

const setRandomOutput = (text) => {
  output_random_element.innerHTML = text;
  k$.status({
    text: "Done", type: "status-green"
  })
}

const setAllOutput = (text) => {
  output_all_element.innerHTML = text;
  k$.status({
    text: "Done", type: "status-green"
  })
}

const regenerate_notice = document.getElementById("regenerate-notice");
const setAllNotice = () => {
  regenerate_notice.classList.remove("hide")
}

const generate_all_element = document.getElementById("generate-all");
const permute_all = () => {
  regenerate_notice.classList.remove("notshown");
  regenerate_notice.classList.add("hide");

  let output = "Error parsing JSON";

  try {
    const tree  = new Permute(JSON.parse(editor.getValue()));
    const results = tree.permutations;
    output = results.map(result => `<li>${result}</li>`).join("");
    setAllOutput(output);
  } catch(e) {
    setAllOutput(`${output}: ${e}`)
  }
}

generate_all_element.addEventListener("click", permute_all)

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

permute();

const return_github_gist_error = () => {
  k$.status({
    text: "Could not get github gist data",
    type: "status-red"
  })
}

const get_gist_url = () => {
  return new URL(location.href).searchParams.get("gist") || undefined;
}

const sanitize_gist_url = (url) => {
  if (!url) return undefined;
  const regex_1 = /^https\:\/\/gist\.githubusercontent\.com\//;
  const regex_2 = /^https\:\/\/gist\.github\.com\//;
  if (!url.match(regex_1)) {
    if (!!url.match(regex_2)) {
      console.error("URL must start with gist.githubusercontent. Try opening the gist in a new tab and following the redirect first");
      setTimeout(() => {
        k$.status({
          text: "URL must start with gist.githubusercontent. Try opening the gist in a new tab and following the redirect first",
          type: "status-red",
          delay: 3000
        })
      }, 3000);
      return undefined;
    } else {
      return_github_gist_error();
      return undefined;
    }
  }
  else {
    return url
  }
}

const get_gist_data = (url, callback) => {
  k$.status({
    text: "Loading from GitHub gist. Please hold...",
    type: "status-info"
  })
  var request = new XMLHttpRequest();
  request.open('GET', url, true);

  request.onload = function() {
    if (this.status >= 200 && this.status < 400) {
      // Success!
      callback(this.response);
    } else {
      return_github_gist_error();
      return undefined;
    }
  };

  request.onerror = function() {
    // There was a connection error of some sort
    return_github_gist_error();
    return undefined;
  };

  request.send();
}

// Set initial load
const previous_code = localStorage.getObject("code");
const gist_url      = get_gist_url();
const sanitized_gist_url = sanitize_gist_url(gist_url);

const set_previous_code = () => {
  if (previous_code) {
    editor.setValue(previous_code);
  }
  else {
    set_default_text();
  }
}

if (sanitized_gist_url) {
  get_gist_data(sanitized_gist_url, (data) => {
    const skip_confirm = true;
    if (skip_confirm || confirm("Confirmation needed\n\nThis URL is trying to load JSON data from a GitHub gist. Before this is loaded, please confirm if you trust this source to prevent an XSS attack.")) {
      editor.setValue(data);
    }
    else {
      set_previous_code();
    }
  });
}
else {
  set_previous_code();
}