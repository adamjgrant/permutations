var express = require('express');
var router = express.Router();
const fs = require('fs');

/* SAVE document. */
router.post('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;
  const json        = req.body;

  fs.writeFile(`documents/${document_id}.json`, JSON.stringify(req.body), function(err) {
    if (err) return console.log(err);
    res.send(`Saved ${JSON.stringify(json)} as ${document_id}.json`);
  });
});

/* GET document */
router.get('/:document_id', function(req, res, next) {
  const beautify = require("json-beautify");
  const document_id = req.params.document_id;

  fs.readFile(`documents/${document_id}.json`, 'utf8' , (err, data) => {
    if (err) {
      console.error(err)
      return
    }
    const response = beautify(JSON.parse(data), null, 2, 1);

    res.send(response);
  })
});

module.exports = router;
