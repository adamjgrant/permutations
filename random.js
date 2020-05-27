(() => {
    const Permute = require("./permute");
    const files = process.argv.slice(2);
    files.forEach(file => {
        const data = JSON.parse(require('fs').readFileSync(`${file}.json`));
        const tree = new Permute(data);
        const permutations = tree.permutations;
        console.log(permutations[Math.floor(Math.random() * permutations.length)]);
    });
})();
//# sourceMappingURL=random.js.map