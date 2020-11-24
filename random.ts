(() => {
    const Permute = require("./permute");
    const files = process.argv.slice(2);
    files.forEach(file => {
        const data = JSON.parse(require('fs').readFileSync(`${file}.json`));
        const tree = new Permute(data, true);

        const permutations = tree.permutations;
        console.log(permutations[0]);
    })
})();