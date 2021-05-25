m.navbar.events(_$ => {
  _$("#rename").addEventListener("click", _$.act.rename);
  _$("#fork").addEventListener("click", _$.act.fork);
  _$("#new").addEventListener("click", _$.act.new_document);
});
