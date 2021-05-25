m.navbar.acts({
  rename(_$, opts) {
    const new_name = prompt("Select a new name");
    return m.persistence.act.rename_file({ new_name: new_name });
  },

  fork(_$, opts) {
        alert("Sorry, not yet implemented.");
  }
});