const EDITOR_SAVE_DEBOUNCE_IN_MS = 1500;
const EDITOR_PERMUTE_DEBOUNCE_IN_MS = 500;
const EDITOR_SET_ALL_NOTICE_DEBOUNCE_IN_MS = 1000;

m.editor.events(_$ => {
    m.editor.act.self().on("change", (instance, changeObj) => {
        k$.status({
            text: "Permuting...",
            type: "status-blue"
        })
        debounce(permute, "editor", EDITOR_PERMUTE_DEBOUNCE_IN_MS);
        debounce(setAllNotice, "set_all_notice", EDITOR_SET_ALL_NOTICE_DEBOUNCE_IN_MS);
        debounce(m.persistence.act.save_code, "persistence", EDITOR_SAVE_DEBOUNCE_IN_MS);
    });
})