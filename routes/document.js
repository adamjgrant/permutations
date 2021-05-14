var express = require('express');
var router = express.Router();
const fs = require('fs');

/* SAVE document. */
router.post('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;
  let json_as_string        = JSON.parse(req.body);

  if (JSON.parse(json_as_string)) {
    console.log(typeof(JSON.parse(json_as_string)));
    json_as_string = JSON.stringify(JSON.parse(json_as_string), null, 2);
  }

  fs.writeFile(`documents/${document_id}.json`, json_as_string, function(err) {
    if (err) return console.log(err);
    res.send(`Saved ${json_as_string} as ${document_id}.json`);
  });
});

/* GET raw document */
router.get('/:document_id/raw', function(req, res, next) {
  const document_id = req.params.document_id;

  fs.readFile(`documents/${document_id}.json`, 'utf8' , (err, data) => {
    if (err) {
      console.error(err)
      return
    }
    res.setHeader('Content-Type', 'application/json');
    const response = JSON.stringify(JSON.parse(data), null, 2);

    res.send(response);
  })
});

/* GET document */
router.get('/:document_id', function(req, res, next) {
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
