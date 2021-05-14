m.navbar.acts({
  new_document(_$, args) {
    if (confirm("You will lose anything you've entered, are you sure?")) {
      m.persistence.act.clear_local_storage();
      m.persistence.act.set_url_to_id({id: null});
      m.editor.act.set_cleared_text();
    }
  }
});