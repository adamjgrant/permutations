(() => {
    const Permute = require("./permute");
    const assert = (name, expected, input) => {
        const actual = new Permute(input).permutations;
        if (JSON.stringify(expected) === JSON.stringify(actual))
            return `PASS: ${name}`;
        else
            return `FAIL: ${name}. Expected: ${expected}, Actual: ${actual}`;
    };
    let tests = [
        {
            name: "Simple single string test",
            input: { "main": ["foo"] },
            expected: ['foo']
        },
        {
            name: "Array of two items",
            input: {
                "main": [
                    "foo", "bar"
                ]
            },
            expected: [
                "foo",
                "bar"
            ]
        },
        {
            name: "String, then array",
            input: {
                "main": [
                    "foo", [
                        "bar", "fizz"
                    ]
                ]
            },
            expected: [
                'foobar',
                'foofizz'
            ]
        },
        {
            name: "Array then array",
            input: {
                "main": [
                    "foo", "bar", [
                        "fizz", "flop"
                    ]
                ]
            },
            expected: "foofizz,fooflop,barfizz,barflop".split(",")
        },
        {
            name: "String, then array, then string",
            input: {
                "main": [
                    "foo", [
                        "bar", "fizz", [
                            "flop"
                        ]
                    ]
                ]
            },
            expected: [
                'foobarflop',
                'foofizzflop'
            ]
        },
        {
            name: "Array, then string, then array",
            input: {
                "main": [
                    "foo", "bar", [
                        "fizz", [
                            "buzz", "flop"
                        ]
                    ]
                ]
            },
            expected: "foofizzbuzz,foofizzflop,barfizzbuzz,barfizzflop".split(",")
        },
        {
            name: "Single item arrays",
            input: {
                "main": [
                    "foo", ["bar", ["fizz"]]
                ]
            },
            expected: ["foobarfizz"]
        },
        {
            name: "Array then branch",
            input: {
                "main": [
                    "foo", { "branch": "something_else" }
                ],
                "something_else": [
                    "bar"
                ]
            },
            expected: ["foobar"]
        },
        {
            name: "Array then branch with array",
            input: {
                "main": [
                    "foo", { "branch": "something_else" }
                ],
                "something_else": [
                    "bar", [
                        "fizz"
                    ]
                ]
            },
            expected: ["foobarfizz"]
        },
        {
            name: "Array then branch with array, all arrays with multiple items",
            input: {
                "main": [
                    "a", "b", { "branch": "something_else" }
                ],
                "something_else": [
                    "c", "d", [
                        "e", "f"
                    ]
                ]
            },
            expected: "ace,acf,ade,adf,bce,bcf,bde,bdf".split(",")
        },
        {
            name: "Nested branches",
            input: {
                "main": [
                    "a", "b", {
                        "branch": "level1"
                    }
                ],
                "level1": [
                    "c", "d", { "branch": "level2" }
                ],
                "level2": [
                    "e", "f", [
                        "g"
                    ]
                ]
            },
            expected: "aceg,acfg,adeg,adfg,bceg,bcfg,bdeg,bdfg".split(",")
        },
        {
            name: "Multiple branches on the same level",
            input: {
                "main": [
                    "a", "b", [
                        "c", { "branch": "branch_a" }
                    ], [
                        "d", { "branch": "branch_b" }
                    ]
                ],
                "branch_a": [
                    "e", "f"
                ],
                "branch_b": [
                    "g", "h"
                ]
            },
            expected: "ace,acf,adg,adh,bce,bcf,bdg,bdh".split(",")
        },
        {
            name: "Array with multiple arrays",
            input: {
                "main": [
                    "a", [
                        "b", "c", [
                            "d"
                        ],
                        "e", "f", [
                            "g"
                        ]
                    ]
                ]
            },
            expected: "abd,abg,acd,acg,aed,aeg,afd,afg".split(",")
        },
        {
            name: "Return values in branch references",
            input: {
                "main": [
                    "",
                    ["a", { "branch": "other", "then": ["x"] }],
                    ["b", { "branch": "other", "then": ["y"] }]
                ],
                "other": ["-"]
            },
            expected: "a-x,b-y".split(",")
        },
        {
            name: "Start branches without leaves",
            input: {
                "main": [
                    ["a", ["b", "x"]],
                    ["c", ["d", "y"]]
                ]
            },
            expected: "ab,ax,cd,cy".split(",")
        },
        {
            name: "Have branches lower down without leaves",
            input: {
                "main": [
                    "p", [
                        ["a", ["b", "x"]],
                        ["c", ["d", "y"]]
                    ]
                ]
            },
            expected: "pab,pax,pcd,pcy".split(",")
        },
        {
            name: "Use string as 'then' branch",
            input: {
                "main": [
                    "a", { "branch": "foo", "then": "c" }
                ],
                "foo": ["b"]
            },
            expected: ["abc"]
        },
        {
            name: "Weird callback chaining",
            input: {
                "main": [
                    "a", { "branch": "foo", "then": "c" }
                ],
                "foo": ["b", { "branch": "bar", "then": "d" }],
                "bar": ["e"]
            },
            expected: ["abed", "abc"]
        },
        {
            name: "Callback chaining with stuff after it",
            input: {
                "main": [
                    "a", { "branch": "foo", "then": "c" }, [
                        "x", "y"
                    ]
                ],
                "foo": ["-"]
            },
            expected: "a-c,ax,ay".split(",")
        },
        {
            name: "idk, lol",
            input: {
                main: [
                    "a", "b", [
                        "c", "d", ["e"], [
                            "f", ["i", "j", ["k"]], "g", ["h"]
                        ]
                    ], "z"
                ]
            },
            expected: "ace,acfik,acfjk,acfh,acgik,acgjk,acgh,ade,adfik,adfjk,adfh,adgik,adgjk,adgh,bce,bcfik,bcfjk,bcfh,bcgik,bcgjk,bcgh,bde,bdfik,bdfjk,bdfh,bdgik,bdgjk,bdgh,zce,zcfik,zcfjk,zcfh,zcgik,zcgjk,zcgh,zde,zdfik,zdfjk,zdfh,zdgik,zdgjk,zdgh".split(",")
        },
        {
            name: "Branch linking with nested then redirection",
            input: {
                "main": [
                    "A", { "branch": "C", "then": [
                            "D"
                        ] }
                ],
                "C": [
                    "F", { "branch": "H", "then": ["K", ["M"]] }
                ],
                "H": ["J"]
            },
            expected: ["AFJKMD"]
        },
        {
            name: "A sampling factor of 10 produces only 10% of the results.",
            input: {
                "main": [
                    "0", "0", [
                        "0000000000".split("")
                    ]
                ]
            },
            expected: ["00", "00"]
        },
        {
            name: "A sampling factor of 100 produces only 1% of the results.",
            input: {
                "main": [
                    "0", "0", [
                        { branch: "ten_zeroes", then: { branch: "ten_zeroes" } }
                    ]
                ],
                "ten_zeroes": "0000000000".split("")
            },
            expected: ["000", "000"]
        },
    ];
    // let results = [14].map(x => tests[x]).map((test, index) => {
    let results = tests.map((test, index) => {
        const prefix = `#${index}. `;
        const result = (() => {
            try {
                return assert(test.name, test.expected, test.input);
            }
            catch (e) {
                return `Error: ${e}`;
            }
        })();
        return `${prefix}${result}`;
    });
    results.forEach(result => console.log(result));
})();
//# sourceMappingURL=test.js.map