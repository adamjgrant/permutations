var express = require('express');
var router = express.Router();
const fs = require('fs');
const s3 = require("s3-client");
const logger = require("../winston");

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
    let json_as_string = JSON.parse(req.body);

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
        } else {
            res.send(`Saved ${json_as_string} as ${document_id}.json`);
        }
    });
});

/* RENAME document. */
router.put('/:document_id', function(req, res) {
    logger.log({
        level: "info",
        message: `${req.body}`
    });
    const document_id = req.params.document_id;
    const new_name = req.body.new_name;

    fs.rename(`documents/${document_id}.json`, `documents/${new_name}.json`, function(err) {
        if (err) return console.log(err);
        res.send(`Renamed ${document_id}.json to ${new_name}.json`);
    });
});

/* GET raw document */
router.get('/:document_id/raw', function(req, res, next) {
    get_document(req, res, next, true);
});

/* GET document */
router.get('/:document_id', function(req, res, next) {
    get_document(req, res, next, false);
});

const get_document = (req, res, next, as_json = false) => {
    const document_id = req.params.document_id;
    const file_path = `documents/${document_id}.json`;

    const read_local_file = () => {
        fs.readFile(file_path, 'utf8', (err, data) => {
            if (err) {
                console.error(err)
                res.status(500).send(err)
                return
            }
            try {
                if (as_json) {
                    res.setHeader('Content-Type', 'application/json');
                    const response = JSON.stringify(JSON.parse(data), null, 2);

                    res.send(response);
                } else {
                    res.send(data);
                }
            } catch (err) {
                res.status(500).send(err);
            }
        })
    }

    if (process.env.environment === "prod" && !fs.existsSync(file_path)) {
        const downloader = downloader_for_s3(file_path);
        downloader.on('error', (err) => {
            console.log(err);
            res.status(500).send(err);
        });

        downloader.on('end', read_local_file);
    } else { read_local_file(); }
}

const downloader_for_s3 = (file_path) => {
    const params = {
        localFile: file_path,
        s3Params: {
            Bucket: "static.everything.io",
            Key: `permy.link/${file_path}`
        }
    };

    return s3_client.downloadFile(params);
}

module.exports = router;