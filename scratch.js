const string = "I saw a (dog|cat) who was (barking|meowing)";
console.log(
    string.match(/\)./g).length
);