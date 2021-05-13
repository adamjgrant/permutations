(() => {
    const Permute = require("./permute");
    const files = process.argv.slice(2);
    files.forEach(file => {
        const data  = JSON.parse(require('fs').readFileSync(`${file}.json`));
        const tree  = new Permute(data);
        const query = `lang:en exclude:retweets -from:nicegoingadam ${tree.permutations.join(" OR ")}`;

        console.log(`\n${query}\n`);
        console.log(`\nhttps://twitter.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live\n`);
        console.log(`\n${tree.permutations.join("\n")}\n`);
    });
})();
//# sourceMappingURL=index.js.map
