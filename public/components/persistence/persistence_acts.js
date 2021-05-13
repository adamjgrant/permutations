m.persistence.acts({
  save(_$, args) {
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
  }
});