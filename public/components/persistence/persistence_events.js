m.persistence.events(_$ => {
  const document_id = _$.act.get_document_id();
  console.log(document_id);
});