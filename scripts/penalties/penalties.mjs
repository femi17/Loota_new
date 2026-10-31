// The penalties (owner, 31 Oct 2026: "the penalty shouldn't always be the same every time… a database of penalties…
// like 500 - 1000"). Each one is a trap (what happens) with a cost (what it takes). Deep penalties are for the wrong
// location ("in movies they always end up dead"), soft ones for the wrong room inside a key's house.
//   node scripts/penalties/penalties.mjs          print how many there are of each kind
//   npm run penalties:seed                        write them to the database (public.penalties; new and changed rows)
// Scenes: collapse, darts, flood, smoke, net, boulder, fire, swarm, masquerade, storm, fall, gas, cage, mirror, snake.

/** The wrong location: things that end the scene (a blackout, never gore). */
const DEEP = [
  ["The floor gives way", "You step through the wrong doorway, and the boards under your feet were never meant to hold anyone.", "collapse"],
  ["A grey coat in the crowd", "A hand on your shoulder, a smell of cologne, a whisper in your ear: \"Wrong place, hunter.\"", "masquerade"],
  ["Sleeping gas", "A hiss from somewhere behind the walls, a sweet smell like burnt sugar, and your legs fold like paper.", "gas"],
  ["The tide comes in", "You were so sure of yourself you never noticed the water round your ankles. Then your knees. Then everything.", "flood"],
  ["A net from above", "Rope rains down out of the dark. You thrash. Every knot only pulls tighter.", "net"],
  ["Rockfall", "A rumble overhead, a cloud of dust, and the way you came in vanishes behind a wall of stone.", "boulder"],
  ["The hall of mirrors", "Every way out shows you your own face. You walk into glass after glass until the room starts to spin.", "mirror"],
  ["The bridge snaps", "Halfway across, the old rope makes a sound like a gunshot.", "fall"],
  ["The swarm", "Wings. Thousands of them, out of nowhere. You run blind with your arms over your head.", "swarm"],
  ["The door clicks shut", "The door locks behind you with a soft click. Somewhere outside, a man laughs.", "cage"],
  ["The lamp tips over", "One knock of your elbow, one old lamp, and the room fills with smoke faster than you can find the door.", "fire"],
  ["Quicksand", "The ground here looks perfectly solid. It isn't.", "fall"],
  ["A storm out of nowhere", "Thunder splits the sky and the wind picks you up like a sweet wrapper.", "storm"],
  ["The friendly driver", "A smiling driver offers you a lift. The doors lock. The windows are painted black.", "masquerade"],
  ["The forged map", "The map you trusted was drawn by someone who wanted you lost. You followed it perfectly.", "masquerade"],
  ["Something in the dark", "Something cold and patient slides across your boot.", "snake"],
  ["The endless stairs", "You count a hundred steps down, then two hundred. The light behind you has gone.", "fall"],
  ["The dart wall", "A click under your heel. The wall answers with a rattle of tiny darts, and the world goes soft.", "darts"],
  ["The trapdoor", "A trapdoor you never saw, and a cellar that smells of salt and old rope.", "collapse"],
  ["The crowd", "A crowd swells round you out of nowhere and carries you off like a river in flood.", "storm"],
  ["Fog", "Fog rolls in so thick you can't see your own hands, and every street looks like every other street.", "smoke"],
  ["The wrong statue", "You lean on the old statue to catch your breath. It turns.", "boulder"],
  ["The bell", "Somewhere above you a great bell swings, once, and the sound knocks you flat.", "collapse"],
  ["Smoke from the well", "You lean over the old well to look. The well breathes out.", "gas"],
  ["The cage", "Iron bars drop out of the ceiling and close round you like fingers.", "cage"],
  ["The Masquerade's tea", "A kind stranger offers you a glass of sweet tea. You only remember the first sip.", "masquerade"],
  ["A wave", "One wave, bigger than all the others, comes over the wall without a sound.", "flood"],
  ["The rolling stone", "A grinding behind you. You turn just in time to see the stone ball coming down the passage.", "boulder"],
  ["The candle goes out", "Your light gutters and dies, and the dark has hands.", "smoke"],
  ["The false floor", "The tiles here are painted on canvas. You find out the hard way.", "collapse"],
];

/** The wrong room in a key's house: tricks that throw you out (never harm). */
const SOFT = [
  ["The creaking board", "A floorboard creaks, a bell rings somewhere, and a very old dog chases you out.", "collapse"],
  ["Darts from the frame", "The portrait's eyes click. Two soft darts tickle your neck and you stagger out, giggling.", "darts"],
  ["The wardrobe", "The wardrobe was a slide. You land outside in a hedge.", "fall"],
  ["The bucket over the door", "A bucket of cold water over the door. The oldest trick in the world, and it got you.", "flood"],
  ["The rug", "The rug slides, and so do you, all the way down the hall and out of the front door.", "fall"],
  ["The bookcase", "You pull the wrong book. The bookcase spins, and you're outside in the garden.", "mirror"],
  ["Cobwebs", "You walk face-first into a curtain of cobwebs and run out flapping.", "net"],
  ["The cuckoo clock", "The clock strikes, the cuckoo shoots out on a spring, and you fall backwards over a chair.", "darts"],
  ["The piano lid", "The piano lid slams like a gunshot and you're out of the room before you know it.", "collapse"],
  ["The coal chute", "Behind the little door: a coal chute. You come out at the bottom, black as a chimney sweep.", "fall"],
  ["Lights out", "Every light in the house goes out at once. When they come back, you're on the doorstep.", "smoke"],
  ["The parrot", "A parrot in a cage shrieks your name. You jump so hard you end up in the street.", "swarm"],
  ["Itching powder", "The cushion was full of itching powder. You scratch your way outside.", "gas"],
  ["The locked door", "The door shuts behind you and the only way out is the window, into the flower bed.", "cage"],
  ["Sneezing", "You open the old chest and a cloud of dust makes you sneeze until you have to go outside.", "smoke"],
  ["The mousetrap", "A mousetrap the size of a car tyre snaps an inch from your foot. You leave. Quickly.", "cage"],
  ["The bath", "The bath was full, the floor was wet, and gravity did the rest. Outside to dry.", "flood"],
  ["Bees", "There's a beehive in the chimney. You find out by putting your head in it.", "swarm"],
  ["The ghost", "A white sheet rises from the bed with a long low moan. You don't stay to see who's under it.", "mirror"],
  ["The staircase", "The stairs flatten into a slide. You whoosh down and out of the front door.", "fall"],
  ["The kettle", "The kettle screams, the cat screams, you scream. Everyone ends up outside.", "fire"],
  ["The suit of armour", "The suit of armour falls over with a crash that brings the neighbours. You're shown out.", "boulder"],
  ["The cellar door", "Down the wrong stairs and up the coal hole into the street.", "collapse"],
  ["The fishing net", "A net drops from the ceiling. By the time you wriggle free, you're out on the porch.", "net"],
  ["Pepper", "The pepper pot on the table was a trap. You sneeze yourself out of the room.", "gas"],
  ["The goat", "There is a goat in this room. The goat does not want you in this room.", "swarm"],
  ["The swing", "You sit on the old swing. It swings you straight through the open window.", "fall"],
  ["The trick mirror", "You walk confidently into a mirror you thought was a doorway, and out of the house rubbing your nose.", "mirror"],
  ["The wind", "A window bangs open and the wind blows every paper, and you, out of the room.", "storm"],
  ["The music box", "The music box plays, the floor turns like a record, and you spin right out of the door.", "mirror"],
  ["Soot", "A cloud of soot falls down the chimney. You come out looking like a burnt toast.", "smoke"],
  ["The snake in the basket", "You lift the lid of the basket. The snake lifts its head. You put the lid back and leave.", "snake"],
  ["Marbles", "A thousand marbles roll out from under the bed and carry you out like a conveyor belt.", "fall"],
  ["The wrong drawer", "The drawer was full of springs. All of them, at once.", "darts"],
  ["Smoke bomb", "Something pops, the room fills with purple smoke, and you cough your way outside.", "smoke"],
  ["The dumb waiter", "You squeeze into the little lift in the wall. It goes down. A long way down. You come out in the yard.", "fall"],
  ["The guard dog", "Behind the door: a dog, asleep. Then not asleep.", "swarm"],
  ["The rocking chair", "The rocking chair starts rocking by itself. You decide you've seen enough of this room.", "mirror"],
  ["The leak", "One pipe, one turn of the wrong tap, and a fountain chases you out.", "flood"],
  ["The fake wall", "You lean on the wall. It's a door. You're outside.", "collapse"],
];

/** How each cost is told, after the trap. ${n}: the amount (minutes for waits). */
const DEEP_COST = {
  wait: [
    (n) => `You come round ${n} minutes later with a headache and no idea how long you were out. No new answer until then.`,
    (n) => `Everything goes black. It takes ${n} minutes before your head is clear enough to think of another place.`,
    (n) => `When you wake, the sun has moved. ${n} minutes gone before you can name a new place.`,
    (n) => `You sit in the dust for ${n} minutes, getting your breath back, before you can even think of where to go.`,
  ],
  coins: [
    (n) => `When you wake up, your pockets are lighter: ${n} coins gone.`,
    (n) => `You come round. Your bag is open and ${n} coins are missing.`,
    (n) => `It costs ${n} coins to pay the people who pull you out.`,
    (n) => `Somebody helped themselves while you were out cold: ${n} coins.`,
  ],
  energy: [
    (n) => `It takes everything you have to crawl out. ${n} energy gone.`,
    (n) => `You drag yourself out, shaking and soaked. ${n} energy gone.`,
    (n) => `You get out, but only just. ${n} energy gone.`,
    (n) => `By the time you're free you can barely stand. ${n} energy gone.`,
  ],
  back: [
    () => "You wake up back where you set off for this key. The whole journey, for nothing.",
    () => "When the world stops spinning, you're right back where this leg began.",
    () => "Someone has carried you all the way back to where you started this leg. You never saw their face.",
    () => "You open your eyes back where you set off, with sand in your shoes and no memory of the trip.",
  ],
};
const SOFT_COST = {
  wait: [
    (n) => `You're out of the house. The door won't open again for ${n} seconds.`,
    (n) => `Thrown out. ${n} seconds before you can go back in.`,
    (n) => `You land on the doorstep. It takes ${n} seconds to get your nerve back.`,
  ],
  coins: [
    (n) => `You're out of the house, and ${n} coins rolled away somewhere on the way.`,
    (n) => `Out you go, and the house keeps ${n} coins for its trouble.`,
    (n) => `You drop ${n} coins in the scramble.`,
  ],
  energy: [
    (n) => `Out you go, puffing. ${n} energy gone.`,
    (n) => `It knocks the wind out of you: ${n} energy gone.`,
    (n) => `You're out, and ${n} energy with you.`,
  ],
};
const DEEP_AMOUNTS = { wait: [180, 300, 420, 600], coins: [25, 50, 80, 120], energy: [20, 30, 45, 60], back: [1, 1, 1, 1] };
const SOFT_AMOUNTS = { wait: [30, 60, 90, 120, 150], coins: [5, 10, 15, 20, 30], energy: [5, 10, 15, 20] };

export function penalties() {
  const out = [];
  DEEP.forEach(([title, text, scene], i) => {
    for (const effect of ["wait", "coins", "energy", "back"]) {
      for (let v = 0; v < 2; v++) {
        const amount = DEEP_AMOUNTS[effect][(i + v * 2) % DEEP_AMOUNTS[effect].length];
        const line = DEEP_COST[effect][(i + v) % DEEP_COST[effect].length];
        const n = effect === "wait" ? Math.round(amount / 60) : amount;
        out.push({ code: `deep-${String(i + 1).padStart(2, "0")}-${effect}-${v + 1}`, tier: "deep", effect, amount, title, body: `${text} ${line(n)}`, scene });
      }
    }
  });
  SOFT.forEach(([title, text, scene], i) => {
    for (const effect of ["wait", "coins", "energy"]) {
      for (let v = 0; v < 3; v++) {
        const amounts = SOFT_AMOUNTS[effect];
        const amount = amounts[(i + v * 2) % amounts.length];
        const line = SOFT_COST[effect][(i + v) % SOFT_COST[effect].length];
        out.push({ code: `soft-${String(i + 1).padStart(2, "0")}-${effect}-${v + 1}`, tier: "soft", effect, amount, title, body: `${text} ${line(amount)}`, scene });
      }
    }
  });
  return out;
}

if (process.argv[1]?.endsWith("penalties.mjs")) {
  const all = penalties();
  const count = (f) => all.filter(f).length;
  console.log(`${all.length} penalties: ${count((p) => p.tier === "deep")} deep, ${count((p) => p.tier === "soft")} soft`);
  for (const e of ["wait", "coins", "energy", "back"]) console.log(`  ${e}: ${count((p) => p.effect === e)}`);
  console.log(`unique bodies: ${new Set(all.map((p) => p.body)).size}`);
}
