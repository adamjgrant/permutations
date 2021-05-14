var express = require('express');
var router = express.Router();
const fs = require('fs');

/* SAVE document. */
router.post('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;
  const json        = req.body.json;

  res.send(`Saved ${JSON.stringify(json)} as ${document_id}.json`);
});

/* GET document */
router.get('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;

  res.send(document_id);
});

module.exports = router;
