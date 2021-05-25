m.navbar.acts({
    rename(_$, args) {
        const new_name = prompt("Select a new name");
        return m.persistence.act.rename_file({ new_name: new_name }).then(slug => {
            location.href = `/${slug}`;
        }).catch(err => {
            alert(err);
        });
    },

    fork(_$, opts) {
        m.persistence.act.clear_local_storage();
        m.persistence.act.set_url_to_id({ id: null });
        m.persistence.act.save_code();
    },

    new_document(_$, args) {
        if (confirm("You will lose anything you've entered, are you sure?")) {
            m.persistence.act.clear_local_storage();
            m.persistence.act.set_url_to_id({ id: null });
            m.editor.act.set_cleared_text();
        }
    }
});