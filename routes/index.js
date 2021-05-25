var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/raw', function(req, res, next) {
  res.redirect(`/document${req.originalUrl}`);
})

module.exports = router;
