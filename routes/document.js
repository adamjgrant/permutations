var express = require('express');
var router = express.Router();
const fs = require('fs');

/* SAVE document. */
router.post('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;
  const json_as_string        = req.body;

  fs.writeFile(`documents/${document_id}.json`, json_as_string, function(err) {
    if (err) return console.log(err);
    res.send(`Saved ${json_as_string} as ${document_id}.json`);
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
    res.setHeader('Content-Type', 'application/json');
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
    try {
      if (JSON.parse(data)) {
        const response = beautify(JSON.parse(data), null, 2, 1);
      }
      else {
        const response = data;
      }

      res.send(response);
    } catch(err) {
      res.send(data);
    }
  })
});

module.exports = router;
