(() => {
    const Permute = require("./permute");
    const files = process.argv.slice(2);
    files.forEach(file => {
        const data = JSON.parse(require('fs').readFileSync(`${file}.json`));
        const tree = new Permute(data);
        tree.permutations.forEach(string => console.log(string));
    });
})();
//# sourceMappingURL=index.js.map