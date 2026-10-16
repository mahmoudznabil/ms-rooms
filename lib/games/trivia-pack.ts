/**
 * Static trivia pack — the offline fallback for the room trivia game.
 *
 * Phase A2/B3: this pool used to live inline in MiniGamePanel.tsx as the
 * 16-question `TRIVIA_QUESTIONS` array, which players saw repeating within a
 * single evening. It is extracted here at 60 mixed-easy questions and served
 * as the last-resort deck once the server pack (Workers AI, `trivia_packs`
 * table) is available — the client asks the server first and only falls back
 * to this list when the request fails or the binding is absent.
 *
 * `buildTriviaDeck` deals a full shuffled round with no repeats; the previous
 * deck is seeded in so the next round does not open with what was just shown.
 */

export interface TriviaQuestion {
  q: string;
  /** Exactly four options; exactly one is correct. */
  options: string[];
  /** Index into `options`. */
  correct: number;
}

export const TRIVIA_POOL: TriviaQuestion[] = [
  { q: "What is the capital of France?", options: ["London", "Paris", "Berlin", "Madrid"], correct: 1 },
  { q: "Which planet is known as the Red Planet?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correct: 2 },
  { q: "How many continents are there?", options: ["5", "6", "7", "8"], correct: 2 },
  { q: "What gas do plants absorb from the air?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], correct: 2 },
  { q: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 },
  { q: "Who painted the Mona Lisa?", options: ["Van Gogh", "Da Vinci", "Picasso", "Monet"], correct: 1 },
  { q: "Which metal is liquid at room temperature?", options: ["Iron", "Lead", "Mercury", "Copper"], correct: 2 },
  { q: "What is H2O commonly known as?", options: ["Salt", "Sugar", "Water", "Oxygen"], correct: 2 },
  { q: "How many days are in a leap year?", options: ["364", "365", "366", "367"], correct: 2 },
  { q: "What is the hardest natural substance?", options: ["Quartz", "Diamond", "Titanium", "Obsidian"], correct: 1 },
  { q: "How many letters are in the English alphabet?", options: ["24", "25", "26", "28"], correct: 2 },
  { q: "Which animal is known as man's best friend?", options: ["Cat", "Horse", "Dog", "Parrot"], correct: 2 },
  { q: "What is the largest land animal?", options: ["Rhino", "Hippopotamus", "Elephant", "Giraffe"], correct: 2 },
  { q: "How many zeros are in one thousand?", options: ["2", "3", "4", "5"], correct: 2 },
  { q: "Which planet do we live on?", options: ["Mars", "Earth", "Venus", "Jupiter"], correct: 1 },
  { q: "What do bees make?", options: ["Milk", "Honey", "Silk", "Soap"], correct: 1 },
  { q: "How many minutes are in one hour?", options: ["30", "50", "60", "100"], correct: 2 },
  { q: "Which fruit is said to keep the doctor away?", options: ["Banana", "Apple", "Orange", "Grapes"], correct: 1 },
  { q: "What do you call a baby dog?", options: ["Kitten", "Puppy", "Cub", "Foal"], correct: 1 },
  { q: "How many sides does a triangle have?", options: ["3", "4", "5", "6"], correct: 0 },
  { q: "What is the opposite of hot?", options: ["Warm", "Cold", "Wet", "Dry"], correct: 1 },
  { q: "Which body part pumps blood?", options: ["Brain", "Lungs", "Heart", "Liver"], correct: 2 },
  { q: "What color is a ripe banana's peel?", options: ["Red", "Yellow", "Blue", "Purple"], correct: 1 },
  { q: "How many hours are in a full day?", options: ["12", "20", "24", "28"], correct: 2 },
  { q: "What do you wear on your feet?", options: ["Hat", "Socks on hands", "Shoes", "Gloves"], correct: 2 },
  { q: "Which shape has three sides?", options: ["Square", "Circle", "Triangle", "Hexagon"], correct: 2 },
  { q: "What do cats say?", options: ["Moo", "Meow", "Woof", "Quack"], correct: 1 },
  { q: "How many wheels does a bicycle have?", options: ["1", "2", "3", "4"], correct: 1 },
  { q: "Frozen water is called what?", options: ["Steam", "Ice", "Fog", "Foam"], correct: 1 },
  { q: "Which season is the coldest?", options: ["Spring", "Summer", "Autumn", "Winter"], correct: 3 },
  { q: "What do you call a group of wolves?", options: ["Pack", "Flock", "Herd", "Pride"], correct: 0 },
  { q: "Which instrument has black and white keys?", options: ["Guitar", "Drums", "Piano", "Flute"], correct: 2 },
  { q: "How many stars are on the flag of the United States?", options: ["48", "50", "52", "55"], correct: 1 },
  { q: "What is the freezing point of water in Celsius?", options: ["0", "10", "32", "100"], correct: 0 },
  { q: "Which gas do humans need to breathe to live?", options: ["Helium", "Oxygen", "Neon", "Argon"], correct: 1 },
  { q: "What shape has four equal sides?", options: ["Rectangle", "Circle", "Square", "Triangle"], correct: 2 },
  { q: "How many degrees are in a right angle?", options: ["45", "90", "180", "360"], correct: 1 },
  { q: "What is the sun?", options: ["A planet", "A star", "A moon", "A comet"], correct: 1 },
  { q: "How many days are in a week?", options: ["5", "6", "7", "8"], correct: 2 },
  { q: "Which food is baked from flour?", options: ["Bread", "Rice", "Fish", "Cheese"], correct: 0 },
  { q: "What do you use to write on a whiteboard?", options: ["Pencil", "Chalk", "Marker", "Crayon"], correct: 2 },
  { q: "How many days are in January?", options: ["28", "30", "31", "32"], correct: 2 },
  { q: "What is the largest planet in our solar system?", options: ["Earth", "Mars", "Jupiter", "Venus"], correct: 2 },
  { q: "Which animal is a mammal?", options: ["Whale", "Frog", "Shark", "Penguin"], correct: 0 },
  { q: "How many teeth does an adult usually have?", options: ["24", "28", "32", "36"], correct: 2 },
  { q: "What do you call a baby cat?", options: ["Puppy", "Kitten", "Chick", "Calf"], correct: 1 },
  { q: "Which is used to measure temperature?", options: ["Thermometer", "Barometer", "Speedometer", "Compass"], correct: 0 },
  { q: "What is the chemical symbol for gold?", options: ["Go", "Gd", "Au", "Ag"], correct: 2 },
  { q: "How many months are in a year?", options: ["10", "11", "12", "13"], correct: 2 },
  { q: "Which direction does the sun rise from?", options: ["North", "South", "East", "West"], correct: 2 },
  { q: "What do you call a group of fish?", options: ["School", "Pack", "Flock", "Swarm"], correct: 0 },
  { q: "How many cents are in a dollar?", options: ["50", "75", "100", "125"], correct: 2 },
  { q: "Which organ do you think with?", options: ["Heart", "Brain", "Lungs", "Stomach"], correct: 1 },
  { q: "What is the tallest animal in the world?", options: ["Elephant", "Giraffe", "Camel", "Ostrich"], correct: 1 },
  { q: "How many strings does a standard guitar have?", options: ["4", "5", "6", "8"], correct: 2 },
  { q: "Which of these is a vegetable?", options: ["Apple", "Carrot", "Banana", "Grape"], correct: 1 },
  { q: "What do you call a baby horse?", options: ["Puppy", "Foal", "Kitten", "Cub"], correct: 1 },
  { q: "How many wheels does a car typically have?", options: ["2", "3", "4", "6"], correct: 2 },
  { q: "Which planet is famous for its rings?", options: ["Mars", "Venus", "Saturn", "Mercury"], correct: 2 },
  { q: "What is the first letter of the alphabet?", options: ["A", "B", "C", "D"], correct: 0 },
];

/** How many questions one full round deals out. */
export const TRIVIA_ROUND = 10;

/**
 * Deal a shuffled round of `TRIVIA_ROUND` questions (or `size`, capped at the
 * pool length). `exclude` seeds the exclusion list with previously seen
 * questions so a new round does not open with what the last one ended on.
 */
export function buildTriviaDeck(
  size: number = TRIVIA_ROUND,
  exclude: string[] = []
): TriviaQuestion[] {
  const seen = new Set(exclude);
  const fresh = TRIVIA_POOL.filter((q) => !seen.has(q.q));
  const source = fresh.length >= size ? fresh : TRIVIA_POOL;
  const deck = [...source];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, Math.min(size, deck.length));
}
