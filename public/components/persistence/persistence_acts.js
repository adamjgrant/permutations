m.persistence.acts({
    save_code(_$, args) {
        _$.act.save_id_to_localstorage({ document_id: _$.act.get_document_id() });
        _$.act.set_url_to_id({ id: _$.act.get_document_id() });
        _$.act.save_to_file({ data: m.editor.act.get_value() });
        // return localStorage.setObject("code", m.editor.act.get_value()); // TODO: Removing this for now.
    },

    load_code_from_localhost(_$, args) {
        return null; // TODO: This is just messing up too much stuff right now.
        return localStorage.getObject("code");
    },

    set_initial_state(_$, args) {
        const local_data = _$.act.load_code_from_localhost();
        /*
            if (local_data) {
              m.editor.act.set_value({value: local_data});
            }
        */

        if (_$.act.get_document_id()) {
            _$.act.load_from_file().then(data => {
                if (local_data !== data) {
                    m.editor.act.set_value(data);
                };
                return
            })
        } else {
            console.log("No document ID found");
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
        const address_id = _$.act.find_document_id_from_url();
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
                m.editor.act.set_value({ value: file_contents });
                _$.act.save_code();
            });
            return address_id;
        }
    },

    load_from_file(_$, args) {
        k$.status({ text: "Loading JSON..." });
        return new Promise((resolve, reject) => {
            var request = new XMLHttpRequest();
            const document_id = (args || {})['document_id'] || _$.act.get_document_id();
            if (!document_id) reject("No document ID provided");
            request.open('GET', `/document/${document_id}`, true);

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

    rename_file(_$, args) {
        // Sanitize this for a URL
        args.new_name = slugify(args.new_name);
        console.log(args.new_name);

        return new Promise((resolve, reject) => {
            _$.act.load_from_file({ document_id: args.new_name }).then(data => {
                reject(`Name ${args.new_name} is already in use.`)
            }).catch(err => {
                console.log("Name available.");

                var request = new XMLHttpRequest();
                request.open('PUT', `/document/${_$.act.get_document_id()}`, true);
                request.setRequestHeader('Content-Type', 'application/json');

                request.onload = function() {
                    if (this.status >= 200 && this.status < 400) {
                        // Success!
                        resolve(args.new_name);
                    } else {
                        // We reached our target server, but it returned an error
                        reject("Could not load URL");
                    }
                };

                request.onerror = function() {
                    // There was a connection error of some sort
                    reject("Could not load URL");
                };

                request.send(JSON.stringify(args));
            })
        });
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
            request.onload = function() {
                k$.status({ text: "💾 Saved", type: "status-green" })
            }

        },

        find_document_id_from_url(_$, args) {
            const matches = location.pathname.match(/\/([\d\w\-]+)/);
            if (matches && matches.length >= 2 && matches[1]) {
                return matches[1];
            } else { return null; }
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

const slugify = (text) => {
    text = text.toString().toLowerCase().trim()

    const sets = [
        { to: "a", from: "[ÀÁÂÃÅÆĀĂĄẠẢẤẦẨẪẬẮẰẲẴẶ]" },
        { to: "ae", from: "[Ä]" },
        { to: "c", from: "[ÇĆĈČ]" },
        { to: "d", from: "[ÐĎĐÞ]" },
        { to: "e", from: "[ÈÉÊËĒĔĖĘĚẸẺẼẾỀỂỄỆ]" },
        { to: "g", from: "[ĜĞĢǴ]" },
        { to: "h", from: "[ĤḦ]" },
        { to: "i", from: "[ÌÍÎÏĨĪĮİỈỊ]" },
        { to: "j", from: "[Ĵ]" },
        { to: "ij", from: "[Ĳ]" },
        { to: "k", from: "[Ķ]" },
        { to: "l", from: "[ĹĻĽŁ]" },
        { to: "m", from: "[Ḿ]" },
        { to: "n", from: "[ÑŃŅŇ]" },
        { to: "o", from: "[ÒÓÔÕØŌŎŐỌỎỐỒỔỖỘỚỜỞỠỢǪǬƠ]" },
        { to: "oe", from: "[ŒÖ]" },
        { to: "p", from: "[ṕ]" },
        { to: "r", from: "[ŔŖŘ]" },
        { to: "s", from: "[ŚŜŞŠ]" },
        { to: "ss", from: "[ß]" },
        { to: "t", from: "[ŢŤ]" },
        { to: "u", from: "[ÙÚÛŨŪŬŮŰŲỤỦỨỪỬỮỰƯ]" },
        { to: "ue", from: "[Ü]" },
        { to: "w", from: "[ẂŴẀẄ]" },
        { to: "x", from: "[ẍ]" },
        { to: "y", from: "[ÝŶŸỲỴỶỸ]" },
        { to: "z", from: "[ŹŻŽ]" },
        { to: "-", from: "[·/_,:;']" },
    ]

    sets.forEach((set) => {
        text = text.replace(new RegExp(set.from, "gi"), set.to)
    })

    text = text
        .toString()
        .toLowerCase()
        .replace(/\s+/g, "-") // Replace spaces with -
        .replace(/&/g, "-and-") // Replace & with 'and'
        .replace(/[^\w\-]+/g, "") // Remove all non-word chars
        .replace(/\--+/g, "-") // Replace multiple - with single -
        .replace(/^-+/, "") // Trim - from start of text
        .replace(/-+$/, "") // Trim - from end of text

    if (typeof separator !== "undefined" && separator !== "-") {
        text = text.replace(/-/g, separator)
    }

    return text
}

m.persistence.document_id = null;