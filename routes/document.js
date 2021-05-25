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

/* RENAME document. */
router.put('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;
  const new_name        = req.body.new_name;

  fs.rename(`documents/${document_id}.json`, `documents/${new_name}.json`, function(err) {
    if (err) return console.log(err);
    res.send(`Saved ${JSON.stringify(json)} as ${document_id}.json`);
  });
});

/* GET raw document */
router.get('/:document_id/raw', function(req, res, next) {
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

/* GET document */
router.get('/:document_id', function(req, res, next) {
  const beautify = require("json-beautify");
  const document_id = req.params.document_id;

  fs.readFile(`documents/${document_id}.json`, 'utf8' , (err, data) => {
    if (err) {
      console.error(err)
      return
    }
    res.setHeader('Content-Type', 'application/json');
    const response = beautify(JSON.parse(data), null, 2, 1);

    res.send(response);
  })
});

module.exports = router;
