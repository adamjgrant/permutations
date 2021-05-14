m.editor.events(_$ => {
  m.editor.act.self().on("change", (instance, changeObj) => {
    k$.status({
      text: "Permuting...", type: "status-blue"
    })
    debounce(permute, "editor", 500);
    debounce(setAllNotice, "set_all_notice", 1000);
    debounce(m.persistence.act.save_code, "persistence", 800);
  });
})