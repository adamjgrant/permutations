m.persistence.acts({
  save_code(_$, args) {
    _$.act.save_id_to_localstorage({ document_id: _$.act.get_document_id() });
    _$.act.set_url_to_id({ id: _$.act.get_document_id() });
    _$.act.save_to_file({ data: m.editor.act.get_value() });
    return localStorage.setObject("code", m.editor.act.get_value());
  },

  load_code_from_localhost(_$, args) {
    return null; // TODO: This is just messing up too much stuff right now.
    return localStorage.getObject("code");
  },

  set_initial_state(_$, args) {
    const local_data = _$.act.load_code_from_localhost();
    if (local_data) {
      m.editor.act.set_value({value: local_data});
    }
    else if (_$.act.get_document_id()) {
      _$.act.load_from_file().then(data => {
        if (local_data !== data) {
          m.editor.act.set_value(data);
        }
        ;
        return
      })
    }
    else {
      m.editor.act.set_default_text();
    }
  },

  set_url_to_id(_$, args) {
    if (!args.id) {
      return history.replaceState(null, "New Document", '/');
    }
    history.replaceState(null, args.id, `/${args.id}`);
  },

  get_document_id(_$, args) {
    if (m.persistence.document_id) return m.persistence.document_id;
    const address_id      = _$.act.find_document_id_from_url();
    const localstorage_id = _$.act.get_id_from_localstorage();

    // SCENARIO 1: ADDRESS NO ID - LOCALSTORAGE NO ID
    //   Create a new one, save it to localstorage, create a new file for writing.
    if (!address_id && !localstorage_id) {
      const new_id = _$.act.generate_a_new_document_id();
      _$.act.save_id_to_localstorage({ document_id: new_id });
      _$.act.save_to_file({ data: m.editor.act.get_value() });
      _$.act.set_url_to_id({ id: _$.act.get_id_from_localstorage() });
      return new_id;
    }

    // SCENARIO 2: ADDRESS NO ID - LOCALSTORAGE HAS ID
    //   Set the address to be the ID from localstorage
    if (!address_id && localstorage_id) {
      _$.act.set_url_to_id({ id: _$.act.get_id_from_localstorage() });
      return localstorage_id;
    }

    // SCENARIO 3: ADDRESS HAS ID - LOCALSTORAGE NO ID
    //   Use address's ID. Load from file, save ID and file contents to localstorage.
    // SCENARIO 4: ADDRESS HAS ID - LOCALSTORAGE HAS ID
    //   Same as SCENARIO 3.
    if (address_id) {
      _$.act.save_id_to_localstorage({ document_id: address_id });
      _$.act.load_from_file().then(file_contents => {
        m.editor.act.set_value({value: file_contents});
        _$.act.save_code();
      });
    }
  },

  load_from_file(_$, args) {
    return new Promise((resolve, reject) => {
      var request = new XMLHttpRequest();
      if (!_$.act.get_document_id()) reject("No document ID provided");
      request.open('GET', `/document/${_$.act.get_document_id()}`, true);

      request.onload = function() {
        if (this.status >= 200 && this.status < 400) {
          // Success!
          resolve(this.response);
        } else {
          // We reached our target server, but it returned an error
          reject("Could not load URL");
        }
      };

      request.onerror = function() {
        // There was a connection error of some sort
        reject("Could not load URL");
      };

      request.send();
    })
  },

  clear_local_storage(_$, args) {
    m.persistence.document_id = null;
    localStorage.removeItem("document_id");
    localStorage.removeItem("code");
  },

  priv: {
    save_to_file(_$, args) {
      if (!_$.act.get_document_id()) return
      const json_as_string = JSON.stringify(args.data);

      var request = new XMLHttpRequest();
      request.open('POST', `/document/${_$.act.get_document_id()}`, true);
      request.setRequestHeader('Content-Type', 'text/plain');
      request.send(json_as_string);
      request.onerror = (err) => {
        return err;
      };

    },

    find_document_id_from_url(_$, args) {
      const matches = location.pathname.match(/\/([\d\w]+)/);
      if (matches && matches.length >= 2 && matches[1]) {
        return matches[1];
      }
      else { return null; }
    },

    generate_a_new_document_id(_$, args) {
      return parseInt(`${Math.floor(Math.random() * 1000)}${Date.now()}`).toString(36);
    },

    get_id_from_localstorage(_$, args) {
      return localStorage.getItem("document_id");
    },

    save_id_to_localstorage($, args) {
      m.persistence.document_id = args.document_id;
      return localStorage.setItem("document_id", args.document_id);
    }
  }
});

m.persistence.document_id = null;