const Permute = module.exports;
const EDITOR_SAVE_DEBOUNCE_IN_MS = 1000;
const EDITOR_PERMUTE_DEBOUNCE_IN_MS = 1300;
const EDITOR_SET_ALL_NOTICE_DEBOUNCE_IN_MS = 1000;

m.editor.last_permutation = "";

m.editor.acts({
  self(_$, args) {
    if (m.editor.self === undefined) {
      m.editor.self = CodeMirror.fromTextArea(document.getElementById("code"), {
        matchBrackets: true,
        autoCloseBrackets: true,
        mode: "application/ld+json",
        lineWrapping: true,
        lineNumbers: true,
        theme: "solarized dark"
      });
    }
    return m.editor.self;
  },

  set_value(_$, args) {
    return m.editor.act.self().setValue(args.value);
  },

  get_value(_$, args) {
    return m.editor.act.self().getValue();
  },

  permute(_$, args) {
    k$.status({
        text: "Permuting...",
        type: "status-blue"
    })
    debounce(_$.act.get_permutations, "editor", EDITOR_PERMUTE_DEBOUNCE_IN_MS);
    debounce(setAllNotice, "set_all_notice", EDITOR_SET_ALL_NOTICE_DEBOUNCE_IN_MS);
    debounce(m.persistence.act.save_code, "persistence", EDITOR_SAVE_DEBOUNCE_IN_MS);
  },

  get_permutations(_$, args) {
      let output = "Error parsing JSON";
    
      try {
        let results = [];
        while(results.length < 5) { results.push(_$.act.random_permutation()); }
        let output = results.map(result => `<li>${result}</li>`).join("");
        m.editor.last_permutation = results;
        m.results.act.set_five_sample_results({ text: output });
      } catch(e) {
        m.results.act.set_five_sample_results({ text: `${output}: ${e}` });
      }
  },

  random_permutation(_$, args) {
    const tree  = new Permute(JSON.parse(_$.act.get_value()));
    return tree.one;
  },

  set_default_text(_$, args) {
    _$.act.set_value({ value: m.editor.default_text });
  },

  set_cleared_text(_$, args) {
    _$.act.set_value({ value: `{ 
  "main": [] 
}
    `})
  }
});

m.editor.default_text = `{
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