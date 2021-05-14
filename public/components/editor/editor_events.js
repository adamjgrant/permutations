m.editor.events(_$ => {
  if (!m.editor.self) {
    m.editor.self = CodeMirror.fromTextArea(document.getElementById("code"), {
      matchBrackets: true,
      autoCloseBrackets: true,
      mode: "application/ld+json",
      lineWrapping: true,
      lineNumbers: true,
      theme: "solarized dark"
    });

    m.editor.self.on("change", (instance, changeObj) => {
      k$.status({
        text: "Permuting...", type: "status-blue"
      })
      debounce(permute, "editor", 500);
      debounce(setAllNotice, "set_all_notice", 1000);
      debounce(m.persistence.act.save_code, "persistence", 800);
    });
  };
})