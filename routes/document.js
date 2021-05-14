var express = require('express');
var router = express.Router();
const fs = require('fs');
const s3 = require("s3-client");

const s3_client = s3.createClient({
  s3Options: {
    region: 'us-west-1',
    accessKeyId: process.env.aws_access_key_id,
    secretAccessKey: process.env.aws_secret_access_key,
    //http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
  }
});

/* SAVE document. */
router.post('/:document_id', function(req, res, next) {
  const document_id = req.params.document_id;
  let json_as_string        = JSON.parse(req.body);

  if (JSON.parse(json_as_string)) {
    json_as_string = JSON.stringify(JSON.parse(json_as_string), null, 2);
  }

  const file_path = `documents/${document_id}.json`;

  fs.writeFile(file_path, json_as_string, function(err) {
    if (err) return console.log(err);

    if (process.env.environment === "prod") {
      const params = {
        localFile: file_path,
        s3Params: {
          Bucket: "static.everything.io",
          Key: `permy.link/${file_path}`
        }
      };

      const uploader = s3_client.uploadFile(params);
      uploader.on('error', function(err) {
        res.status(500).send(err);
      })

      uploader.on('end', function() {
        res.send(`Saved ${json_as_string} as ${document_id}.json`);
      });
    }
    else {
      res.send(`Saved ${json_as_string} as ${document_id}.json`);
    }
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

  if (process.env.environment === "prod") {

  }
  else {
    fs.readFile(`documents/${document_id}.json`, 'utf8', (err, data) => {
      if (err) {
        console.error(err)
        res.status(500).send(err)
        return
      }
      try {
        res.send(data);
      } catch (err) {
        res.status(500).send(err);
      }
    })
  }
});

module.exports = router;
