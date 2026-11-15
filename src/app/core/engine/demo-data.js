// The bundled demo world: a realistic week of teacher data built around the
// scanning flow. Every demo class carries a fully pinned roster, so generic
// PIN half-sheets route by the shaded 5-digit PIN in every class — the four
// demo sheets (site + app Settings) target English 8-B's 50-item Verb
// Tenses quiz. Records are tagged demo: true and re-keyed per account by
// demo.js, which pours this snapshot through the real storage layer
// idempotently.
export const DEMO_SNAPSHOT = {
  "capturedAt": "2026-10-22",
  "classes": [
    {
      "id": "demo-cls-eng",
      "name": "English 8-B",
      "grade": "8",
      "section": "Molave",
      "subject": "English",
      "schoolYear": "2026-2027",
      "students": [
        {
          "name": "Ivan Ramos",
          "no": 1,
          "pin": "48213"
        },
        {
          "name": "Joy Aquino",
          "no": 2,
          "pin": "73590"
        },
        {
          "name": "Kat Bautista",
          "no": 3,
          "pin": "26481"
        },
        {
          "name": "Leo Mendoza",
          "no": 4,
          "pin": "91537"
        },
        {
          "name": "Mike Garcia",
          "no": 5,
          "pin": "50294"
        },
        {
          "name": "Nina Flores",
          "no": 6,
          "pin": "68127"
        },
        {
          "name": "Omar Reyes",
          "no": 7,
          "pin": "34905"
        },
        {
          "name": "Pia Navarro",
          "no": 8,
          "pin": "82640"
        },
        {
          "name": "Ria Santos",
          "no": 9,
          "pin": "19378"
        },
        {
          "name": "Sam Ocampo",
          "no": 10,
          "pin": "75461"
        },
        {
          "name": "Tina Delgado",
          "no": 11,
          "pin": "41086"
        },
        {
          "name": "Vina Castro",
          "no": 12,
          "pin": "96732"
        }
      ],
      "demo": true
    },
    {
      "id": "demo-cls-sci",
      "name": "Science 7-A",
      "grade": "7",
      "section": "Sampaguita",
      "subject": "Science",
      "schoolYear": "2026-2027",
      "students": [
        {
          "name": "Ana Reyes",
          "no": 1,
          "pin": "53812"
        },
        {
          "name": "Ben Cruz",
          "no": 2,
          "pin": "71046"
        },
        {
          "name": "Cara Diaz",
          "no": 3,
          "pin": "26953"
        },
        {
          "name": "Darna Villanueva",
          "no": 4,
          "pin": "83407"
        },
        {
          "name": "Elias Cruz",
          "no": 5,
          "pin": "41568"
        },
        {
          "name": "Fina Mercado",
          "no": 6,
          "pin": "97210"
        },
        {
          "name": "Gab Torres",
          "no": 7,
          "pin": "60734"
        },
        {
          "name": "Hana Lopez",
          "no": 8,
          "pin": "18392"
        }
      ],
      "demo": true
    },
    {
      "id": "demo-cls-ict",
      "name": "ICT 9-A",
      "grade": "9",
      "section": "Narra",
      "subject": "Computer",
      "schoolYear": "2026-2027",
      "students": [
        {
          "name": "Paolo Cruz",
          "no": 1,
          "pin": "51428"
        },
        {
          "name": "Bea Lim",
          "no": 2,
          "pin": "76093"
        },
        {
          "name": "Carlo Reyes",
          "no": 3,
          "pin": "29564"
        },
        {
          "name": "Dana Sy",
          "no": 4,
          "pin": "83170"
        },
        {
          "name": "Eli Tan",
          "no": 5,
          "pin": "46715"
        },
        {
          "name": "Faith Uy",
          "no": 6,
          "pin": "91286"
        }
      ],
      "demo": true
    }
  ],
  "keys": [
    {
      "id": "ee5dff1a-46e6-44f5-ab5a-b3c20eb88d88",
      "subject": "Computer",
      "title": "",
      "format": "mcq",
      "items": [
        {
          "n": 1,
          "question": "What does CPU stand for?",
          "options": [
            "Central Processing Unit",
            "Computer Personal Unit",
            "Central Program Utility",
            "Control Processing User"
          ],
          "answerIndex": 0
        },
        {
          "n": 2,
          "question": "Which component is commonly called the brain of the computer?",
          "options": [
            "Monitor",
            "CPU",
            "Keyboard",
            "Printer"
          ],
          "answerIndex": 1
        },
        {
          "n": 3,
          "question": "Which of the following is an input device?",
          "options": [
            "Monitor",
            "Speaker",
            "Keyboard",
            "Projector"
          ],
          "answerIndex": 2
        },
        {
          "n": 4,
          "question": "Which type of memory is volatile?",
          "options": [
            "ROM",
            "SSD",
            "Hard disk",
            "RAM"
          ],
          "answerIndex": 3
        },
        {
          "n": 5,
          "question": "Which software manages computer hardware and resources?",
          "options": [
            "Operating system",
            "Word processor",
            "Spreadsheet",
            "Web browser"
          ],
          "answerIndex": 0
        }
      ]
    },
    {
      "id": "18ec13e7-a631-4bf0-8ccc-5d6bdf0da9a8",
      "subject": "Science",
      "title": "",
      "format": "letters",
      "items": [
        {
          "n": 1,
          "question": "",
          "answer": "B"
        },
        {
          "n": 2,
          "question": "",
          "answer": "A"
        },
        {
          "n": 3,
          "question": "",
          "answer": "C"
        },
        {
          "n": 4,
          "question": "",
          "answer": "D"
        },
        {
          "n": 5,
          "question": "",
          "answer": "A"
        },
        {
          "n": 6,
          "question": "",
          "answer": "B"
        },
        {
          "n": 7,
          "question": "",
          "answer": "A"
        },
        {
          "n": 8,
          "question": "",
          "answer": "D"
        },
        {
          "n": 9,
          "question": "",
          "answer": "C"
        },
        {
          "n": 10,
          "question": "",
          "answer": "B"
        }
      ]
    },
    {
      "id": "demo-key-2",
      "subject": "English",
      "title": "Verb Tenses",
      "format": "letters",
      "items": [
        {
          "n": 1,
          "answerLetter": "B"
        },
        {
          "n": 2,
          "answerLetter": "C"
        },
        {
          "n": 3,
          "answerLetter": "C"
        },
        {
          "n": 4,
          "answerLetter": "B"
        },
        {
          "n": 5,
          "answerLetter": "B"
        },
        {
          "n": 6,
          "answerLetter": "C"
        },
        {
          "n": 7,
          "answerLetter": "C"
        },
        {
          "n": 8,
          "answerLetter": "A"
        },
        {
          "n": 9,
          "answerLetter": "B"
        },
        {
          "n": 10,
          "answerLetter": "C"
        },
        {
          "n": 11,
          "answerLetter": "C"
        },
        {
          "n": 12,
          "answerLetter": "A"
        },
        {
          "n": 13,
          "answerLetter": "C"
        },
        {
          "n": 14,
          "answerLetter": "C"
        },
        {
          "n": 15,
          "answerLetter": "C"
        },
        {
          "n": 16,
          "answerLetter": "C"
        },
        {
          "n": 17,
          "answerLetter": "B"
        },
        {
          "n": 18,
          "answerLetter": "C"
        },
        {
          "n": 19,
          "answerLetter": "C"
        },
        {
          "n": 20,
          "answerLetter": "B"
        },
        {
          "n": 21,
          "answerLetter": "C"
        },
        {
          "n": 22,
          "answerLetter": "C"
        },
        {
          "n": 23,
          "answerLetter": "A"
        },
        {
          "n": 24,
          "answerLetter": "C"
        },
        {
          "n": 25,
          "answerLetter": "C"
        },
        {
          "n": 26,
          "answerLetter": "C"
        },
        {
          "n": 27,
          "answerLetter": "B"
        },
        {
          "n": 28,
          "answerLetter": "D"
        },
        {
          "n": 29,
          "answerLetter": "C"
        },
        {
          "n": 30,
          "answerLetter": "B"
        },
        {
          "n": 31,
          "answerLetter": "C"
        },
        {
          "n": 32,
          "answerLetter": "C"
        },
        {
          "n": 33,
          "answerLetter": "B"
        },
        {
          "n": 34,
          "answerLetter": "B"
        },
        {
          "n": 35,
          "answerLetter": "C"
        },
        {
          "n": 36,
          "answerLetter": "A"
        },
        {
          "n": 37,
          "answerLetter": "C"
        },
        {
          "n": 38,
          "answerLetter": "C"
        },
        {
          "n": 39,
          "answerLetter": "A"
        },
        {
          "n": 40,
          "answerLetter": "B"
        },
        {
          "n": 41,
          "answerLetter": "C"
        },
        {
          "n": 42,
          "answerLetter": "C"
        },
        {
          "n": 43,
          "answerLetter": "C"
        },
        {
          "n": 44,
          "answerLetter": "C"
        },
        {
          "n": 45,
          "answerLetter": "A"
        },
        {
          "n": 46,
          "answerLetter": "C"
        },
        {
          "n": 47,
          "answerLetter": "C"
        },
        {
          "n": 48,
          "answerLetter": "A"
        },
        {
          "n": 49,
          "answerLetter": "C"
        },
        {
          "n": 50,
          "answerLetter": "C"
        }
      ],
      "demo": true
    },
    {
      "id": "demo-key-1",
      "subject": "Science",
      "title": "Cell Basics",
      "format": "answers",
      "items": [
        {
          "n": 1,
          "answer": "Nucleus"
        },
        {
          "n": 2,
          "answer": "Mitochondrion"
        },
        {
          "n": 3,
          "answer": "Cell wall"
        },
        {
          "n": 4,
          "answer": "Ribosome"
        },
        {
          "n": 5,
          "answer": "Vacuole"
        },
        {
          "n": 6,
          "answer": "Cell membrane"
        },
        {
          "n": 7,
          "answer": "Chloroplast"
        },
        {
          "n": 8,
          "answer": "Cytoplasm"
        },
        {
          "n": 9,
          "answer": "Lysosome"
        },
        {
          "n": 10,
          "answer": "Nucleus"
        }
      ],
      "demo": true
    }
  ],
  "quizzes": [
    {
      "id": "04a2026e-cd20-4de9-99c7-237070be77ac",
      "subject": "Computer",
      "title": "Computer Basics",
      "classId": "demo-cls-ict",
      "source": "key",
      "items": [
        {
          "n": 1,
          "question": "What does CPU stand for?",
          "options": [
            "Central Processing Unit",
            "Computer Personal Unit",
            "Central Program Utility",
            "Control Processing User"
          ],
          "answerIndex": 0,
          "keyIndex": 0,
          "keyAnswer": "",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 2,
          "question": "Which component is commonly called the brain of the computer?",
          "options": [
            "Monitor",
            "CPU",
            "Keyboard",
            "Printer"
          ],
          "answerIndex": 1,
          "keyIndex": 1,
          "keyAnswer": "",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 3,
          "question": "Which of the following is an input device?",
          "options": [
            "Monitor",
            "Speaker",
            "Keyboard",
            "Projector"
          ],
          "answerIndex": 2,
          "keyIndex": 2,
          "keyAnswer": "",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 4,
          "question": "Which type of memory is volatile?",
          "options": [
            "ROM",
            "SSD",
            "Hard disk",
            "RAM"
          ],
          "answerIndex": 3,
          "keyIndex": 3,
          "keyAnswer": "",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 5,
          "question": "Which software manages computer hardware and resources?",
          "options": [
            "Operating system",
            "Word processor",
            "Spreadsheet",
            "Web browser"
          ],
          "answerIndex": 0,
          "keyIndex": 4,
          "keyAnswer": "",
          "keyOrigin": "teacher",
          "keyMismatch": false
        }
      ],
      "keyOnly": false
    },
    {
      "id": "6ceb133a-20e9-4e18-9655-1a81ebd573b5",
      "subject": "Science",
      "title": "Science — answer key",
      "classId": "demo-cls-sci",
      "source": "key",
      "items": [
        {
          "n": 1,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 1,
          "keyIndex": 0,
          "keyAnswer": "B",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 2,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 0,
          "keyIndex": 1,
          "keyAnswer": "A",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 3,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 2,
          "keyIndex": 2,
          "keyAnswer": "C",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 4,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 3,
          "keyIndex": 3,
          "keyAnswer": "D",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 5,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 0,
          "keyIndex": 4,
          "keyAnswer": "A",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 6,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 1,
          "keyIndex": 5,
          "keyAnswer": "B",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 7,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 0,
          "keyIndex": 6,
          "keyAnswer": "A",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 8,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 3,
          "keyIndex": 7,
          "keyAnswer": "D",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 9,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 2,
          "keyIndex": 8,
          "keyAnswer": "C",
          "keyOrigin": "teacher",
          "keyMismatch": false
        },
        {
          "n": 10,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 1,
          "keyIndex": 9,
          "keyAnswer": "B",
          "keyOrigin": "teacher",
          "keyMismatch": false
        }
      ],
      "keyOnly": true
    },
    {
      "id": "demo-quiz-3",
      "subject": "Science",
      "title": "Plate Tectonics — quick check",
      "classId": "demo-cls-sci",
      "source": "key",
      "items": [
        {
          "n": 1,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 1
        },
        {
          "n": 2,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 2
        },
        {
          "n": 3,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 0
        },
        {
          "n": 4,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 3
        },
        {
          "n": 5,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 2
        },
        {
          "n": 6,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 0
        },
        {
          "n": 7,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 1
        },
        {
          "n": 8,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 3
        },
        {
          "n": 9,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 1
        },
        {
          "n": 10,
          "question": "",
          "options": [
            "",
            "",
            "",
            ""
          ],
          "answerIndex": 0
        }
      ],
      "keyOnly": true,
      "demo": true
    },
    {
      "id": "demo-quiz-2",
      "subject": "English",
      "title": "Verb Tenses",
      "classId": "demo-cls-eng",
      "source": "key",
      "items": [
        {
          "n": 1,
          "question": "She ___ to school every day.",
          "options": [
            "go",
            "goes",
            "going",
            "gone"
          ],
          "answerIndex": 1
        },
        {
          "n": 2,
          "question": "Yesterday, they ___ a movie.",
          "options": [
            "watch",
            "watches",
            "watched",
            "watching"
          ],
          "answerIndex": 2
        },
        {
          "n": 3,
          "question": "We ___ our homework before dinner last night.",
          "options": [
            "finish",
            "finishes",
            "finished",
            "finishing"
          ],
          "answerIndex": 2
        },
        {
          "n": 4,
          "question": "The sun ___ in the east.",
          "options": [
            "rise",
            "rises",
            "rose",
            "rising"
          ],
          "answerIndex": 1
        },
        {
          "n": 5,
          "question": "I ___ for my keys right now.",
          "options": [
            "look",
            "am looking",
            "looked",
            "looks"
          ],
          "answerIndex": 1
        },
        {
          "n": 6,
          "question": "They ___ in Cebu since 2015.",
          "options": [
            "live",
            "lives",
            "have lived",
            "living"
          ],
          "answerIndex": 2
        },
        {
          "n": 7,
          "question": "He ___ his bike when it started to rain.",
          "options": [
            "ride",
            "rides",
            "was riding",
            "ridden"
          ],
          "answerIndex": 2
        },
        {
          "n": 8,
          "question": "By tomorrow, she ___ the book.",
          "options": [
            "will finish",
            "finishes",
            "finished",
            "finishing"
          ],
          "answerIndex": 0
        },
        {
          "n": 9,
          "question": "My father ___ coffee every morning.",
          "options": [
            "drink",
            "drinks",
            "drank",
            "drinking"
          ],
          "answerIndex": 1
        },
        {
          "n": 10,
          "question": "Last week, we ___ to Baguio.",
          "options": [
            "go",
            "goes",
            "went",
            "going"
          ],
          "answerIndex": 2
        },
        {
          "n": 11,
          "question": "Look! The baby ___ right now.",
          "options": [
            "cry",
            "cries",
            "is crying",
            "cried"
          ],
          "answerIndex": 2
        },
        {
          "n": 12,
          "question": "I ___ my teeth twice a day.",
          "options": [
            "brush",
            "brushes",
            "brushed",
            "brushing"
          ],
          "answerIndex": 0
        },
        {
          "n": 13,
          "question": "She ___ her grandmother last Saturday.",
          "options": [
            "visit",
            "visits",
            "visited",
            "visiting"
          ],
          "answerIndex": 2
        },
        {
          "n": 14,
          "question": "While mother ___, the phone rang.",
          "options": [
            "cook",
            "cooks",
            "was cooking",
            "cooked"
          ],
          "answerIndex": 2
        },
        {
          "n": 15,
          "question": "They ___ here for ten years.",
          "options": [
            "work",
            "works",
            "have worked",
            "working"
          ],
          "answerIndex": 2
        },
        {
          "n": 16,
          "question": "Tomorrow, we ___ our project.",
          "options": [
            "submit",
            "submits",
            "will submit",
            "submitted"
          ],
          "answerIndex": 2
        },
        {
          "n": 17,
          "question": "The cat ___ under the table every afternoon.",
          "options": [
            "sleep",
            "sleeps",
            "slept",
            "sleeping"
          ],
          "answerIndex": 1
        },
        {
          "n": 18,
          "question": "I ___ him at the mall yesterday.",
          "options": [
            "see",
            "sees",
            "saw",
            "seeing"
          ],
          "answerIndex": 2
        },
        {
          "n": 19,
          "question": "Listen! Someone ___ the piano.",
          "options": [
            "play",
            "plays",
            "is playing",
            "played"
          ],
          "answerIndex": 2
        },
        {
          "n": 20,
          "question": "Water ___ at 100 degrees Celsius.",
          "options": [
            "boil",
            "boils",
            "boiled",
            "boiling"
          ],
          "answerIndex": 1
        },
        {
          "n": 21,
          "question": "We ___ dinner when the lights went out.",
          "options": [
            "have",
            "had",
            "were having",
            "has"
          ],
          "answerIndex": 2
        },
        {
          "n": 22,
          "question": "She ___ her bag a moment ago.",
          "options": [
            "lose",
            "loses",
            "lost",
            "losing"
          ],
          "answerIndex": 2
        },
        {
          "n": 23,
          "question": "The boys ___ basketball every recess.",
          "options": [
            "play",
            "plays",
            "played",
            "playing"
          ],
          "answerIndex": 0
        },
        {
          "n": 24,
          "question": "Right now, Ana ___ her lessons.",
          "options": [
            "review",
            "reviews",
            "is reviewing",
            "reviewed"
          ],
          "answerIndex": 2
        },
        {
          "n": 25,
          "question": "I ___ my allowance already.",
          "options": [
            "spend",
            "spends",
            "have spent",
            "spending"
          ],
          "answerIndex": 2
        },
        {
          "n": 26,
          "question": "Next month, they ___ a new house.",
          "options": [
            "build",
            "builds",
            "will build",
            "built"
          ],
          "answerIndex": 2
        },
        {
          "n": 27,
          "question": "My sister ___ her room every Sunday.",
          "options": [
            "clean",
            "cleans",
            "cleaned",
            "cleaning"
          ],
          "answerIndex": 1
        },
        {
          "n": 28,
          "question": "The guests ___ before we finished cooking.",
          "options": [
            "arrive",
            "arrives",
            "arrived",
            "had arrived"
          ],
          "answerIndex": 3
        },
        {
          "n": 29,
          "question": "He ___ TV when I called him.",
          "options": [
            "watch",
            "watches",
            "was watching",
            "watched"
          ],
          "answerIndex": 2
        },
        {
          "n": 30,
          "question": "The teacher ___ our papers every Friday.",
          "options": [
            "check",
            "checks",
            "checked",
            "checking"
          ],
          "answerIndex": 1
        },
        {
          "n": 31,
          "question": "I ___ to the radio right now.",
          "options": [
            "listen",
            "listens",
            "am listening",
            "listened"
          ],
          "answerIndex": 2
        },
        {
          "n": 32,
          "question": "She ___ to Bohol two years ago.",
          "options": [
            "travel",
            "travels",
            "traveled",
            "traveling"
          ],
          "answerIndex": 2
        },
        {
          "n": 33,
          "question": "Lola ___ the plants every evening.",
          "options": [
            "water",
            "waters",
            "watered",
            "watering"
          ],
          "answerIndex": 1
        },
        {
          "n": 34,
          "question": "When I arrived, they ___ already left.",
          "options": [
            "have",
            "had",
            "has",
            "will"
          ],
          "answerIndex": 1
        },
        {
          "n": 35,
          "question": "Don't make noise; the baby ___ right now.",
          "options": [
            "sleep",
            "sleeps",
            "is sleeping",
            "slept"
          ],
          "answerIndex": 2
        },
        {
          "n": 36,
          "question": "We ___ our uniforms on weekdays.",
          "options": [
            "wear",
            "wears",
            "wore",
            "wearing"
          ],
          "answerIndex": 0
        },
        {
          "n": 37,
          "question": "The mailman ___ early this morning.",
          "options": [
            "come",
            "comes",
            "came",
            "coming"
          ],
          "answerIndex": 2
        },
        {
          "n": 38,
          "question": "They ___ the bridge when the storm hit.",
          "options": [
            "cross",
            "crosses",
            "were crossing",
            "crossed"
          ],
          "answerIndex": 2
        },
        {
          "n": 39,
          "question": "I ___ never seen a typhoon that strong.",
          "options": [
            "have",
            "has",
            "had",
            "will"
          ],
          "answerIndex": 0
        },
        {
          "n": 40,
          "question": "The concert ___ at 7 p.m. tonight.",
          "options": [
            "start",
            "starts",
            "started",
            "starting"
          ],
          "answerIndex": 1
        },
        {
          "n": 41,
          "question": "My friends ___ me last night.",
          "options": [
            "call",
            "calls",
            "called",
            "calling"
          ],
          "answerIndex": 2
        },
        {
          "n": 42,
          "question": "She ___ the dishes while I dried them.",
          "options": [
            "wash",
            "washes",
            "was washing",
            "washed"
          ],
          "answerIndex": 2
        },
        {
          "n": 43,
          "question": "We ___ each other since Grade 1.",
          "options": [
            "know",
            "knows",
            "have known",
            "knowing"
          ],
          "answerIndex": 2
        },
        {
          "n": 44,
          "question": "The bus ___ five minutes ago.",
          "options": [
            "leave",
            "leaves",
            "left",
            "leaving"
          ],
          "answerIndex": 2
        },
        {
          "n": 45,
          "question": "Every summer, we ___ to the beach.",
          "options": [
            "go",
            "goes",
            "went",
            "going"
          ],
          "answerIndex": 0
        },
        {
          "n": 46,
          "question": "Look out! The glass ___ from the table.",
          "options": [
            "fall",
            "falls",
            "is falling",
            "fell"
          ],
          "answerIndex": 2
        },
        {
          "n": 47,
          "question": "Before the bell rang, we ___ the test.",
          "options": [
            "finish",
            "finishes",
            "had finished",
            "finishing"
          ],
          "answerIndex": 2
        },
        {
          "n": 48,
          "question": "The dogs ___ at strangers every night.",
          "options": [
            "bark",
            "barks",
            "barked",
            "barking"
          ],
          "answerIndex": 0
        },
        {
          "n": 49,
          "question": "She ___ sick since Monday.",
          "options": [
            "is",
            "was",
            "has been",
            "will be"
          ],
          "answerIndex": 2
        },
        {
          "n": 50,
          "question": "They ___ the results next week.",
          "options": [
            "announce",
            "announces",
            "will announce",
            "announced"
          ],
          "answerIndex": 2
        }
      ],
      "demo": true
    },
    {
      "id": "demo-quiz-1",
      "subject": "Science",
      "title": "Cell Basics",
      "classId": "demo-cls-sci",
      "source": "ai",
      "items": [
        {
          "n": 1,
          "question": "Which organelle is the control center of the cell?",
          "options": [
            "Mitochondrion",
            "Nucleus",
            "Vacuole",
            "Cell wall"
          ],
          "answerIndex": 1
        },
        {
          "n": 2,
          "question": "What is known as the powerhouse of the cell?",
          "options": [
            "Nucleus",
            "Chloroplast",
            "Mitochondrion",
            "Ribosome"
          ],
          "answerIndex": 2
        },
        {
          "n": 3,
          "question": "Which structure is found only in plant cells?",
          "options": [
            "Cell wall",
            "Cell membrane",
            "Nucleus",
            "Cytoplasm"
          ],
          "answerIndex": 0
        },
        {
          "n": 4,
          "question": "Where are proteins made?",
          "options": [
            "Vacuole",
            "Lysosome",
            "Nucleus",
            "Ribosome"
          ],
          "answerIndex": 3
        },
        {
          "n": 5,
          "question": "Which organelle stores water and waste?",
          "options": [
            "Vacuole",
            "Ribosome",
            "Cell wall",
            "Golgi body"
          ],
          "answerIndex": 0
        },
        {
          "n": 6,
          "question": "What controls what enters and leaves the cell?",
          "options": [
            "Nucleus",
            "Golgi body",
            "Cell membrane",
            "Lysosome"
          ],
          "answerIndex": 2
        },
        {
          "n": 7,
          "question": "Which organelle captures sunlight to make food?",
          "options": [
            "Mitochondrion",
            "Chloroplast",
            "Ribosome",
            "Vacuole"
          ],
          "answerIndex": 1
        },
        {
          "n": 8,
          "question": "What is the jelly-like substance that holds the organelles?",
          "options": [
            "Nucleus",
            "Cell wall",
            "Chloroplast",
            "Cytoplasm"
          ],
          "answerIndex": 3
        },
        {
          "n": 9,
          "question": "Which cell part recycles worn-out organelles?",
          "options": [
            "Lysosome",
            "Ribosome",
            "Vacuole",
            "Cell membrane"
          ],
          "answerIndex": 0
        },
        {
          "n": 10,
          "question": "Where does the cell keep its genetic instructions?",
          "options": [
            "Cell membrane",
            "Nucleus",
            "Cytoplasm",
            "Vacuole"
          ],
          "answerIndex": 1
        }
      ],
      "demo": true
    }
  ],
  "sheets": [
    {
      "id": "1c3780e3-398d-4447-ba38-85aa6a2c4809",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-3",
      "studentNo": 6,
      "studentName": "Fina Mercado",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        2,
        0,
        2,
        2,
        0,
        1,
        3,
        3,
        0
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 8,
      "total": 10,
      "percent": 80
    },
    {
      "id": "demo-sheet-13",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-3",
      "studentNo": 5,
      "studentName": "Elias Cruz",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        3,
        1,
        3,
        3,
        3,
        0,
        2,
        0,
        0,
        0
      ],
      "flags": [],
      "correct": 3,
      "total": 10,
      "percent": 30,
      "demo": true
    },
    {
      "id": "demo-sheet-12",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-3",
      "studentNo": 4,
      "studentName": "Darna Villanueva",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        0,
        1,
        3,
        2,
        2,
        0,
        1,
        2,
        2,
        0
      ],
      "flags": [],
      "correct": 4,
      "total": 10,
      "percent": 40,
      "demo": true
    },
    {
      "id": "demo-sheet-11",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-3",
      "studentNo": 3,
      "studentName": "Cara Diaz",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        2,
        3,
        3,
        1,
        0,
        2,
        0,
        1,
        2
      ],
      "flags": [],
      "correct": 5,
      "total": 10,
      "percent": 50,
      "demo": true
    },
    {
      "id": "demo-sheet-10",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-3",
      "studentNo": 2,
      "studentName": "Ben Cruz",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        2,
        0,
        0,
        2,
        0,
        1,
        3,
        0,
        0
      ],
      "flags": [],
      "correct": 8,
      "total": 10,
      "percent": 80,
      "demo": true
    },
    {
      "id": "demo-sheet-9",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-3",
      "studentNo": 1,
      "studentName": "Ana Reyes",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        2,
        0,
        -1,
        0,
        0,
        1,
        3,
        1,
        1
      ],
      "flags": [],
      "correct": 7,
      "total": 10,
      "percent": 70,
      "demo": true
    },
    {
      "id": "demo-sheet-8",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 8,
      "studentName": "Hana Lopez",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        -1,
        0,
        3,
        0,
        2,
        1,
        3,
        0,
        1
      ],
      "flags": [],
      "correct": 9,
      "total": 10,
      "percent": 90,
      "demo": true
    },
    {
      "id": "demo-sheet-7",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 7,
      "studentName": "Gab Torres",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        0,
        0,
        3,
        2,
        1,
        2,
        0,
        2,
        3,
        3
      ],
      "flags": [],
      "correct": 1,
      "total": 10,
      "percent": 10,
      "demo": true
    },
    {
      "id": "demo-sheet-6",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 6,
      "studentName": "Fina Mercado",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        3,
        3,
        3,
        3,
        3,
        3,
        0,
        1,
        3
      ],
      "flags": [],
      "correct": 2,
      "total": 10,
      "percent": 20,
      "demo": true
    },
    {
      "id": "demo-sheet-5",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 5,
      "studentName": "Elias Cruz",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        3,
        3,
        3,
        0,
        3,
        1,
        1,
        0,
        2
      ],
      "flags": [],
      "correct": 5,
      "total": 10,
      "percent": 50,
      "demo": true
    },
    {
      "id": "demo-sheet-4",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 4,
      "studentName": "Darna Villanueva",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        3,
        1,
        3,
        1,
        2,
        3,
        3,
        1,
        1
      ],
      "flags": [],
      "correct": 5,
      "total": 10,
      "percent": 50,
      "demo": true
    },
    {
      "id": "demo-sheet-3",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 3,
      "studentName": "Cara Diaz",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        3,
        0,
        3,
        1,
        2,
        2,
        1,
        0,
        1
      ],
      "flags": [],
      "correct": 6,
      "total": 10,
      "percent": 60,
      "demo": true
    },
    {
      "id": "demo-sheet-2",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 2,
      "studentName": "Ben Cruz",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        -1,
        0,
        3,
        0,
        2,
        1,
        3,
        0,
        1
      ],
      "flags": [],
      "correct": 9,
      "total": 10,
      "percent": 90,
      "demo": true
    },
    {
      "id": "demo-sheet-1",
      "classId": "demo-cls-sci",
      "className": "Science 7-A",
      "quizId": "demo-quiz-1",
      "studentNo": 1,
      "studentName": "Ana Reyes",
      "grade": "7",
      "section": "Sampaguita",
      "answers": [
        1,
        3,
        0,
        3,
        2,
        -1,
        1,
        3,
        0,
        1
      ],
      "flags": [],
      "correct": 7,
      "total": 10,
      "percent": 70,
      "demo": true
    },
    {
      "id": "demo-sheet-e1",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 5,
      "studentName": "Mike Garcia",
      "grade": "8",
      "section": "Molave",
      "answers": [
        1,
        2,
        2,
        1,
        1,
        2,
        2,
        3,
        1,
        2,
        2,
        0,
        2,
        2,
        2,
        2,
        1,
        2,
        2,
        1,
        2,
        2,
        0,
        2,
        2,
        2,
        1,
        2,
        2,
        1,
        2,
        2,
        1,
        0,
        2,
        0,
        3,
        2,
        0,
        1,
        2,
        2,
        2,
        2,
        3,
        2,
        2,
        0,
        2,
        2
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 45,
      "total": 50,
      "percent": 90,
      "demo": true
    },
    {
      "id": "demo-sheet-e2",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 6,
      "studentName": "Nina Flores",
      "grade": "8",
      "section": "Molave",
      "answers": [
        3,
        2,
        2,
        1,
        1,
        2,
        2,
        0,
        1,
        2,
        2,
        0,
        0,
        2,
        2,
        2,
        1,
        2,
        2,
        1,
        2,
        2,
        0,
        2,
        2,
        0,
        1,
        3,
        2,
        1,
        2,
        2,
        3,
        1,
        2,
        0,
        2,
        1,
        0,
        1,
        2,
        2,
        2,
        2,
        0,
        2,
        2,
        1,
        0,
        0
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 42,
      "total": 50,
      "percent": 84,
      "demo": true
    },
    {
      "id": "demo-sheet-e3",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 7,
      "studentName": "Omar Reyes",
      "grade": "8",
      "section": "Molave",
      "answers": [
        1,
        3,
        2,
        1,
        1,
        2,
        2,
        0,
        1,
        2,
        2,
        0,
        2,
        2,
        2,
        2,
        1,
        2,
        2,
        1,
        2,
        2,
        0,
        2,
        1,
        2,
        2,
        0,
        1,
        1,
        2,
        0,
        1,
        1,
        2,
        3,
        3,
        0,
        0,
        1,
        1,
        2,
        2,
        0,
        0,
        1,
        2,
        0,
        2,
        2
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 38,
      "total": 50,
      "percent": 76,
      "demo": true
    },
    {
      "id": "demo-sheet-e4",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 8,
      "studentName": "Pia Navarro",
      "grade": "8",
      "section": "Molave",
      "answers": [
        1,
        2,
        3,
        1,
        1,
        3,
        1,
        3,
        1,
        2,
        2,
        3,
        1,
        2,
        2,
        2,
        1,
        2,
        3,
        3,
        2,
        2,
        0,
        2,
        2,
        2,
        1,
        2,
        1,
        -1,
        -1,
        2,
        2,
        1,
        2,
        0,
        1,
        1,
        0,
        1,
        2,
        0,
        1,
        2,
        0,
        2,
        2,
        0,
        2,
        2
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 33,
      "total": 50,
      "percent": 66,
      "demo": true
    },
    {
      "id": "demo-sheet-e5",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 9,
      "studentName": "Ria Santos",
      "grade": "8",
      "section": "Molave",
      "answers": [
        1,
        -1,
        1,
        1,
        1,
        2,
        0,
        0,
        1,
        2,
        3,
        3,
        3,
        2,
        -1,
        2,
        1,
        2,
        2,
        1,
        2,
        0,
        0,
        1,
        0,
        3,
        3,
        3,
        2,
        1,
        2,
        1,
        1,
        3,
        2,
        -1,
        2,
        2,
        0,
        1,
        1,
        -1,
        0,
        2,
        2,
        0,
        1,
        0,
        2,
        2
      ],
      "flags": [
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "multi",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 29,
      "total": 50,
      "percent": 58,
      "demo": true
    },
    {
      "id": "demo-sheet-e6",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 10,
      "studentName": "Sam Ocampo",
      "grade": "8",
      "section": "Molave",
      "answers": [
        1,
        3,
        2,
        2,
        3,
        2,
        3,
        -1,
        2,
        1,
        2,
        0,
        1,
        -1,
        2,
        1,
        1,
        2,
        2,
        3,
        3,
        1,
        -1,
        2,
        2,
        2,
        1,
        0,
        2,
        1,
        2,
        2,
        -1,
        2,
        3,
        3,
        2,
        2,
        1,
        2,
        2,
        2,
        2,
        2,
        0,
        3,
        3,
        3,
        3,
        1
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 24,
      "total": 50,
      "percent": 48,
      "demo": true
    },
    {
      "id": "demo-sheet-e7",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 11,
      "studentName": "Tina Delgado",
      "grade": "8",
      "section": "Molave",
      "answers": [
        2,
        0,
        1,
        -1,
        2,
        0,
        2,
        1,
        3,
        2,
        1,
        1,
        2,
        0,
        1,
        2,
        2,
        2,
        2,
        2,
        0,
        2,
        2,
        1,
        -1,
        2,
        1,
        3,
        -1,
        3,
        2,
        2,
        2,
        1,
        2,
        0,
        2,
        1,
        0,
        1,
        2,
        1,
        3,
        -1,
        2,
        1,
        0,
        1,
        -1,
        3
      ],
      "flags": [
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "multi",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "multi",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok"
      ],
      "correct": 19,
      "total": 50,
      "percent": 38,
      "demo": true
    },
    {
      "id": "demo-sheet-e8",
      "classId": "demo-cls-eng",
      "className": "English 8-B",
      "quizId": "demo-quiz-2",
      "studentNo": 12,
      "studentName": "Vina Castro",
      "grade": "8",
      "section": "Molave",
      "answers": [
        -1,
        0,
        0,
        1,
        3,
        2,
        3,
        3,
        2,
        0,
        2,
        2,
        3,
        3,
        1,
        3,
        3,
        3,
        -1,
        1,
        -1,
        0,
        1,
        2,
        -1,
        1,
        2,
        3,
        -1,
        0,
        1,
        3,
        0,
        0,
        2,
        0,
        2,
        1,
        1,
        1,
        1,
        -1,
        2,
        2,
        -1,
        2,
        1,
        3,
        0,
        1
      ],
      "flags": [
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "multi",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "multi",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "blank",
        "ok",
        "ok",
        "ok",
        "ok",
        "ok"
      ],
      "correct": 13,
      "total": 50,
      "percent": 26,
      "demo": true
    }
  ]
}
