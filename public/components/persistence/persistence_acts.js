m.persistence.acts({
  save_code(_$, args) {
    localStorage.setObject("document_id", _$.act.get_document_id());
    return localStorage.setObject("code", m.editor.act.get_value());
  },

  load(_$, args) {
    return localStorage.getObject("code");
  },

  set_initial_state(_$, args) {
    if (_$.act.load().length) {
      m.editor.act.set_value({ value: _$.act.load() });
    }
    else {
      m.editor.act.set_default_text();
    }
  },

  get_document_id(_$, args) {
    const address_url = _$.act.find_document_id_from_url();
    // SCENARIO 1: ADDRESS NO ID - LOCALSTORAGE NO ID
    //   Create a new one, save it to localstorage, create a new file for writing.
    const new_id = _$.act.generate_a_new_document_id();
    // SCENARIO 2: ADDRESS NO ID - LOCALSTORAGE HAS ID
    //   Set the address to be the ID from localstorage and load from localstorage.
    // SCENARIO 3: ADDRESS HAS ID - LOCALSTORAGE NO ID
    //   Use address's ID. Load from file, save ID and file contents to localstorage.
    // SCENARIO 4: ADDRESS HAS ID - LOCALSTORAGE HAS ID
    //   Same as SCENARIO 3.
  },

  priv: {
    load_from_file(_$, args) {

    },

    save_to_file(_$, args) {

    },

    find_document_id_from_url(_$, args) {

    },

    generate_a_new_document_id(_$, args) {
      return parseInt(`${Math.floor(Math.random() * 1000)}${Date.now()}`).toString(36);
    }
  }
});