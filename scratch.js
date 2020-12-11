const string = "I saw a (dog|cat) who was (barking|meowing)";

const PS = require("./permyscript");

console.log(
    "abc(def)ghi".replace(/(\(.*\))/,
        (match, p1) => { return {} }
    )
)
