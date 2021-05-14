m.editor.acts({
  set_value(_$, args) {
    return m.editor.self.setValue(args.value);
  },

  get_value(_$, args) {
    return m.editor.self.getValue();
  },

  beautify(_$, args) {

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