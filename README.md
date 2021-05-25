# Permutation Generator

The permutation generator is useful for generating all possible variations
of a string according to a prescribed scheme.

See the examples below or visit the [Documentation](https://github.com/adamjgrant/permutations/wiki/Quick-Start) to learn how to use to learn how to use.

## Simple Example

Run any of these examples with `node random <file path without .json>` in this project.

To see all possible permutations, run `node index <file path without .json>`.

### `examples/weather.json`

~~~json
{
  "main": [
    "it's ", [
      "windy", "still", "blustery", [
        ", ", [
          "cloudy", "partly cloudy", "clear skies", [
            ", and ", [
              "5%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%", [
                " chance of precipitation."
              ]
            ]
          ]
        ]
      ]
    ]
  ]
}
~~~

Example outputs

~~~js
it's still, cloudy, and 50% chance of precipitation.
it's blustery, cloudy, and 20% chance of precipitation.
it's still, clear skies, and 30% chance of precipitation.
it's blustery, cloudy, and 90% chance of precipitation.
~~~

## Sentence generation

### `examples/polite_sentence.json`

~~~json
{
  "main": [
    "Hello", "Hi", "Greetings", [
      ", ", [
        "How are you?", "How's it going?", [
          " ", [
            "I just wanted to ", [
              "take the time to tell you", "remind you", [
                " to ", { "branch": "advice" }
              ]
            ]
          ]
        ]
      ],
      [
        { "branch": "advice"}
      ]
    ]
  ],
  "advice": [
    "Please remember", "Take caution", [
      " to ", [
        "mind the gap", "stay six feet apart", "clean up your area", [
          " ", [
            "at all times.", "to be a good citizen."
          ]
        ]
      ]
    ]
  ]
}
~~~

Example outputs

~~~
Greetings, How's it going? I just wanted to take the time to tell you to Please remember to clean up your area to be a good citizen.
Hi, How are you? I just wanted to take the time to tell you to Take caution to mind the gap to be a good citizen.
Greetings, Take caution to mind the gap to be a good citizen.
Hello, How's it going? I just wanted to remind you to Take caution to mind the gap to be a good citizen.
Greetings, How's it going? I just wanted to remind you to Please remember to stay six feet apart at all times.
~~~

## Complex branch linking

### `examples/complex_branching`

~~~json
{
  "main": [
    "A", "B", { "branch": "C", "then": [
      "D", { "branch":  "E"}
    ]}
  ],
  "C": [
    "F", "G", { "branch":  "H", "then": ["K", "L", ["M", "N"]] }
  ],
  "E": ["I", "O", "P", [
    "Q", "R", "S", { "branch":  "C",
      "then": "T"
    }
  ]],
  "H": ["J"]
}
~~~

Example output

~~~
AGDPQGJKM
AFDOQFJLM
AFDORGJKN
BFDPRGJLN
BFDOQGJLN
~~~

## Permyscript, shorthand syntax

Instead of

~~~json
{
  "main": [
    "Johnny Appleseed", "Jane Doe", "Ponsonby Britt"
  ]
}
~~~

Save yourself the trouble of writing `", "` over and over again.

~~~json
{
  "main": [
    { "ps": "Johnny Appleseed|Jane Doe|Ponsonby Britt" }
  ]
}
~~~

# Starting Docker

Make sure the variables `$NODE_LOCAL_PORT` and `$NODE_DOCKER_PORT` are set in .env and run:

`docker compose up`
