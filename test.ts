(() => {
    const Permute = require("./permute");
    const assert = (name: string, expected: string[], input: object) => {
        const actual = new Permute(input).permutations;
        if (JSON.stringify(expected) === JSON.stringify(actual)) return `PASS: ${name}`
        else return `---FAIL: ${name}. Expected: ${expected}, Actual: ${actual}`
    }

    let tests = [
        {
            name: "Simple single string test"
            , input: {"main": ["foo"]}
            , expected: ['foo']
        }

        , {
            name: "Array of two items"
            , input: {
                "main": [
                    "foo", "bar"
                ]
            }
            , expected: [
                "foo"
                , "bar"
            ]
        },

        {
            name: "String, then array"
            , input: {
                "main": [
                    "foo", [
                        "bar", "fizz"
                    ]
                ]
            }
            , expected: [
                'foobar'
                , 'foofizz'
            ]
        }

        , {
            name: "Array then array"
            , input: {
                "main": [
                    "foo", "bar", [
                        "fizz", "flop"
                    ]
                ]
            }
            , expected: "foofizz,fooflop,barfizz,barflop".split(",")
        }

        , {
            name: "String, then array, then string"
            , input: {
                "main": [
                    "foo", [
                        "bar", "fizz", [
                            "flop"
                        ]
                    ]
                ]
            }
            , expected: [
                'foobarflop'
                , 'foofizzflop'
            ]
        }

        , {
            name: "Array, then string, then array"
            , input: {
                "main": [
                    "foo", "bar", [
                        "fizz", [
                            "buzz", "flop"
                        ]
                    ]
                ]
            }
            , expected: "foofizzbuzz,foofizzflop,barfizzbuzz,barfizzflop".split(",")
        }

        , {
            name: "Single item arrays"
            , input: {
                "main": [
                    "foo", ["bar", ["fizz"]]
                ]
            }
            , expected: ["foobarfizz"]
        }

        , {
            name: "Array then branch"
            , input: {
                "main": [
                    "foo", {"branch": "something_else"}
                ],
                "something_else": [
                    "bar"
                ]
            }
            , expected: ["foobar"]
        }

        , {
            name: "Array then branch with array"
            , input: {
                "main": [
                    "foo", {"branch": "something_else"}
                ],
                "something_else": [
                    "bar", [
                        "fizz"
                    ]
                ]
            }
            , expected: ["foobarfizz"]
        }

        , {
            name: "Array then branch with array, all arrays with multiple items"
            , input: {
                "main": [
                    "a", "b", {"branch": "something_else"}
                ],
                "something_else": [
                    "c", "d", [
                        "e", "f"
                    ]
                ]
            }
            , expected: "ace,acf,ade,adf,bce,bcf,bde,bdf".split(",")
        }

        , {
            name: "Nested branches"
            , input: {
                "main": [
                    "a", "b", {
                        "branch": "level1"
                    }
                ],
                "level1": [
                    "c", "d", {"branch": "level2"}
                ],
                "level2": [
                    "e", "f", [
                        "g"
                    ]
                ]
            }
            , expected: "aceg,acfg,adeg,adfg,bceg,bcfg,bdeg,bdfg".split(",")
        }

        , {
            name: "Multiple branches on the same level"
            , input: {
                "main": [
                    "a", "b", [
                        "c", {"branch": "branch_a"}
                    ], [
                        "d", {"branch": "branch_b"}
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
        }

        , {
            name: "Array with multiple arrays"
            , input: {
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
        }

        , {
          name: "Return values in branch references"
          , input: {
            "main": [
              ""
              , ["a",  { "branch": "other", "then": ["x"] }]
              , ["b", { "branch": "other", "then": ["y"] }]
            ]
            , "other": ["-"]
          }
          , expected: "a-x,b-y".split(",")
        }

        , {
            name: "Start branches without leaves"
            , input: {
                "main": [
                    ["a", ["b", "x"]]
                    , ["c", ["d", "y"]]
                ]
            }
            , expected: "ab,ax,cd,cy".split(",")
        }

        , {
            name: "Have branches lower down without leaves"
            , input: {
                "main": [
                    "p", [
                        ["a", ["b", "x"]]
                        , ["c", ["d", "y"]]
                    ]
                ]
            }
            , expected: "pab,pax,pcd,pcy".split(",")
        }

        , {
          name: "Use string as 'then' branch"
          , input: {
            "main": [
              "a", { "branch": "foo", "then": "c" }
            ]
            , "foo": [ "b" ]
          }
          , expected: ["abc"]
        }

        , {
          name: "Weird callback chaining"
          , input: {
            "main": [
              "a", { "branch": "foo", "then": "c" }
            ]
            , "foo": ["b", { "branch": "bar", "then": "d" }]
            , "bar": ["e"]
          }
          , expected: ["abed","abc"]
        }

        , {
            name: "Callback chaining with stuff after it"
            , input: {
                "main": [
                  "a", { "branch": "foo", "then": "c"}, [
                      "x", "y"
                    ]
                ],
                "foo": ["-"]
            }
            , expected: "a-c,ax,ay".split(",")
        }
        , {
          name: "idk, lol"
          , input: {
              main: [
                  "a", "b", [
                      "c", "d", ["e"], [
                          "f", ["i", "j", ["k"]], "g", ["h"]
                      ]
                  ], "z"
              ]
          }
          , expected: "ace,acfik,acfjk,acfh,acgik,acgjk,acgh,ade,adfik,adfjk,adfh,adgik,adgjk,adgh,bce,bcfik,bcfjk,bcfh,bcgik,bcgjk,bcgh,bde,bdfik,bdfjk,bdfh,bdgik,bdgjk,bdgh,zce,zcfik,zcfjk,zcfh,zcgik,zcgjk,zcgh,zde,zdfik,zdfjk,zdfh,zdgik,zdgjk,zdgh".split(",")
        }

        , {
          name: "Branch linking with nested then redirection"
          , input: {
                "main": [
                    "A", { "branch": "C", "then": [
                            "D"
                        ]}
                ],
                "C": [
                    "F", { "branch":  "H", "then": ["K", ["M"]] }
                ],
                "H": ["J"]
            }
          , expected: ["AFJKMD"]
        }

        , {
            name: "Branch nesting with two embedded redirects"
            , input: {
                "main": [
                    { "branch": "A", "then": { "branch": "D" }}
                ],
                "A": [
                    "a", { "branch": "B", "then": { "branch": "C" } }
                ],
                "B": [ "b" ],
                "C": [ "c" ],
                "D": [ "d" ]
            }
            , expected: ["abcd"]
        }
    ]

    // let results = [14].map(x => tests[x]).map((test, index) => {
    tests.pop(); // Remove last test
    let results = tests.map((test, index) => {
        const prefix = `#${index}. `;
        const result = (() => {
            try      { return assert(test.name, test.expected, test.input) }
            catch(e) { return `Error: ${e}`; }
        })();
        return `${prefix}${result}`;
    });
    results.forEach(result => console.log(result));

    // More complex tests
    // [
    //   name of test,
    //   JSON object,
    //   function to run with object,
    //   expected result from function
    // ]
    const complex_tests = [
        [
            "Gracefully handle empty strings",
            {
                "main": ["a", "", ["b"]]
            },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["ab", "b"])
        ],
        [
            "Gracefully handle empty strings #2",
            { "main": ["a", ""] },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["", "a"])
        ],
        [
            "Gracefully handle empty strings #2",
            { "main": ["a", "b", ["", "c"]] },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["a", "ac", "b", "bc"])
        ],
        [
            "Gracefully handle empty strings #3",
            { "main": ["a", ["", "b", ["c"]]] },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["abc", "ac"])
        ],
        [
            "Gracefully handle empty strings #3",
            { "main": ["a", [""]] },
            (obj) => {
              const tree = new Permute(obj, true);
              return JSON.stringify(tree.permutations)
            },
            JSON.stringify(["a"])
        ],
        [
            "Nested thens handled until the final then of the parent calling branch",
            {
                "main": [
                    { "branch": "A", "then": { "branch": "C" }}
                ],
                "A": [ "a", [{ "branch": "B" }] ],
                "B": [ "b" ],
                "C": [ "c" ]
            },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["abc"])
        ],
        [
            "(#2) Nested thens handled until the final then of the parent calling branch",
            {
                "main": [
                    { "branch": "A", "then": { "branch": "C" }}
                ],
                "A": [ "a", { "branch": "B" }],
                "B": [ "b" ],
                "C": [ "c" ]
            },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["abc"])
        ],
        [
            "Branch nesting with two embedded redirects (random permutations)",
            {
                "main": [
                    { "branch": "A", "then": { "branch": "C" }}
                ],
                "A": [ "a", { "branch": "B" }],
                "B": [ "b" ],
                "C": [ "c" ]
            },
            (obj) => {
                const tree = new Permute(obj, true);
                let x = 0, results = [];
                while(x++ < 100) { results.push(tree.permutations[0]) }
                return JSON.stringify([...new Set(results)].sort())
            },
            JSON.stringify(["abc"])
        ]
    ];

    complex_tests.forEach((test, index) => {
        const title = test[0], obj = test[1], fn = test[2], expected = test[3], actual = fn(obj);
        let message;

        if (actual === expected) { message = `PASS: ${title} | (${actual})`; }
        else                     { message = `---FAIL: ${title}\n      Expected: ${expected}\n      Actual:   ${actual}`; }
        console.log(`#${index + tests.length}: ${message}`);
    })
})();