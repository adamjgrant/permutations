const string = "I saw a (dog|cat) who was (barking|meowing)";

// const PS = require("./permyscript");
const array = [];
const result = string.split("").reduce((previous, char) => {
   if (char.match(/\(/)) {
       array.push(previous);
       return char;
   }
    else if (char.match(/\)/)) {
        array.push(previous + char);
        return "";
    }
   else {
       return previous + char;
   }
}, "");

console.log(array);
