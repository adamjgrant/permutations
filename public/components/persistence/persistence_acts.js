m.persistence.acts({
  save_code(_$, args) {
    localStorage.setObject("document_id", _$.act.get_document_id());
    return localStorage.setObject("code", m.editor.act.get_value());
  },

  load_code(_$, args) {
    return localStorage.getObject("code");
  },

  set_initial_state(_$, args) {
    if (_$.act.load_code().length) {
      m.editor.act.set_value({ value: _$.act.load_code() });
    }
    else {
      m.editor.act.set_default_text();
    }
  },

  get_document_id(_$, args) {
    const address_id      = _$.act.find_document_id_from_url();
    const localstorage_id = _$.act.get_id_from_localstorage();

    console.log(address_id, localstorage_id);

    // SCENARIO 1: ADDRESS NO ID - LOCALSTORAGE NO ID
    //   Create a new one, save it to localstorage, create a new file for writing.
    if (!address_id && !localstorage_id) {
      const new_id = _$.act.generate_a_new_document_id();
      _$.act.save_id_to_localstorage({ document_id: new_id });
      _$.act.save_to_file({ data: m.editor.act.get_value() });
      return new_id;
    }

    // SCENARIO 2: ADDRESS NO ID - LOCALSTORAGE HAS ID
    //   Set the address to be the ID from localstorage
    if (!address_id && localstorage_id) {
      // TODO Set URL
      return localstorage_id;
    }

    // SCENARIO 3: ADDRESS HAS ID - LOCALSTORAGE NO ID
    //   Use address's ID. Load from file, save ID and file contents to localstorage.
    // SCENARIO 4: ADDRESS HAS ID - LOCALSTORAGE HAS ID
    //   Same as SCENARIO 3.
  },

  priv: {
    load_from_file(_$, args) {
      var request = new XMLHttpRequest();
      request.open('GET', `/document/${_$.act.get_document_id()}`, true);

      request.onload = function() {
        if (this.status >= 200 && this.status < 400) {
          // Success!
          return this.response;
        } else {
          // We reached our target server, but it returned an error
          console.error("Could not load URL");
          return
        }
      };

      request.onerror = function() {
        // There was a connection error of some sort
        console.error("Could not load URL");
        return
      };

      request.send();
    },

    save_to_file(_$, args) {
      var request = new XMLHttpRequest();
      request.open('POST', `/document/${_$.act.get_document_id()}`, true);
      request.setRequestHeader('Content-Type', 'application/json');
      request.send(args.data);
    },

    find_document_id_from_url(_$, args) {
      return undefined; // TODO
    },

    generate_a_new_document_id(_$, args) {
      return parseInt(`${Math.floor(Math.random() * 1000)}${Date.now()}`).toString(36);
    },

    get_id_from_localstorage(_$, args) {
      return localStorage.getItem("document_id");
    },

    save_id_to_localstorage($, args) {
      return localStorage.setItem("document_id", args.document_id);
    }
  }
});