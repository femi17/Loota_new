/**
 * Lost Vowels (a Key Trial word puzzle, owner, 1 Nov 2026: puzzles at the key; general knowledge from all walks of
 * life): a theme and a few words with their vowels gone, each with a clue. Type each word whole. The words stay on
 * the game's server; only their skeletons ("M_NT _V_R_ST") reach the phone.
 */
import { seeded } from "./rng.ts";

export type VowelsPuzzle = { theme: string; words: { shown: string; clue: string; letters: number }[] };
export type VowelsAnswer = string[];

/** Themes from all walks of life, known the world over; five words each (a puzzle takes 3 to 5). */
const THEMES: { theme: string; words: [string, string][] }[] = [
  { theme: "The world's great rivers", words: [["NILE", "Africa's longest"], ["AMAZON", "Through the rainforest"], ["DANUBE", "Through Vienna and Budapest"], ["MISSISSIPPI", "America's Old Man River"], ["YANGTZE", "China's longest"]] },
  { theme: "Planets", words: [["MERCURY", "Closest to the Sun"], ["VENUS", "The hottest"], ["JUPITER", "The biggest"], ["SATURN", "The one with the famous rings"], ["NEPTUNE", "The farthest"]] },
  { theme: "In the kitchen", words: [["SAUCEPAN", "Boils the rice"], ["COLANDER", "Drains the pasta"], ["WHISK", "Beats the eggs"], ["OVEN", "Bakes the bread"], ["SPATULA", "Flips the pancake"]] },
  { theme: "Musical instruments", words: [["PIANO", "Black and white keys"], ["VIOLIN", "Played with a bow, under the chin"], ["TRUMPET", "Brass, three valves"], ["GUITAR", "Six strings"], ["SAXOPHONE", "Brass body, but a reed: a woodwind"]] },
  { theme: "Football", words: [["GOALKEEPER", "Can use their hands"], ["PENALTY", "From the spot"], ["OFFSIDE", "Flagged for being too far forward"], ["STADIUM", "Where the fans sit"], ["REFEREE", "Blows the whistle"]] },
  { theme: "Inside the human body", words: [["HEART", "Pumps the blood"], ["LUNGS", "You breathe with them"], ["LIVER", "Cleans the blood, the biggest gland"], ["SKELETON", "206 bones"], ["KIDNEY", "You have two; they make urine"]] },
  { theme: "Capital cities", words: [["PARIS", "On the Seine"], ["TOKYO", "Japan's"], ["NAIROBI", "Kenya's"], ["OTTAWA", "Canada's, not Toronto"], ["CANBERRA", "Australia's, not Sydney"]] },
  { theme: "Weather", words: [["THUNDER", "After the lightning"], ["RAINBOW", "Seven colours after rain"], ["HURRICANE", "A great Atlantic storm"], ["DROUGHT", "No rain for months"], ["HUMIDITY", "Water in the air"]] },
  { theme: "Big animals", words: [["ELEPHANT", "The biggest on land"], ["GIRAFFE", "The tallest"], ["HIPPOPOTAMUS", "The river horse"], ["RHINOCEROS", "A horn on its nose"], ["GORILLA", "The biggest ape"]] },
  { theme: "Sea creatures", words: [["OCTOPUS", "Eight arms"], ["DOLPHIN", "Clever, and breathes air"], ["JELLYFISH", "Stings, no bones"], ["SEAHORSE", "The father carries the young"], ["WHALE", "The blue one is the biggest animal ever"]] },
  { theme: "At the airport", words: [["PASSPORT", "Shown at the border"], ["RUNWAY", "Where the plane takes off"], ["LUGGAGE", "Your bags"], ["BOARDING", "The gate opens for it"], ["CUSTOMS", "Anything to declare?"]] },
  { theme: "Science words", words: [["ATOM", "The smallest bit of an element"], ["GRAVITY", "What keeps your feet on the ground"], ["MAGNET", "North and south poles"], ["OXYGEN", "We breathe it"], ["VOLCANO", "A mountain that erupts"]] },
  { theme: "Fruit", words: [["BANANA", "Yellow and curved"], ["PINEAPPLE", "A crown of leaves"], ["MANGO", "Sweet, with a big flat stone"], ["AVOCADO", "Green inside, makes guacamole"], ["ORANGE", "A fruit and a colour"]] },
  { theme: "The Olympics", words: [["MARATHON", "42 kilometres"], ["GYMNASTICS", "Bars, beam and floor"], ["SPRINT", "The hundred metres"], ["MEDAL", "Gold, silver or bronze"], ["TORCH", "Carries the flame"]] },
  { theme: "At school", words: [["TEACHER", "At the front of the class"], ["HOMEWORK", "Done at home"], ["LIBRARY", "Quiet, full of books"], ["EXAMINATION", "A test at the end of the year"], ["PLAYGROUND", "Where break is spent"]] },
  { theme: "Wonders of the world", words: [["PYRAMID", "Giza's great tomb"], ["COLOSSEUM", "Rome's arena"], ["TAJ MAHAL", "A tomb of white marble for a queen"], ["PETRA", "A city cut into pink rock"], ["MACHU PICCHU", "An Inca city in the clouds"]] },
  { theme: "Jobs", words: [["DOCTOR", "Treats the sick"], ["CARPENTER", "Works with wood"], ["PILOT", "Flies the plane"], ["FARMER", "Grows the food"], ["ENGINEER", "Designs the bridge"]] },
  { theme: "Colours", words: [["PURPLE", "Red and blue"], ["ORANGE", "Red and yellow"], ["TURQUOISE", "Between green and blue"], ["MAROON", "A dark brownish red"], ["INDIGO", "Between blue and violet in the rainbow"]] },
  { theme: "Things in the sky", words: [["MOON", "Goes round the Earth"], ["COMET", "A tail of ice and dust"], ["SATELLITE", "Goes round a planet"], ["CLOUD", "Water you can see"], ["METEOR", "A shooting star"]] },
  { theme: "Board and card games", words: [["CHESS", "Checkmate wins"], ["DOMINOES", "Matching spots"], ["MONOPOLY", "Buy streets, build hotels"], ["SCRABBLE", "Letter tiles for points"], ["POKER", "A royal flush beats everything"]] },
  { theme: "Inventions", words: [["TELEPHONE", "Bell's"], ["LIGHT BULB", "Edison made it last"], ["PRINTING PRESS", "Gutenberg's"], ["AEROPLANE", "The Wright brothers'"], ["INTERNET", "A network of networks"]] },
  { theme: "Continents", words: [["AFRICA", "The Sahara is here"], ["EUROPE", "The Alps are here"], ["ASIA", "The biggest"], ["ANTARCTICA", "The coldest"], ["AUSTRALIA", "A country and a continent"]] },
  { theme: "Gemstones", words: [["DIAMOND", "The hardest"], ["RUBY", "Red"], ["EMERALD", "Green"], ["SAPPHIRE", "Usually blue"], ["PEARL", "Made inside an oyster"]] },
  { theme: "Dances", words: [["SALSA", "Also a sauce"], ["TANGO", "From Argentina"], ["BALLET", "On the tips of the toes"], ["WALTZ", "One two three, one two three"], ["SAMBA", "Rio's carnival dance"]] },
  { theme: "Trees", words: [["OAK", "Acorns"], ["PALM", "Coconuts"], ["MAPLE", "On Canada's flag"], ["BAOBAB", "The upside-down tree"], ["WILLOW", "Weeps by the water"]] },
  { theme: "Water, water", words: [["OCEAN", "The Pacific is one"], ["LAGOON", "Shut off from the sea by sand"], ["WATERFALL", "Niagara is one"], ["CANAL", "Dug for boats"], ["GLACIER", "A river of ice"]] },
  { theme: "Film", words: [["DIRECTOR", "Shouts 'Action!'"], ["CINEMA", "Where the film is shown"], ["SEQUEL", "Part two"], ["CARTOON", "Drawn, not filmed"], ["AUDITION", "Trying out for a part"]] },
  { theme: "Birds", words: [["EAGLE", "On many countries' flags"], ["PENGUIN", "Can't fly, can swim"], ["OSTRICH", "The biggest bird"], ["PARROT", "Can learn to talk"], ["FLAMINGO", "Pink, on one leg"]] },
  { theme: "Money", words: [["DOLLAR", "America's"], ["EURO", "Used across Europe"], ["POUND", "Britain's"], ["YEN", "Japan's"], ["RUPEE", "India's"]] },
  { theme: "Clothes", words: [["TROUSERS", "Two legs"], ["JACKET", "Worn over a shirt"], ["SANDALS", "Open shoes"], ["SWEATER", "Knitted, keeps you warm"], ["SCARF", "Round the neck"]] },
];

/**
 * Harder themes, for the later keys (owner, 8 Nov 2026: "the questions are cheap not tasking… We already gave easy
 * story clues"): words that need knowing, with clues that don't give them away.
 */
const HARD_THEMES: { theme: string; words: [string, string][] }[] = [
  { theme: "African capitals", words: [["OUAGADOUGOU", "Burkina Faso's"], ["ADDIS ABABA", "Ethiopia's, home of the African Union"], ["ANTANANARIVO", "Madagascar's"], ["NIAMEY", "Niger's"], ["MAPUTO", "Mozambique's"]] },
  { theme: "Chemical elements", words: [["TUNGSTEN", "Symbol W"], ["POTASSIUM", "Symbol K"], ["SODIUM", "Symbol Na"], ["ANTIMONY", "Symbol Sb"], ["LEAD", "Symbol Pb"]] },
  { theme: "Nigeria's history", words: [["LUGARD", "The British governor who joined north and south in 1914"], ["ABUJA", "The capital since 1991"], ["BIAFRA", "The breakaway republic of 1967"], ["AZIKIWE", "The first President"], ["BALEWA", "The first Prime Minister"]] },
  { theme: "Nigerian writers", words: [["ACHEBE", "Things Fall Apart"], ["SOYINKA", "Africa's first Nobel Prize in Literature"], ["ADICHIE", "Half of a Yellow Sun"], ["OKRI", "The Famished Road, Booker Prize 1991"], ["EMECHETA", "Second Class Citizen"]] },
  { theme: "Painters", words: [["PICASSO", "Guernica"], ["VERMEER", "Girl with a Pearl Earring"], ["REMBRANDT", "The Night Watch"], ["MONET", "Impression, Sunrise"], ["MATISSE", "The Snail, cut from paper"]] },
  { theme: "Composers", words: [["BEETHOVEN", "Deaf when he wrote his Ninth"], ["MOZART", "The Magic Flute"], ["VIVALDI", "The Four Seasons"], ["TCHAIKOVSKY", "Swan Lake"], ["HANDEL", "Messiah"]] },
  { theme: "Thinkers", words: [["SOCRATES", "Drank hemlock in Athens"], ["DESCARTES", "I think, therefore I am"], ["CONFUCIUS", "China's teacher of the Analects"], ["NIETZSCHE", "God is dead"], ["ARISTOTLE", "Taught Alexander the Great"]] },
  { theme: "Bones", words: [["FEMUR", "The longest"], ["CLAVICLE", "The collarbone"], ["PATELLA", "The kneecap"], ["STERNUM", "The breastbone"], ["MANDIBLE", "The lower jaw"]] },
  { theme: "Geometry", words: [["HYPOTENUSE", "A right-angled triangle's longest side"], ["RADIUS", "Half the diameter"], ["TRAPEZIUM", "Four sides, one pair parallel"], ["PERIMETER", "The distance round a shape"], ["OCTAGON", "A stop sign's shape"]] },
  { theme: "Mountains", words: [["KILIMANJARO", "Africa's highest"], ["ACONCAGUA", "The highest in the Americas"], ["ELBRUS", "Europe's highest, in the Caucasus"], ["MATTERHORN", "The pyramid peak above Zermatt"], ["EVEREST", "The world's highest"]] },
  { theme: "Deserts", words: [["SAHARA", "The largest hot one"], ["GOBI", "Mongolia's"], ["KALAHARI", "Botswana's"], ["ATACAMA", "Chile's, the driest"], ["NAMIB", "Along Africa's south-west coast"]] },
  { theme: "Greek gods", words: [["ZEUS", "King of Olympus"], ["POSEIDON", "The sea"], ["ATHENA", "Wisdom"], ["HERMES", "The messenger, with winged sandals"], ["APHRODITE", "Love"]] },
  { theme: "Money matters", words: [["INFLATION", "Prices rising over time"], ["RECESSION", "Two quarters of shrinking"], ["DIVIDEND", "A share of the profit, paid out"], ["MONOPOLY", "One seller has the whole market"], ["TARIFF", "A tax on imports"]] },
  { theme: "Computers", words: [["ALGORITHM", "Step-by-step instructions"], ["PROCESSOR", "The CPU"], ["FIREWALL", "Blocks unwanted traffic"], ["COMPILER", "Turns code into machine code"], ["BANDWIDTH", "How much data gets through each second"]] },
  { theme: "Languages of Africa", words: [["HAUSA", "Across northern Nigeria and Niger"], ["SWAHILI", "East Africa's common tongue"], ["AMHARIC", "Ethiopia's official language"], ["YORUBA", "Lagos, Ibadan and Benin Republic"], ["ZULU", "South Africa's most spoken at home"]] },
  { theme: "Inventors", words: [["TESLA", "Alternating current"], ["MARCONI", "Radio"], ["NOBEL", "Dynamite, and the prizes in his name"], ["FLEMING", "Penicillin"], ["GUTENBERG", "The printing press"]] },
];

const VOWELS = /[AEIOU]/g;

/** A puzzle of `count` words (3 to 5) from one theme: the harder themes from level 2. */
export function makeVowels(seed: number, count: number, level = 1): { puzzle: VowelsPuzzle; answer: VowelsAnswer } {
  const rng = seeded(seed);
  const themes = level >= 2 ? HARD_THEMES : THEMES;
  const t = themes[rng.int(themes.length)];
  const words = rng.shuffle(t.words).slice(0, Math.max(3, Math.min(5, count)));
  return {
    puzzle: { theme: t.theme, words: words.map(([w, clue]) => ({ shown: w.replace(VOWELS, "_"), clue, letters: w.replace(/ /g, "").length })) },
    answer: words.map(([w]) => w),
  };
}

/** The same word, whatever the case and spacing. */
const plain = (s: unknown) => (typeof s === "string" ? s.toUpperCase().replace(/[^A-Z]/g, "") : "");

/** Is this the right answer? Every word as stored (the puzzle alone doesn't hold them). */
export function checkVowels(answer: VowelsAnswer, a: string[]): boolean {
  return Array.isArray(a) && a.length === answer.length && answer.every((w, i) => plain(a[i]) === plain(w));
}
