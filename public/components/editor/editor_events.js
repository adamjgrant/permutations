m.editor.events(_$ => {
    _$.act.self().on("change", _$.act.permute);
    _$.act.self().on("keyup", _$.act.permute);

    _$.act.get_permutations();
})