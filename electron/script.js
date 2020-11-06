const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  matchBrackets: true,
  autoCloseBrackets: true,
  mode: "application/ld+json",
  lineWrapping: true
});

editor.on("change", (instance, changeObj) => {
  console.log(instance, changeObj);
  console.log(editor.getValue());
})
