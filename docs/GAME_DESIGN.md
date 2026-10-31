# Loota — Game Design Document

**Version:** 0.1 (draft for review)
**Date:** 12 October 2026
**Status:** Proposal. Sections marked **[PROPOSAL]** are ideas waiting for the owner's decision. Everything else reflects decisions already made.

---

## 1. What Loota is

Loota is a real-world treasure hunt game played on a real map, in the spirit of *Ready Player One*.

- Loota (the platform owner) buys real prizes upfront from partner merchants, for example an iPhone or a car.
- Loota publishes hunts. Each hunt has a prize, a number of winners and a number of keys.
- Every player has a 3D avatar that starts at their real home location and travels on the real map using real travel options: walking, bicycle, motorbike, car, bus, train and plane.
- Riddles point to real places. Players must work out the place, travel there, and pass a timed challenge on arrival to earn a key.
- Keys must be collected in order. The first N players to collect all keys win.
- Hunts are streamed live on YouTube from the broadcast view.

### 1.1 Why merchants matter

- **Trust:** the merchant is the source of truth. The prize has already been bought from them, and they hand it to the winner.
- **Revenue now:** players spend coins on travel, fuel, food and tools during a hunt.
- **Revenue later:** once Loota has the players, merchants pay to be featured: sponsored stops, sponsored prizes and in-game placements at their real addresses.

### 1.2 Design pillars

Every feature must pass these four tests:

1. **Everything sits on the real map.** We are not building a fantasy world. Every avatar, vehicle, key, relic, stop and event has a real latitude and longitude.
2. **The journey is the game.** Travel is active, full of choices, and never something you just watch.
3. **Skill wins keys, money only saves time.** Rich players must not be able to buy victory. A player who only walks must still be able to win.
4. **It must be fun to watch.** Every mechanic should create moments the live stream can show.

---

## 2. Fairness rules (non-negotiable)

These rules protect pillar 3 and apply to every feature in this document.

| Rule | What it means in practice |
|---|---|
| Keys cannot be bought | A key is only ever earned by reaching the right place and passing the timed challenge. |
| Relics cannot be bought | Power items (sabotage, shields, radar) are only found by exploring. They cannot be bought with real money, and the most powerful ones cannot be traded. |
| Walking is always free | No player can ever be fully stuck. Walking costs nothing except time and energy, which food or rest restore. |
| Coins can be earned without paying | Odd jobs, coin drops, daily tasks and roaming all pay coins (section 9). |
| Failing costs travel, not money | A failed Key Trial throws the player 2 km away. Nobody can pay to skip the walk back or to retry sooner. |
| Spending has limits | There are caps per hunt on boosts, and repeated boosts give smaller gains. |
| Walkers get their own advantages | Footpaths and shortcuts only walkers can use, more coin drops collected at walking speed, and no fuel, parking or checkpoint costs. |

---

## 3. Core loop

```
Hunt announced (prize, winners, keys, start time)
        │
        ▼
Prepare: roam, do odd jobs, collect coins, relics and intel, maintain vehicles
        │
        ▼
Hunt starts → riddle for Key 1 is revealed
        │
        ▼
Work out the place ─► plan the trip (mode, route, budget)
        │
        ▼
Travel actively: walk or pedal, steer, stops, events, other players
        │
        ▼
Arrive ─► wrong place?  → "Cold" feedback, rethink and travel again
        │
        ▼ right place
Key Trial starts immediately: timed challenge (10–15 s per question)
        │
   pass ─┴─ miss or time out → thrown to a random spot 2 km away → travel back → new questions
        │
        ▼
Key N earned → riddle for Key N+1 revealed immediately
        │
        ▼
All keys collected → finishing position recorded → first N players win
        │
        ▼
Hunt ends → free roam continues until the next hunt
```

---

## 4. The avatar and the 3D layer

### 4.1 What three.js draws

three.js runs as a custom layer inside the Mapbox GL map. It shares the map's WebGL context and camera, so 3D objects appear on real streets and are hidden correctly behind buildings. Mapbox draws the map and three.js draws everything we own:

- **Player avatars:** rigged 3D characters.
- **Vehicles:** bicycle, motorbike, car, bus, train, plane, ambulance and tow truck.
- **Keys:** a glowing key model at each key location, styled by hunt tier.
- **Relics and pickups:** coin drops, intel scrolls and relics.
- **Effect volumes:** rain areas, traffic zones and storm clouds that the live show triggers or relics create.

### 4.2 Avatar animation states

| State | Animation |
|---|---|
| Idle | Idle breathing, looking around |
| Walking | Walk cycle; speed scales with movement |
| Running (sprint) | Run cycle |
| Bicycle | Seated pedalling; pedal speed matches cadence |
| Motorbike / car | Seated in the vehicle model |
| Bus / train | Avatar hidden; vehicle model moves, with a nameplate on the vehicle |
| Plane | Plane model follows the flight path; the camera zooms out |
| Tired (low energy) | Slower walk, hunched |
| Fainted | Collapse, then the ambulance arrives |
| Key earned | Celebration with the key model |
| Emote | Wave, point, dance (for meeting other players) |

### 4.3 Camera

- **Player view:** a chase camera that follows the player's own avatar from behind on a flat map (no 3D buildings). Starts at zoom 20.5 and 55° tilt on phones, zoom 19.5 and 60° on larger screens (settled by testing on a phone). Pinch to zoom; the camera zooms out automatically at high speed (car, plane).
- **Broadcast view:** a centre view showing all players, plus "follow one player". It can rotate automatically between leaders and interesting moments (section 11).

### 4.4 Customisation

Players customise their avatar and their owned vehicles (colours, skins).

**Built (13 Oct 2026):** 8 skin tones × 5 hair styles × 6 hair colours × 3 top styles × 12 top colours × 8 trouser colours × 4 extras = **276,480 looks**. New hunters start with a look derived from their account id (not one shared default), and a "Surprise me" button randomises it. Exact look-alikes can still happen with many players, so identity never depends on the look: every avatar carries its **unique hunter name tag**, and your own avatar is always marked **YOU**. Premium cosmetics (below) widen the range further.

- Basic options are free.
- Premium cosmetics are sold for coins. They are pure style and never affect speed, energy or keys, so they are a safe source of revenue.
- Some cosmetics can only be earned (trophies for keys, wins and legendary relic finds), so veteran players can show off.

### 4.5 Performance budget (mid-range Android phones)

| Asset | Budget |
|---|---|
| Avatar | ≤ 8,000 triangles, 1 texture ≤ 1024px |
| Each vehicle | ≤ 5,000 triangles |
| Initial 3D download | ≤ 5 MB total (glTF with Draco/meshopt compression, KTX2 textures) |
| Other avatars shown in full 3D | Nearest 20; others shown as simple 3D markers |
| Fallback | The flat 2D avatar marker if the device cannot run 3D smoothly |

**Prototype result (12 Oct 2026):** 476 avatars on a 3D Lagos map ran at 24 fps on a desktop PC, with no optimisation (each avatar is about 23 separate parts). Optimisations planned for the real build: merge each avatar's parts into one mesh, draw identical shapes in one batch (instancing), and use simpler models for distant players.

### 4.6 Crowds

Because avatars are drawn larger than life, hundreds of players at one key location merge into a solid blob (seen in the prototype). Rules:

- **Your own avatar is always drawn in full and on top.**
- **On a player's phone:** the nearest 30 players are drawn in full, the next ones smaller and faded, and the rest are grouped into a counter bubble ("+214 hunters here").
- **On the broadcast:** distant crowds are coloured dots or a heat glow; full avatars appear only when the camera is close in or following one player.
- Crowd counters at key locations are shown on the live stream ("500 hunters are at Key 3 right now").

---

## 5. Travel

### 5.1 Two kinds of travel

| Kind | Modes | Who moves the avatar |
|---|---|---|
| **Active** | Walk, bicycle, motorbike, car | The player. Tap the map to choose where to go (the route snaps to real roads) and the hunter travels there; on a keyboard, the arrow keys steer. |
| **Passenger** | Bus, train, plane | The vehicle, on its real route. The player must first get to the stop, station or airport and go through boarding. |

**Example:** a UK player joins a hunt in Lagos. They cycle (active) from home to the airport, park the bike (parking fee if owned) or return it (if rented), check in, board, fly (passenger), land, then take a bus or walk to the riddle location.

### 5.2 Active travel controls [PROPOSAL]

Designed for one thumb on a phone:

- **Tap the map** on a road or destination: a route along real roads is calculated to that point and shown as a line.
- **Free roam (no destination):** hold Go to keep moving and steer by tapping the map or with ◀ ▶. Movement stays on roads and footpaths (decided): at junctions the avatar follows the road closest to the steering direction. *Built 13 Oct 2026:* the road network comes from the map's own vector tiles around the player (no extra service); walkers may use footpaths but not motorways, bicycles can't use steps; aiming more than 135° away turns the hunter round; a dead end stops them facing back.
- **Position saving (built 13 Oct 2026):** the player's position is saved every few seconds. The server (`save_position`) rejects any move faster than the travel mode's sprint speed (with a 30% and 30 m margin) and returns the last valid spot, so teleporting is impossible. Players resume from their saved position.
- **Hold anywhere** to move (walk or pedal). Releasing makes the avatar coast and stop.
- **Hold the Sprint button** to sprint: it moves you on its own (no need to hold two buttons), faster but draining energy quickly. *(Prototype finding: requiring Go and Sprint together didn't work with a mouse or one thumb.)*
- **Chase camera:** while moving, the map rotates so the camera stays behind the avatar. Dragging or rotating the map pauses this until the player taps "Follow me".
- **Junction prompts:** where the route can split (shortcut, detour, sponsored stop), choices appear as tappable chips.
- **Re-route anytime** by tapping somewhere else.

The avatar never leaves the calculated route, so it cannot go through buildings or water and cannot teleport.

### 5.3 Energy (people) and fuel (vehicles)

- **Energy (0–100)** drains when walking or pedalling. It drains faster when sprinting and slower when coasting. At low energy the avatar slows down. At 0 the player faints (ambulance, hospital stay and bill, from the old version).
- **Fuel (0–100%)** drains for motorbike and car according to distance. An empty tank means pushing to a station or calling for help.
- Energy is restored by **rest stops** (free, slow), **food stops** (coins, fast) and **sponsored merchant stops** (section 8, best value).

### 5.4 Time scale (how long trips take)

All modes use real-world speeds multiplied by one hunt-wide **time scale factor C**, so the relative speeds of modes stay realistic.

```
real minutes on screen = distance_km ÷ (mode_speed_kmh × C) × 60
```

Base speeds:

| Mode | Base speed (km/h) | Fixed overhead (game minutes) |
|---|---|---|
| Walk | 5 | 0 |
| Bicycle | 16 | Rental pickup 5 |
| Motorbike | 35 | Rental pickup 5 |
| Car | 45 in cities, 80 on highways (from routing data) | Rental pickup 5 |
| Bus | 25 average including stops | Walk to stop + wait 7 |
| Train | 70 | Walk to station + wait 10 |
| Plane | 750 cruise | Check-in 60, boarding 20, taxi 10 (also scaled by C) |

Example trip times at **C = 12** (default):

| Trip | Real time on screen |
|---|---|
| Walk 1 km | 1 min |
| Walk 5 km | 5 min |
| Bicycle 10 km | 3 min |
| Motorbike 30 km | 4 min |
| Car 50 km (city) | 6 min |
| Bus 50 km | 10 min |
| Plane London → Lagos, 5,000 km | 33 min flight + about 8 min of airport time |

C is set per hunt. Daily hunts in one city use a lower C (trips feel longer and more local). Grand hunts spread across continents use a higher C.

### 5.5 Passenger travel flow

- **Bus:** walk to a real bus stop → buy a fare → wait → ride along the real route → choose your stop → get off and walk.
- **The bus rush** (owner, 17 Oct 2026): at night and at rush hour a city bus is a scramble. A crowd waits at the stop with the player (more at night). When the bus pulls in, a RUSH strip appears over the map (not a panel): five quick questions (sums, differences, times tables, halves, what comes next), 6 seconds each, while the crowd pushes for the door. Each right answer raises the chance of getting on: 10% with none, sure with all five. Missing it, the bus pulls off full and the next one comes (35 s by day, 3× that at night) with another rush; the fare stays paid, and the player may still cancel for a refund. The server keeps the answers and decides. A Fast Pass skips the rush.
- **Train:** the same, using real stations and lines where the data exists.
- **Plane:** travel to a real airport → book a ticket (price by distance) → check in **before the deadline** (late means a rebooking fee) → board → fly along the great-circle path → land → leave the airport.
- **Vehicle at the airport:** owned vehicles go into the player's pocket and come along (the pocket garage, 10.3); rentals are returned.

### 5.6 Retained from the old version

Kept and adapted: rest and rejuvenate stops, refuelling, fainting → ambulance → hospital, vehicle wear → breakdown → tow → garage, vehicle add-ons (helmet, lights, licence, insurance, registration), bus stops, nearest-airport lookup, rental pickup times, the leaderboard, referrals, lobby chat, AI-assisted question generation (with human review), the Paystack wallet, multi-device detection, and the broadcast.

Changed:
- Automatic travel becomes active travel.
- Prices move from naira to coins.
- Hard-coded Nigeria-only data becomes worldwide.
- Constants move from code to a server-side config editable per hunt.

---

## 6. Keys and riddles

### 6.1 Rules (decided)

- Keys are **sequential**: you cannot attempt Key 2 before holding Key 1.
- Every hunt has **K keys** and **N winners**, both set by the prize (section 10).
- Arriving at the right place starts a **Key Trial**: a timed challenge of 10–15 seconds per question.

### 6.2 Finding the place [PROPOSAL]

The problem: riddle answers will spread on WhatsApp and Twitter. The proposal is to **accept the spread and design around it**, in three layers:

1. **The riddle points to an area, such as a landmark, district or city.** Players form their answer by choosing a destination on the map. The game does **not** say whether the guess is right until the player arrives, so guessing has a real cost in time and coins.
2. **The Final Approach: on arrival in the right area (within about 2 km), a short second clue appears** that points to the exact spot, for example "Where the bronze horse looks at the sea." The player also gets a hot/cold signal. Only players who are physically there see this clue.
3. **Every player gets the same Key Trial category but different questions,** drawn at random from a large bank, so nobody can know what's coming or share the answers.

Why leaked answers don't break the game:
- **Travel is the bottleneck.** Knowing the answer still means making the journey, managing energy and paying fares.
- **Leaks help the players behind,** which keeps the whole field engaged longer. That's healthy, and it's good for the live show ("the answer is out — can the stragglers catch up?").
- **Decoy riddles:** some riddles have an obvious answer that is wrong. Players who copy rumours without thinking go to the wrong city.

**Arriving at the wrong place:** "Cold" feedback with a rough distance band ("You're more than 300 km from the key"). Spending coins or using an intel item narrows the band. This is how players can end up stranded somewhere far away, which is part of the fun.

### 6.3 The Key Trial

- **No waiting.** The trial starts as soon as the player reaches the key location, and the next riddle is revealed as soon as the key is earned.
- **Same category, different questions.** Each key has one category, the same for every player (for example "Key 3: Flags"). Each player gets different questions from that category.
- **10–15 seconds per question.** The number of questions per trial is set by the hunt tier, for example 3 for a daily hunt and 5 for a grand hunt.
- **One miss ends the attempt (decided).** A wrong answer or a timeout fails the trial. There are no second chances.
- **Failing throws the player out:** they land at a random point 2 km from the key location, snapped to the nearest walkable road (never water or a closed area). They keep their current vehicle and must travel back. A rented vehicle keeps charging. On return, they get a new set of questions from the same category.
- **No paying to skip.** The trip back cannot be bought off (fairness rule).
- Categories: mental maths, guess the flag, guess the logo, logic sequences, word scrambles, spot the difference, local-knowledge questions about the key's location, and memory (shown for 3 seconds, then asked).
- Questions come from a large bank tagged by difficulty. Later keys use harder questions.
- Trial answers are checked on the server only. The phone never receives the correct answers.

### 6.3a The hunt, felt [BUILT 17–18 Oct 2026]

The owner's charge: "the hunt experience is everything; how not to make it boring". Built in four parts:

1. **The start and the race.** Before a hunt: "Starts in m:ss" on its card; the last ten seconds a big countdown over the map, GO!, and the first riddle revealed for everyone at the same moment. During it (`hunt_feed`, every 6 s): news as it happens, each with how far from you ("🔑 Ada found Key 2 · 3.1 km from you", "⚔️ Tunde is in the Key 1 trial"); your rank, and when it changes ("📈 You moved up to 3rd!"); how many are already in your key's area; the hunters chasing the same key within 2 km with an arrow and distance (further, only the Eye of the Djinn sees).
2. **The metal detector and the chest.** In the key's area (`key_pulse`, every few seconds) the screen's edges glow and pulse, faster and stronger as the key gets closer; a chip says Warm / Hot / Burning, warmer or colder; phones buzz. Within 60 m the key's chest rises from the ground; within 40 m "Open the chest" starts the Key Trial; a key won flies into the bag. "Search here" stays for checking a guess from afar.
3. **The road.** During a hunt, now and then (at most every 4 minutes) the server stops the hunter for a scene: a police checkpoint (a road-safety question; wrong or "just pay", a 20-coin fine and 15 s held), a stranded traveller (help, 15 s, and learn which way your key's area lies) or a street seller's riddle (25 coins).
4. **Different questions.** Each trial category now mixes in new kinds with its classic questions: count the fruit, memorise (shown for 3 s, then hidden: which wasn't there? which number came third?), unscramble a Nigerian word, odd one out. The memorising time doesn't count against the answer.
5. **Moments and rewards** (18 Oct). First to a key: +100 coins, and every hunter hears of it. A showdown: two hunters in the same key's trial within 90 s; the first to finish wins +50 (both see "Showdown!" in the trial). Golden minutes: 10 minutes in every hour of a hunt, from 30 minutes in: the detector reaches twice as far, and every key pays +50; announced, with a countdown on the card. Catch-up tips: a hunter behind the leader and 15 minutes on the same key gets one tip per key (which way the key's area lies, roughly how far). The recap: on finishing, the hunt in one card (place, each key's time and tries, medals, bonus coins), to share.

### 6.4 Hunt length

There are no scheduled gates. The prize sets how long a hunt lasts, through:

- the **number of keys** (K),
- the **distance between key locations**,
- the **trial difficulty** (more questions and harder categories).

A car must not be won in an hour. A grand hunt spreads its keys across cities and states so that it lasts days or weeks, like a TV game show stretched over a season.

---

## 7. Relics, intel and tools (the *Ready Player One* layer)

### 7.1 What they are

**Relics** are power items hidden at real places on the map. Players find them by roaming, following intel, or completing tasks. They **cannot be bought with real money**.

| Relic | Rarity | Effect |
|---|---|---|
| Rain Charm | Common | Rain over a 5 km radius for 10 minutes. Walkers and bikes are slowed by 20%. |
| Traffic Totem | Rare | Heavy traffic in one city for 15 minutes. Cars and buses are slowed by 40%. |
| Storm Orb | Legendary (one in the world) | A storm over a whole country for 20 minutes. Flights are delayed and road speed is reduced. Announced on the live stream. |
| Lockdown Orb | Legendary (one in the world) | Raises a dome over a key location (1 km radius) for 20 minutes. Nobody outside can enter, so the trial is closed to them. See 7.2. |
| Umbrella / Shield | Common | Immunity to one weather or traffic effect. |
| Radar | Rare | For 5 minutes, shows the direction to the nearest relic or the current Final Approach spot. |
| Ghost Cloak | Rare | Hidden from the leaderboard and broadcast for 30 minutes. |
| Fast Pass | Rare | Skip one check-in queue or bus wait. |
| Second Wind | Common | Restores 50 energy. |
| Jerry Can | Common | Restores 30% fuel. |

### 7.2 Rules that keep relics fair

- **Area effects only**, with no attacks aimed at one person. Effects hit everyone in the area, including the user's allies.
- **Effects are limited:** each player can be slowed by at most 2 effects per hour, and effects never apply within 500 m of a key location. The Lockdown Orb is the only exception.
- **Lockdown Orb rules:**
  - Players already inside the dome when it rises, including the Orb holder, can keep going.
  - Players outside are stopped at the edge.
  - **Siege:** players at the edge can attack the dome by tapping. If enough of them attack together, it breaks early. The number needed scales with how many players are hunting. This is a ready-made live-show moment.
  - Once used, the Orb is hidden again somewhere new.
  - It can't be used on the final key.
  - Only one dome can be up per hunt at a time.
- **Charges and decay:** relics have limited uses and expire after a set number of days, so hoarders can't dominate the next hunt.
- **Legendary relics are unique and cannot be traded.** When used, they move to a new hidden location, so the hunt for them starts again.
- **Shields counter every effect type.** Shields are common and are found everywhere.

### 7.3 Intel

**Intel scrolls** are found on the road and in the world. Each one points to a relic, a coin cache or a shortcut. **About 1 in 4 is a decoy** that leads somewhere empty and possibly far away. Better intel (from informant characters at landmarks, or from completed tasks) has a lower chance of being a decoy.

### 7.4 The Lamp [BUILT 15 Oct 2026]

Nothing hidden lies openly on the map any more. Intel scrolls, relic and coin finds, intel leads and the "nearest find" arrow are taken off the map. Hidden things now reach the player through one icon in the tools column on the right: **an old brass oil lamp**.

- **Dull:** nothing waiting.
- **Glowing gold:** a Detour is waiting (7.5).
- **Smoking purple, shaking:** the Djinn is calling (7.6).
- **One thing at a time** (owner's call, 15 Oct 2026): the Lockdown Orb if it lies within 25 km, otherwise the area's Detour that ends soonest, otherwise a whisper. It stays until it's done (claimed, tried, all claimed, over, faded, or let go with "Let it go"), then the next one comes. Everything has a countdown; whispers fade after 45 minutes. A dot on the icon shows something is waiting; no count.
- **Directions are only drawn when the player asks:** they tap the lamp, then "Show me the way". Until then the route stays hidden.
- What still shows on the map: other hunters, landmarks, stops and stations, taxis and renters, the player's own route.

### 7.5 Detours (the lamp glows gold) [BUILT 15 Oct 2026]

Small, frequent offers close by. Everyone in the same area gets the same Detour at the same moment, so they race each other.

| Kind | How it works | Example |
|---|---|---|
| Flash | Gone after a set time (15–45 minutes). | "A merchant's mule dropped a pouch at Balogun Market. It will be swept away in 20 minutes." |
| Rush | Only the first N to arrive get it; the lamp shows a live count ("143 / 200 claimed"). | "The first 200 hunters to touch the old lighthouse get a Fast Pass." |
| Flash Rush | Both: the first N within the time. Bigger reward. | "The first 50 within the hour get a Radar." |

- Places are real, 0.5–5 km away, on roads.
- On arrival there's a quick puzzle (about a minute) before the reward.
- Rewards: coins, common and rare relics.
- Intel leads (landmark check-ins, intel scrolls) also arrive through the lamp as personal Detours.

### 7.6 The Djinn's Wager (the lamp smokes purple) [BUILT 15–17 Oct 2026]

The big event. **Once a week at a surprise moment, lasting 3 days, never while a hunt is live.** Every player is summoned at the same moment, and the Djinn reveals which Wonder (7.7) is at stake. **There is one treasure and one winner.**

1. **The summons.** The lamp shakes and smokes. Opening it shows an old djinn rising from the smoke, e.g.:
   > *"Three hundred years I slept in this lamp… and you are the one who woke me? Small hands. But I know where the Sultan's Last Chest lies: gold that has not seen sun since the caravans stopped. Prove your mind is sharper than your boots, and I will show you the way."*
2. **The gate puzzle.** One movie-style puzzle, the same for everyone that week (a cipher wheel, torches lit in order, a star map to align, safe stones across a cursed floor, the scales of an idol…). Answers are checked by the server. **How well it's solved earns the Djinn's favour.**
3. **The eight seals.** The djinn unrolls a burnt map with 8 wax seals: 8 places anywhere in the world (Tikal in Guatemala, Petra, Kyoto…), the same 8 for everyone. **Only one is real; the other seven are decoys.**
   - Each seal shows a cryptic verse about its place, not its name.
   - The djinn gives one riddle that fits only the real place, but each part of it fits several seals, so it takes thought.
   - **Favour burns decoys away:** a perfect gate puzzle burns 2 decoys before the player chooses, a good one 1. At least 6 seals always remain.
   - The player breaks **one** seal. The place is revealed and the choice is final for the week.
4. **The way there.** The directions are saved in the lamp with a countdown to the end of the 3 days, and drawn only when the player taps the lamp. The journey planner (7.8) works out how to get there.
5. **The approach.** Within about 1 km of the place:
   - **Hidden traps** along the roads, unseen until stepped on: quicksand (stuck for a while), a snake pit (energy lost), a collapsing bridge (fall back a few hundred metres), a dart wall (time lost).
   - Other hunters heading for the same place show on the map, and there are notices when one is near ("A hunter is 2 km from the temple").
6. **The chamber.** Arriving isn't enough: a multi-stage puzzle with a timer, several rooms in a row (a cipher door, then torches, then the idol's weight…).
   - **Win at the real place, first:** the Wonder (7.7). Every lamp in the world shows who took it, and the Wager ends.
   - **Win at a decoy:** the vault is empty and the djinn laughs.
   - **Lose:** a whirlwind lifts the player off the map and drops them far away (tens of km in a random direction), with a dramatic animation. They can come back and face a new chamber as often as they like until the treasure is claimed or the 3 days end.
7. **Unclaimed after 3 days:** the treasure sinks back into the Djinn's vault, and next week he offers two Wonders at once.

### 7.7 The Djinn's Wonders [BUILT 17 Oct 2026]

The prize is never real money. It is a **Wonder**: a relic so strong that every player wishes they held it (the *Ready Player One* layer: one player's orb wipes out everyone, another's extra life brings them back).

| Wonder | What it does |
|---|---|
| The Cataclysm Orb | During a live hunt, wipes out every hunter: all keys gone, everyone (the holder too, the cloaked too) sent home. The screen of everyone it hits goes white. |
| The Djinn's Coin (the extra life) | Works by itself, once: a Cataclysm, Oblivion or Return passes the holder by (keys and place kept), or a failed Key Trial doesn't throw them, or the chamber's whirlwind dies at their feet. Revealed only when it saves someone. |
| The Orb of Oblivion | Every other hunter loses all their keys in the current hunt. Positions stay. |
| The Orb of Return | Every hunter, the holder too, is sent home (where they set it). Keys stay. |
| The Eye of the Djinn | For 10 minutes, see every hunter on the map and the area of the key each is chasing. |
| The Hourglass of Ages | Freezes every other hunter in place for 3 minutes. |
| The Master Key | Opens one key without its trial (the place must still be found and reached). |
| The Phantom Cloak | For the rest of the hunt: off other players' maps and the broadcast, unseen by the Eye, and untouched by every Wonder except the Cataclysm. |
| The Carpet of Kings | One instant flight to anywhere in the world (a place search), on foot, any time; set down on the nearest road. |
| The Thief's Hand | Takes the latest key from every hunter within 1 km and keeps one of them. |
| The Djinn's Bargain | Swap places on the map with the hunter in the lead. |
| The Sandstorm Crown | A sandstorm within 400 km of the holder for 30 minutes: everyone there moves at half speed, whatever they ride, except the holder. |
| The Mirror of Many | For the rest of the hunt, three copies of the holder, a few hundred metres off, appear on other players' maps; nobody knows which is real. (Not yet on the broadcast.) |
| The Seer's Seal | On the Djinn's map (after his gate, before choosing a seal), every decoy burns: the holder sees the real place. |

**Rules for Wonders** (owner's decisions, 15 Oct 2026):
- **Each Wonder exists once in the world.** It can't be traded.
- **Holders are secret.** Nobody knows who holds what until it's used (the Djinn's Coin shows itself when it saves someone).
- **Usable any time during a live hunt**, including the final stretch. Each is used once, then returns to the Djinn's vault as a future prize. Unused, it fades back to the vault after 30 days.
- Every use is announced to all players (a banner within 8 seconds, with what it did to them) and on the broadcast.
- A Wonder that can't work where the holder is (the Master Key away from the key, the Thief's Hand with nobody near, the Bargain with nobody to swap with) says so and stays in the bag.
- **Wonders override the limits in 2 and 7.2** (area effects only, at most 2 effects per hour, nothing within 500 m of a key). That is their point. The Cataclysm and the Orb of Return hit their holder too.
- The Lockdown Orb stays as it is (one in the world), but is now found through the lamp instead of lying on the map.

### 7.8 The journey planner [BUILT 15 Oct 2026]

Going far isn't just a line on the map: the game works out how to get there and shows the journey as steps, each with its time and fare. Only the current step is drawn on the map.

- **Within a city (under about 40 km):** walk, ride, taxi or city bus.
- **By road** (within Nigeria, or to a neighbour reachable by road such as Accra or Cotonou): a long-distance bus from a motor park, or the player's own vehicle. A road connection is checked first.
- **Across seas or continents:**
  1. getting to the departure airport (taxi, bus or walk),
  2. the flight (with a connection when the airport nearest the place is small),
  3. from the arrival airport to the place (taxi or bus there).
- Places used by the Djinn are chosen within taxi or bus reach of an airport.

**Build order:** (1) the Lamp, taking finds off the map, and Detours; (2) the journey planner; (3) the Djinn's summons, gate puzzle and seals; (4) traps, chambers, the whirlwind and the Djinn's relics.

---

## 8. Things to do along the route

### 8.1 Road events

| Event | Applies to | Player choice |
|---|---|---|
| Traffic jam | Car, bus | Wait, or take a side road (longer, but moving) |
| Red light (real traffic lights, from OpenStreetMap) | Car, motorbike, bicycle, bus, taxi | Wait for green (at most 9 s) |
| Police checkpoint | Motorbike, car | Show licence, registration and insurance (add-ons), or pay a fine and lose time |
| Flat tyre / breakdown | Bicycle, motorbike, car | Roadside mechanic (coins), or push the vehicle |
| Fuel queue | Motorbike, car | Wait, or pay a premium at the next station |
| Real weather (from a live weather service) | Walk, bicycle, motorbike | Raincoat item, or accept slowing down |
| Real local time: night | Bicycle, motorbike | Lights add-on needed, otherwise slower |
| Missed check-in | Plane | Rebooking fee, then the next flight |
| Full bus | Bus | Wait for the next one, or switch mode |
| Stranded traveller (a non-player character) | Any | Help them (lose a little time) to receive intel or coins |

### 8.2 Sponsored merchant stops

Real merchant branches appear as **optional detours** on the route:

> **Chicken Republic, 12 Allen Avenue, Ikeja** — 1.2 km detour
> Meal: 150 coins → +60 energy (a regular food stop gives +40)

- The merchant pays Loota per visit and per in-game purchase.
- [PROPOSAL] A visit can unlock a **real-world coupon** for that branch, which brings the merchant real customers.
- Merchants can also sponsor coin drops, relic locations and odd jobs (section 9).

### 8.3 Meeting other players

When two players are on the same road:

- **See and pass** each other in 3D, with nameplates.
- **Wave or emote**, which shows up on the broadcast.
- **Slipstream:** cycle close behind another player for +10% speed.
- **Roadside duel:** either player can challenge the other to a 3-question quiz. The winner gets a 2-minute time bonus. Players can decline, and duels are limited to 3 per hour.
- **Trade:** swap intel for coins (not legendary relics).

### 8.4 Pickups on the route

Coin drops and intel scrolls appear along roads. They are **only collected at walking or cycling speed**, which rewards active and slower travel.

---

## 9. Free roam and earning coins

When no hunt is running, the map stays open. Players keep their avatar and vehicles where they left them.

| Activity | Reward |
|---|---|
| **Courier jobs:** deliver a parcel from A to B (merchants can sponsor these) | Coins, more for faster delivery |
| **Taxi jobs** (vehicle owners): carry a non-player passenger | Coins; helps pay back the cost of the vehicle |
| **Landmark check-ins:** visit a famous place and answer a question about it | Coins and intel |
| **Relic hunting:** follow intel to relics | Relics |
| **Coin caches** | Coins |
| **Daily tasks and streaks** ("Walk 5 km", "Visit 2 merchant stops") | Coins |
| **Achievements** | Coins and cosmetics |

Odd jobs mean a player who never spends real money can still afford fares, fuel and a plane ticket by working in the game.

---

## 10. Economy

### 10.1 Currency

- **Coins** are the only in-game currency. They are bought with real money through Paystack, or earned in game (section 9). International card payments must be enabled on the Paystack account so Nigerians abroad can buy coins.
- All prices in the game are in coins. Local-currency prices appear only on the "buy coins" screen.
- **Buying coins (built 19 Oct 2026, Paystack test keys).** Tap your coins in the top bar: the shop. Packs (first prices to tune, in src/game/coinPacks.ts): 500 coins ₦500 · 1,200 ₦1,000 (+20%) · 3,200 ₦2,500 (+28%) · 7,000 ₦5,000 (+40%) · 15,000 ₦10,000 (+50%). Picking one has the game's server start the payment at Paystack (the price and coins come from the server's list; the purchase is recorded as pending in coin_purchases) and Paystack's payment window opens over the game (or its own page, which sends the player back to /play?paid=…). The coins are added once the server has asked Paystack itself that the payment succeeded, for the right amount, in naira (credit_coin_purchase: once only, through the wallet's apply_coin_change). Paystack's signed webhook (POST /api/paystack/webhook, HMAC-SHA512 with the secret key) adds them too if the phone loses its connection after paying: set its URL in the Paystack dashboard once the game is online. Before going live: the live keys in the hosting's settings, international cards enabled, and the webhook URL.

### 10.2 What coins are spent on

Rentals, fares, plane tickets, fuel, food, maintenance, towing, hospital bills, parking, add-ons, vehicle purchases, hints that narrow the "Cold" band, and cosmetics.

### 10.3 Vehicles

- **Bought once, kept across hunts.** They are expensive to start with.
- They need **maintenance** to keep working, and they can break down, needing towing and the garage.
- **Add-ons** matter at police checkpoints.
- **The pocket garage** (owner's decision, 17 Oct 2026, replacing "they stay where they were left"): an owned vehicle goes everywhere with its owner, like a gadget in *Ready Player One*. Off it, it shrinks into the player's pocket; it can be taken out anywhere in the world.

**Built (v1, 13 Oct 2026).** Prices are first guesses to tune once real players are spending:

| | Buy | Rent | Fuel |
|---|---|---|---|
| Bicycle | 600 coins | 4 coins a minute | None (uses your energy) |
| Motorbike | 2,500 coins | 10 coins a minute | 0.8% a km |
| Car | 8,000 coins | 20 coins a minute | 1.2% a km |

- **Meeting the renter is a scene** (owner, 17 Oct 2026): at the bus stop, Rent it opens the bike-hire stop drawn in 2D (the shelter, the BUS STOP sign, bicycles or okadas lined up) with the renter (Musa, Mama Ronke, Tunde…: the same person who waits on the map). They show you the ride, you ask "How much is it?", they name the rate and how the meter works, and it's "Deal!" (ride off) or "That's too much for me" (they go back).
- **Renting** is charged per started minute until you get off. The first minute is paid up front. A rental left running with no sign of the player for 3 minutes is ended and charged by the server.
- **Owned vehicles** are bought once and carried in the pocket: "Take it out" anywhere, "Get off" and it shrinks away. A petrol station fills a pocketed tank, a vulcanizer pumps pocketed tyres, a mechanic services one, a mechanic called out comes to the player wherever they are, and a keg pours in anywhere. Boarding a bus, train, plane or taxi, asking for a rental, or flying the Carpet pockets the vehicle being ridden (a rental must be returned first).
- **Fuel** costs 2 coins per 1%. The Refuel button appears only within 40 m of a real petrol station on the map. Rentals come fuelled. An owned motorbike or car that runs dry goes into the pocket until it's filled.
- **Repair shops and event scenes** (owner's decision, 17 Oct 2026): a broken-down vehicle (a bicycle damaged in a collapse, a motorbike or car that broke down) goes to a repair shop near the player: a bicycle repairer, or a mechanic's workshop, at a random spot 250 m–1.2 km away with its own keeper (Mama Bisi, Chinedu, Emeka…). After the hospital, the way there is drawn straight away. The shop stands on the map (the keeper, a sign, vehicles outside). Going in opens an **event scene**: the place drawn in 2D, the keeper and the player, and a short conversation ("Hello! How can I help you today?" → "Please repair my bicycle" → the price and the wait → "That's OK"), then the keeper works while a bar fills. Walk off and it's done anyway; come back to collect it. Bicycle 40 coins / 2 minutes, motorbike 120 / 3, car 200 / 4. Calling a mechanic out to you is quicker (45 seconds) but dearer: 60 for a bicycle, 150 for a motorbike or car. Event scenes (`EventScene`) are meant for other moments too.
- **More scenes** (18 Oct 2026): the petrol station, the place to eat and leaving hospital are scenes too. **Refuel** opens the pump attendant ("Fill am?"): the pump's meter counts the coins up as the tank fills, then a keg for the road is offered (25). **Eat** opens the cook at a buka: the day's three dishes on a menu board (jollof, amala and ewedu, pounded yam and egusi, beans and dodo…; the same price and energy, only the dish differs, and the menu changes daily), the plate comes steaming and empties bite by bite, +40 energy. **Leaving hospital** brings the nurse at the door (or a paramedic by the road when no hospital was near): what happened, the bill (asked), the damaged bicycle (the repair shop's way is drawn) and how to avoid fainting. Unnamed places on the map are just "a buka", "the hospital".
- **Scenes in the world** (owner, 18 Oct 2026: "not a modal scene… an open roof building where we can see inside, and the user interacts depending on the event"). Going into a place happens on the map itself: the building stands at the kerb of the road with no roof (walls on three sides, a knee-high front wall with the doorway, rafters, the sign on the back wall), the camera glides down and turns to look in from the street, the hunter walks in through the door; the keeper and the hunter (drawn bigger than on the street) talk in speech bubbles over their heads, and the replies sit in a strip at the bottom with "Walk out". What happens inside follows the event: at a repair shop the vehicle goes on the stand and the keeper bends over it with a spanner until it's ready, then it sparkles and goes out with you. In the world now (18 Oct): the repair shop (the keeper repairs the vehicle on the stand), the buka (you sit at the table, the cook brings the plate, it empties as you eat; the day's menu on the wall), the petrol station (an open forecourt: the attendant walks to your vehicle at the pump, the hose goes in, the meter counts up on the pump itself), the hospital ward (you wake on the bed, get up and talk to the nurse; by the road with the paramedic and the ambulance when no hospital was near) and the bike hire (the renter under an umbrella in a side street; on "Deal!" you get on and ride out). The road events too (18 Oct): the police checkpoint (barrier, cones, the patrol van's lights flashing), the stranded traveller (a shade tree, a lamp, their bag) and the seller's stall (umbrella, oranges, a cooler) appear at the kerb where you're stopped, your vehicle in the road beside you; "Ride on" (or "Walk on") leaves. Words in a box, not over the scene (owner: "the text speech covers most part of the scene"): what the keeper says is in a dialogue box in the bottom strip with the replies; over their head only a small 💬 (dotting while they speak), and your short reply over yours; the camera keeps the place above the strip however tall it gets, and the hunt card steps aside while you're in a scene.
- **Food:** a meal costs 30 coins and gives +40 energy. The Eat button appears within 40 m of a real restaurant, fast-food place or café. Resting is still free.
- **The server decides** what you're riding. A saved position in a mode you aren't using is rejected, and fuel is used up by the server from the distance it accepts.

### 10.4 Will a hunt make money? [PROPOSAL]

For each hunt:

```
Prize cost (P)       = unit price × number of winners (N)
Expected revenue (R) = expected players × share who pay × average coin spend per paying player (in money)
Target               : R ≥ P × (1 + margin)
```

Example: 100 iPhones = ₦100m. If 25% of players pay and a paying player spends ₦4,000 on average, the hunt needs 100,000 players to break even.

What Loota can adjust to meet the target:
- **Number of keys (K):** more keys mean more trips and more spending.
- **Distance between keys:** the hunt can cross cities or countries.
- **Hunt length and gates.**
- **Number of winners (N).**

The admin hunt creator should show this calculation live while a hunt is being set up, and a dashboard should show real revenue against prize cost while the hunt runs.

### 10.5 Hunt tiers [PROPOSAL]

| Tier | Prize example | Keys | Duration | Area |
|---|---|---|---|---|
| Daily | Airtime, vouchers, meals | 3 | 2–3 hours | One city |
| Weekly | Phones, gadgets | 5–7 | 2–3 days | One country |
| Grand | Cars, big cash prizes | 10–15 | 2–4 weeks | Across states (and later, countries) |

---

## 11. Broadcast and the live show

- The broadcast is a **spectator mode of the same map and 3D layer.** It shows every player's avatar, keys and live effects.
- **Views:** centre (whole field), follow a single player, leaderboard overlay, and auto-rotate between leaders, duels, faints, relic uses and key trials.
- **Host controls** [PROPOSAL]: trigger live events ("Storm over Lagos", "Airport closed for 10 minutes", "Double coin drops on Third Mainland Bridge"), reveal riddles on air, and follow a Lockdown Orb siege live.
- The broadcast gets player positions from the same live updates the players use (section 12.3). No separate game server.

---

## 12. Technical design

### 12.1 Stack

| Part | Technology |
|---|---|
| App | Next.js (App Router), TypeScript, PWA |
| Map | Mapbox GL JS v3 |
| 3D | three.js as a Mapbox custom layer; glTF/GLB models |
| Backend | Supabase: Postgres, Auth, Realtime, Edge Functions / API routes |
| Routing | Mapbox Directions (walking, cycling, driving); public transit data where available; great-circle paths for planes |
| Places | OpenStreetMap (bus stops, stations, fuel, hospitals) and the airports dataset |
| Payments | Paystack, with international cards enabled |
| Weather | A live weather API |
| Question generation | OpenAI, with admin review |

### 12.2 What the server decides

The phone shows the game, but the **server is the only judge** of:

- coins (every debit and credit; atomic and idempotent),
- keys, Key Trial questions and answers,
- relics and their effects,
- **arrival claims:** an arrival is accepted only if the elapsed time is at least `route distance ÷ (maximum mode speed × C)`, including fixed overheads. This stops anyone travelling faster than the mode allows without needing a game server,
- passenger trips (the server sets departure and arrival times),
- where a player lands when a failed Key Trial throws them out,
- Lockdown Orb domes and sieges.

### 12.3 Live positions

- During active travel, each phone publishes `{route id, distance along the route, speed, mode, state}` every 2–3 seconds on a Supabase Realtime broadcast channel. Between updates, the receiving screen smooths the movement.
- Passenger trips publish only once (departure and arrival times). Every screen calculates the position itself.
- **Nearby players:** channels are split by map area, so each phone only listens to its own area and the areas next to it.
- **Broadcast:** a hunt-wide channel at a lower update rate.

### 12.4 Launch region

- **Hunts take place in Nigeria first.** Key locations, merchants, bus routes and question content all focus on Nigeria.
- **Players can join from anywhere.** Nigerians abroad start at their real home location (for example London or Houston), and must fly in like anyone else. This means maps, routing, airports and the home location must work worldwide from day one, even though hunts are only in Nigeria.
- Bus and train data outside Nigeria can be simpler at launch. Abroad, players mainly need to reach an airport.

### 12.5 Location and home

- A player's **home** is set once, from the device's real location, when they sign up.
- Changing home is limited (for example, once every 30 days) so players can't fake their GPS to start closer to each hunt.

---

## 13. 3D assets needed

### 13.1 What three.js does and what the models provide

three.js is the **engine**. It loads the models, places them on the map, and plays and blends their animations (through its animation mixer: walk into run, run into pedal). The **models and the movement data inside them** (what a walk cycle looks like) have to be made in a 3D tool such as Blender, or taken from an animation library. three.js plays them back; it doesn't invent them.

| Made in code with three.js (no artist needed) | Needs a 3D model or animation file |
|---|---|
| Spinning and glowing keys, bobbing coin drops | Human avatar body, clothes and hair |
| Rain, storm clouds and traffic haze | Walk, run, pedal, sit, faint, celebrate and emote animations |
| The Lockdown Orb dome and the siege cracks | Vehicle models (wheels and propellers can then be spun in code) |
| Vehicles moving, turning and tilting along the route | Key and relic models (simple ones could be built in code) |
| Camera moves and the plane's flight path | |

### 13.2 Art direction: low-poly models built in code (decided)

Loota has no 3D artist, so **every 3D object is built in code** from three.js basic shapes (boxes, spheres, cylinders, cones), in a bright, chunky toy style similar to *Crossy Road* or *Roblox*. The prototype `mini-loota.html` already shows a walking avatar, a bicycle, a motorbike and a car built this way.

- **Animations are also written in code:** limbs swing with simple maths over time. The prototype already does walking, pedalling, riding and sitting in a car. Faint, celebrate, wave and run are added the same way.
- **Customisation becomes cheap:** skin tone, hair, outfit colours, hats and vehicle paint are just parameters. Outfit "items" are extra shapes attached to the body.
- **Tiny downloads:** no model files at all, which suits phones on mobile data in Nigeria.
- **Consistent look:** everything shares one style, so nothing looks borrowed from a different game.

Rules when moving the prototype into the real game:
- Use the current three.js version from npm (the prototype loads an old 2021 version from a CDN).
- **Share materials between avatars** (the prototype creates a new material for every body part). Merge static parts into one mesh, and draw distant players as simplified versions, so hundreds of avatars stay smooth.
- **Scale with zoom:** at real-world size, a 2 m avatar is a speck on the map, so avatars and vehicles are drawn larger than life and stay the same size on screen (about 32 px tall) at any zoom. This works because buildings are flat (see below), so nothing makes the avatar look like a giant.
- **Flat map, no 3D buildings:** buildings are drawn as flat outlines. 3D buildings were tried and dropped: enlarged avatars looked like giants among them, they cost performance on phones, and Lagos building height data is poor (most come out as identical grey blocks).
- **One camera, the chase view:** behind the avatar, starting at zoom 20.5 on phones and 19.5 on larger screens. A first-person view was tried and dropped.
- **Slim proportions:** the avatar has a narrower torso and thinner limbs than the first prototype, with a slightly large head for the toy look.
- **No free steering on the real map:** the prototype's WASD and car steering drive anywhere. In the game, movement stays on the calculated route (section 5.2). The prototype's turn-by-turn arrow and mini-map are worth keeping.

### 13.3 Asset list

| Asset | Notes |
|---|---|
| Avatar base (male/female body shapes) | Rigged; animations listed in section 4.2; customisable skin, hair and outfits |
| Bicycle, motorbike, car | Owned versions can be recoloured |
| Bus, train, plane | Generic, unbranded models |
| Ambulance, tow truck | For the faint and breakdown flows |
| Key (3 styles for the 3 tiers) | Glowing, animated |
| Relics (one per type) | Must be recognisable from a distance |
| Coin drop, intel scroll | Simple, shared material |
| Pins for merchants, stops, stations and airports | Low-poly icons |
| Rain, storm and traffic effects | Particles and shaded volumes |

All of the above are built in code (section 13.2). Free-licence (CC0) low-poly packs are a fallback for anything hard to model in code, such as a detailed plane, as long as they match the style.

---

## 14. Build plan

| Phase | Deliverable |
|---|---|
| 0. Foundation | New repository, Next.js PWA, Supabase project and schema, sign-in, home location, coin wallet with Paystack |
| 1. 3D on the map | three.js layer in Mapbox, avatar at the home location, follow camera, animation states, 2D fallback |
| 2. Active travel | Tap-to-route, hold to move, sprint, energy, walking and bicycle, time scale C, server checks on arrival |
| 3. More modes | Motorbike and car (fuel, wear, breakdown, garage, add-ons), bus, train and plane (stops, tickets, check-in, parking) |
| 4. Hunt core | Hunt creation (admin), sequential keys, riddles, Final Approach, Cold feedback, Key Trial, leaderboard, winners |
| 5. Players together | Live positions, nearby avatars, emotes, slipstream, duels |
| 6. Broadcast | Spectator view, centre and follow views, auto-rotate, host event controls |
| 7. Relics and free roam | Relics, intel and decoys, effects and shields, courier and taxi jobs, coin drops, daily tasks |
| 8. Merchants | Merchant records, sponsored stops, coupons, admin reporting |
| 9. Economy tools | Hunt profit calculator, live revenue dashboard, spending caps |
| 10. Launch hardening | Load testing, anti-cheat review, analytics, offline handling, content moderation |

Each phase ends with something playable that can be tested.

---

## 15. Decisions log

| Date | Decision |
|---|---|
| 12 Oct 2026 | No scheduled key gates. The trial starts on arrival, and the next riddle is revealed as soon as a key is earned. |
| 12 Oct 2026 | Every player gets the same trial category per key, with different questions. |
| 12 Oct 2026 | A miss or timeout in a trial throws the player to a random point 2 km away; they must travel back. |
| 12 Oct 2026 | Lockdown Orb added (inspired by the shield in *Ready Player One*). |
| 12 Oct 2026 | Duels kept. Avatar and vehicle customisation kept. |
| 12 Oct 2026 | Hunts in Nigeria first; players can join from anywhere, including Nigerians abroad. |
| 12 Oct 2026 | No 3D artist. All 3D models and animations are built in code in a low-poly toy style, starting from the `mini-loota.html` prototype. |
| 12 Oct 2026 | Key Trial: no second chances. One wrong answer or timeout throws the player to a random spot 2 km away. |
| 12 Oct 2026 | Slipstream kept. |
| 12 Oct 2026 | Lockdown Orb kept as described in 7.2 (20-minute dome, siege can break it early, not on the final key, one at a time, re-hidden after use). |
| 12 Oct 2026 | Login: email and password at launch; other methods (Google, phone) can be added later. |
| 12 Oct 2026 | Free roam stays on roads and footpaths (no walking through buildings or water). |
| 12 Oct 2026 | Flat map: no 3D buildings. Chase camera only (first person dropped). Starting zoom 20.5 on phones, 19.5 on larger screens. |
| 13 Oct 2026 | Owner found the flat map too empty ("like a desert"): buildings return as **low 3D blocks** (capped at ~14 m, warm varied colours) with larger street names. Avatars are near true size at play zoom now, so the earlier "giants among blocks" problem doesn't recur. |
| 13 Oct 2026 | **Free-roam finds built.** The world is split into ~550 m squares, stocked when a player comes near and restocked every 6 h: 12 coin drops (5–20 coins), 1 intel scroll, 1 hidden find (60% coin cache of 40–100 coins, 40% relic), all on real roads. Hidden finds show only within 40 m or when intel points to them; 1 in 4 intel scrolls is a decoy. Pickups are confirmed by the server (30 m reach, anti-teleport check). Relics last 7 days; using them comes with hunts. The Lockdown Orb is not spawned yet. |
| 13 Oct 2026 | **Desktop keyboard controls:** hold ↑ (or W or Space) to move and Shift to sprint. ← and → turn at the next junction, ↓ turns around. Phones get ◀ ↺ ▶ buttons. |
| 13 Oct 2026 | **No movement buttons on screen except SPRINT.** Tap or click the map and the hunter walks there along the roads by itself (tap behind to go back; a "Stop" chip cancels). On a keyboard, hold ↓ to turn round and go back. **Sprint is only for walking (running) and the bicycle (pedalling harder).** Motorbikes and cars have no sprint, and the server's speed limit for them dropped to match. |
| 14 Oct 2026 | **Lockdown Orb built** (7.2). One Orb lies in the world (a large purple relic, on a road 1–4 km from a live or upcoming hunt's key, else around Lagos); when used or expired (3 days) it hides somewhere new. Using it during a live hunt raises a 1 km dome for 20 minutes over the holder's current key area, centred up to 450 m off the key spot so the dome doesn't reveal it. Hunters inside when it rises (and the holder) move freely; outsiders are stopped at the edge (by the game and by the server's position check). Siege: hunters within 200 m outside the edge press Attack; it breaks when enough different hunters attack within 30 s of each other (needed = 1 per 10 hunters in the hunt, at least 2, at most 10). Not on the final key; one dome per hunt at a time. |
| 14 Oct 2026 | **Broadcast view built** (11) at /broadcast (owner only; "● Broadcast" button on each published hunt in /admin). It shows the hunt title, prize and time left; a leaderboard (click a name to follow); a ticker of events (joined, key found, key earned, trial failed, finished, dome raised, siege); and a big banner for the newest event. Every hunter is a dot with a name (gold = leader, purple = in a Key Trial, green = finished), and the followed hunter is a full 3D avatar with an orbiting camera. **Auto** follows whoever caused a new event for 20 s, otherwise rotates between the whole field and the top 3 every 18 s. H hides the overlays. Positions come live from each player's game (a `hunt:<id>` channel), with a database check every 4 s. |
| 14 Oct 2026 | **3D buildings and street life removed** (owner's call). Buildings are flat grey outlines at every zoom, in the game and on the broadcast; the scenery walkers, motorbikes and cars are gone. Only real hunters walk the streets. |
| 14 Oct 2026 | **Bus, train and plane built** (5.5). Walk to a stop, station or airport (the **Bus · Train · Plane** button shows the nearest of each, with directions), pay, wait, ride, and step off on foot. The server decides when you leave and arrive (`start_trip`, `finish_trip`) and refuses position saves during a trip; a trip can be cancelled for a refund until it leaves. **Buses:** any stop to the stop nearest a searched place, up to 40 km, along the roads a car takes; 35 s wait; fare 3 + 1 coin per km. OpenStreetMap has few stops (about 140 in all of Lagos), and danfos stop anywhere on main roads, so there's a roadside stop every ~700 m of trunk, primary and secondary road (75,000 stops). **Trains:** 8 real lines with their stations: Lagos–Ibadan, Lagos Red and Blue Lines, Abuja–Kaduna, Abuja Metro Yellow and Blue, Warri–Itakpe, Kaduna–Kano; 50 s wait; fare 5 + 1 coin per 2 km. **Planes:** 27 airports; check-in, boarding and taxi 7.5 min; fare 80 + 0.15 coin per km (Lagos–Abuja 157). Speeds 25, 70 and 750 km/h × the time scale. A **Fast Pass** skips the bus or train wait or the check-in queue. The camera pulls back on its own for trains and flights (players still can't zoom). Intercity buses between motor parks come later. Data: `npm run transit:build`, `transit:roadside`, `transit:upload`. |
| 14 Oct 2026 | **No loose coin drops** (owner's call). The world no longer scatters 12 coin piles per square; it holds an intel scroll and one hidden find (a coin cache or a relic) per square. Existing drops were expired. The Lockdown Orb now takes any find's spot instead of a coin drop's. |
| 14 Oct 2026 | **Buses stop on the way; directions carry on after** (owner's call). Boarding a bus, train or plane clears the old directions. A bus goes *towards* the searched place and drops the player at the bus stop nearest it; on getting off, walking directions to the place are mapped again (after a train or plane too, if the player's directions led beyond the station or airport). The bus stops at bus stops along its route: at each, a random 0–3 passengers get off and 0–3 waiting at the kerb get on (repeatable per trip); empty stops are passed. Stopping time comes out of the trip's fixed time (at most a third of it), so arrival never changes. |
| 14 Oct 2026 | **Further afield.** *Flights anywhere:* 3,248 airports with scheduled flights (OurAirports, public domain; Nigerian ones keep their OpenStreetMap terminals). At an airport, "Fly anywhere" searches a city, country or airport; domestic flights are listed. Abroad, an airport's position is the middle of the airfield, so "at the airport" means within 2 km and after landing the player is put on the nearest road up to 3 km away. Long flights take real time per 5.4 (Lagos–San Salvador ≈ 70 min). *Long-distance buses:* from a motor park to the motor park nearest any place in Nigeria (up to 1,500 km), express (no stops), along our own main-road network (motorway to secondary roads, 0.9 MB, built by `npm run highways:build` and `highways:upload`; no outside routing service), 60 km/h × the time scale, fare 20 + 0.4 coins per km; city buses stay within 40 km. *Lagos–Kano train* (the western line: Lagos, Ibadan, Osogbo, Ilorin, Minna, Kaduna, Zaria, Kano) along the mapped track, straight across gaps in the map. The panel also shows the nearest motor park and the nearest station of each train line around. |
| 14 Oct 2026 | **Travel has limits** (owner's call; 5.3 and 5.6). *Energy* is kept on the server: walking uses 0.35 a second at normal pace and cycling 0.5 (counted by the metre; sprinting 2.5×); standing gives back 0.25 a second, resting at a chill spot (a park or a place to eat) 2 a second, a meal +40. Warnings at 50 and 25 with directions to the nearest chill spot. At 0 the player **faints**: an ambulance comes by road and takes them to the nearest real hospital (within 15 km; otherwise paramedics treat them where they fell), 45 s of treatment, a 50-coin bill (or what they have), discharged with 70 energy; a rental ends and their own vehicle stays where they fell. *Bicycle tyres* lose air (flat after 40 km): soft tyres slow the bike, a flat means pushing at walking pace; pump at a vulcanizer or petrol station (5 coins, a flat 20). *Fuel:* warnings at 25% and 10%; an empty tank **stops** the motorbike or car where it is: buy a **keg** at a petrol station (25 coins, good for 50 pours, then spoilt), fill it (30% of a tank, 60 coins), carry it back and pour. *Engines* wear out over 400 km; below 15% they can break down: call a mechanic (80 coins, 45 s) or service at a mechanic's (60). Places (1,355 petrol stations, 4,711 hospitals and clinics, 2,005 places to eat, 1,319 parks, 506 vulcanizers, 154 mechanics) come from OpenStreetMap (`npm run places:build`, `places:upload`); the server checks the player is really there before selling anything. |
| 14 Oct 2026 | **Rentals and taxis come to the player** (owner's call). Renting a bicycle or motorbike: a renter waits with it at the nearest bus stop (okada and bike hire gather there; within 2 km); the player walks there and the meter starts when they ride off. Cars are not rented: they are **taxis**. The player picks a place (within 40 km), a driver drives in from 1–2.5 km away to the nearest road a car can reach, the player gets in and the driver takes them there; fare 8 + 2 coins per km, paid on getting in; a taxi ride runs like a bus ride (transit_trips, mode taxi). Pickups can be cancelled for nothing and lapse 15 minutes after arriving. Owned vehicles are unchanged. |
| 14 Oct 2026 | **Collapsing on a bicycle** (owner's call). The ambulance comes as for a walker. A **rented** bicycle is wrecked in the fall and stolen while the rider is in hospital: the rental ends and they pay its price (600 coins, or what they have) on top of the hospital bill. Their **own** bicycle is damaged and stays where they fell; after discharge a reminder gives directions back to it, and a mechanic or vulcanizer repairs it there (30 coins, about 45 s; 80 for a motorbike or car), tyres included. |
| 13 Oct 2026 | **Relics can be used** (from the Bag). Second Wind +50 energy; Jerry Can +30% fuel (own motorbike or car); Radar 5 minutes of arrows to the nearest relic within 3 km and, on a hunt's Final Approach, to the key spot (the server sends only direction and rounded distance); Rain Charm 10 minutes of rain over 5 km that slows walkers and bikes by 20%, with visible rain. Shields work automatically (the next effect that would slow you uses one). Fairness from 7.2 enforced on the server: max 2 slowing effects per player per hour, no effects within 500 m of a live key, outcomes decided once. Fast Pass waits for buses and planes. The slow-down is applied by the game, not yet checked by the server. |
| 13 Oct 2026 | **Buildings and streets come alive.** Walls show windows (some with shutters) in Lagos paint colours; roofs are coloured corrugated metal. The map tiles merge neighbouring buildings of the same height into one shape, so the variety lives in the images: each wall pattern is a strip of 8 different house fronts and each roof a patchwork of two roof colours, so a merged block reads as a row of houses. Scenery people, motorbikes and cars wander the real roads within ~110 m of the hunter (13 on desktop, 8 on phones; no name tags, nothing saved or sent). Still 60 frames per second on desktop and phone views. |
| 13 Oct 2026 | **Other hunters, live.** Hunters see each other moving on the map (avatar, vehicle, name tag; a "N nearby" chip). Supabase Realtime broadcast: the world is split into ~2.2 km areas; each hunter announces to their area about once a second while moving (every 8 s standing still) and listens to the 9 areas around them (up to 25 shown). Leaving says goodbye; silent hunters drop after 15 s. Positions shown are for display only; the server still checks every saved move. Free-tier Realtime limits (connections, messages per month) will need watching as players grow; private channels can lock this down later. |
| 13 Oct 2026 | **Forks.** Where a road splits into branches that all go roughly ahead (e.g. University Road at Akoka), ← takes the leftmost branch and → the rightmost, even when neither bends 20° (before, a fork had no "left"). Directions announce forks as "keep left / keep right", and name the road after each turn from our own road data. |
| 13 Oct 2026 | **Our own road data.** Roads now come from the raw OpenStreetMap extract for Nigeria (Geofabrik, 710 MB, updated daily), not the drawing tiles: 1.8 million roads cut into 27,757 squares of 0.05° (~5.5 km), 142 MB in all, hosted in the public "roads" storage bucket under a version folder (ROAD_DATA_VERSION). Junctions are exact (shared point ids), roads carry names and bridge/tunnel/one-way details. Rebuild monthly: download the extract, `npm run roads:build -- <pbf> <dir>`, `npm run roads:upload -- <dir>` (new version folder), then bump ROAD_DATA_VERSION. Areas without squares (outside Nigeria) fall back to the tiles. Junction sweep on five Lagos areas: 3,534 of 3,536 turns work, every real junction within 1 m. One-way streets are enforced for motorbikes and cars (no entering against the flow, no turning round on them, routes obey them; walkers and cyclists are free). Directions up to ~25 km (any trip within Lagos) are routed on our own roads in the browser: the squares between start and destination are loaded and searched (a 9 km trip: 3 squares, 320 KB, under a second; 22 km: 20 squares, 1.3 MB, about 0.7 s). Longer trips use the public routing service, then a straight line. |
| 13 Oct 2026 | **Directions, not autopilot.** The player always steers; only buses, trains and planes will carry a player by themselves. Searching a place or tapping the map plots a blue route with turn-by-turn directions ("In 40 m, turn left onto Ricca Street"); leaving the route re-plans it. "Free roam" and "Go to a place" are no longer separate modes. **Phone controls are swipes:** press and hold the lower part of the screen to walk, swipe left or right to turn, swipe down to turn back; the upper part looks around. Keyboard: arrow keys. Mouse-wheel and pinch zoom fixed (the chase camera was cancelling them). |
| 13 Oct 2026 | **Look around and search places.** Dragging the map no longer slides it away: sideways turns the view around the hunter, up or down tilts it, and moving off swings the camera back behind them (pinch still zooms). "Go to a place" has a search box for places and addresses (OpenStreetMap search via Photon, Nominatim as backup, through our own /api/geocode); picking a result plots the route and the hunter travels it, with distance and rough time. Nearby places on loaded roads are routed instantly by the game; farther ones use the routing service (12 s limit). |
| 13 Oct 2026 | **Junctions rebuilt where map tiles lost them.** Map tiles simplify roads and sometimes drop the point two roads share, so the roads cross without meeting and there is no turn. The game now puts a junction wherever two roads at the same level cross (bridges and tunnels excluded) and merges junction points drawn a metre apart. Swept five Lagos areas: 3,608 of 3,611 possible turns work (about 1 in 4 turns were missing before). Google Maps was considered and rejected: it gives apps no road-junction data (its Roads API only snaps GPS points, is paid, and its terms restrict reuse). Long term, build the roads from our own copy of raw OpenStreetMap data for Nigeria (exact junctions, names, one-way streets), refreshed monthly. |
| 13 Oct 2026 | **Street label:** a small label at the bottom shows the street the hunter is on, from OpenStreetMap names ("Unnamed road" where the street has no name yet). Junction turns also work when standing on the junction. |
| 13 Oct 2026 | **Turning fixed:** ← or → takes any road leaving on that side (not only near-square turns), and a turn pressed up to 30 m after passing a junction goes back and takes it. Movement instructions are no longer shown on screen (a small ? button explains the controls); game messages fade after a few seconds. Starting zoom is now 20.5 on desktop too. |
| 13 Oct 2026 | **Hunts v1 built** using the section 6.2 proposal. A riddle points to an area. The player presses **Search here**: far away gives "Cold" with a distance band; inside the area gives the Final Approach clue and hot/cold bands; within 40 m of the spot starts the Key Trial. Trial categories: mental maths and number sequences (made fresh every time), general knowledge and "Know Nigeria" (question bank). Later keys get harder questions. A wrong answer or timeout throws the player 2 km away (a trial left running counts as a timeout). The first N players to collect every key win. The owner creates and publishes hunts at /admin by pasting Google Maps coordinates; key spots snap to the nearest road. A 3-key practice hunt (airport → National Theatre → Tafawa Balewa Square) is live for testing. |
| 13 Oct 2026 | **Economy v1 built:** rent or buy a bicycle, motorbike or car; fuel; meals at real restaurants; owned vehicles stay parked (see 10.3). Wear, breakdowns, parking fees, add-ons and public transport come later in phase 3. |

## 16. Open questions

1. **Section 6.2:** is the area riddle → Final Approach → Key Trial flow right?
2. **Section 10.5:** do the hunt tiers match how you want to schedule prizes?
| 14 Oct 2026 | **Landmark check-ins built (section 9):** 38 famous places across Nigeria (`scripts/data/landmarks.json`, uploaded with `npm run landmarks:upload`) show as gold monuments within 6 km. Standing inside a landmark's area brings up a **Check in** button: one multiple-choice question about the place with 20 seconds to answer. A right answer pays 40, 80 or 150 coins (city sight, major landmark, iconic), a third of that on later visits, and may give an intel lead to a hidden find nearby. Wrong or late answers pay nothing and show the answer with a short fact. One try per landmark per day. Questions and answers stay on the server; the player's position is checked there too. A **Landmarks** button lists nearby places with distance, reward and directions. |
| 14 Oct 2026 | **Game screen tidied for phones:** the top bar is back, energy, coins, bag (with a relic count and a dot for leads) and help. The tools are a column of icon buttons on the right: Directions, your travel mode (walk, bicycle, motorbike, car), bus/train/plane/taxi (gold at a stop) and Landmarks (gold when you can check in). Status (fuel, tyres, keg, nearest find, radar, dome, rain, hunters, the next turn) shows as small chips under the top bar. Warnings show one short line (tap for the full advice). Things to do where you stand (check in, eat, rest, refuel, kegs, tyres, repairs) are short gold buttons above the street name. Help explains each icon. |
| 15 Oct 2026 | **Rest where you are:** chill spots are only suggested when close enough to reach (under 40% of what the player's energy would carry them, and at most 800 m on foot or 2 km by bicycle). Otherwise the warning says to rest where you are, and a **Rest here** button (shown whenever energy is under 60 and no chill spot is at hand) sits the player down by the road: energy comes back at 1 a second, half the chill-spot rate (2) and four times standing still (0.25). Moving on ends the rest. |
| 15 Oct 2026 | **Night and day** follow the real sun where the player is. At night the ground darkens and the roads stay lit; the 3D figures darken. A clock chip shows local time (moon at night). After dark taxis charge 30% more and city buses wait three times as long. |
| 15 Oct 2026 | **Traffic:** weekdays are busy 6:30–10 am and 4–8:30 pm (most at the evening rush), a little at midday, quiet at night; Saturdays moderately, Sundays little. Jams form on main roads in built-up areas (how built-up: roads per map square). Each stretch of road jams or clears every 15 minutes, the same for every player. Red = standstill, orange = slow. In a car you crawl (15% / 45% of speed); on a motorbike you weave through (50% / 80%); walkers and cyclists aren't held up. Taxis and city buses take up to 1.8× as long at rush hour. Rules in src/game/clock.ts and the database (rest_traffic_night), kept in step by a test. |
| 15 Oct 2026 | **The Lamp and Detours built (7.4, 7.5).** Finds no longer lie openly: they show only within 40 m, or within 150 m once a whisper points to them; intel scrolls are no longer placed; the "nearest find" arrow and lead beams are gone. The lamp (tools column) holds the area's Detours (two at a time per 11 km square, a new one at most every 8 minutes, at real named places 0.5–4 km away), whispers (one every 30 minutes when none is open; 1 in 4 is a lie) and the Lockdown Orb when it surfaces. It glows while it holds something new; routes are drawn only on "Show me the way". At a Detour's place a gold Claim button asks one question (30 seconds); rushes count claims live and the last place goes to the first right answer. |
| 15 Oct 2026 | **The Djinn's Wager decided (7.6, 7.7):** once a week at a surprise moment, 3 days, never during a hunt; 8 seals, one real place; one treasure and one winner; unlimited chamber retries until it's claimed or closed; the prize is a Wonder (14 listed), each one in the world, held in secret, usable any time in a live hunt, overriding the usual relic limits. |
| 15 Oct 2026 | **Journey planner built (7.8).** Directions to a place more than 35 km away open "To X: pick how to get there" with the ways that exist, fastest first, each as steps with time and coins: **Fly** (beyond 150 km or abroad: get to the nearest airport, fly to the airport nearest the place, then a taxi or walk), **Long-distance bus** (both ends in Nigeria: nearest motor park to the park nearest the place), **Train** (stations on the same line within 40 km of both ends), **Drive** (your own motorbike or car within Nigeria, with a fuel warning). "Just show me the road" skips it. A journey card shows the current step; only that step's route is drawn; at the stop a Board button prices and books the ride, and on landing the route to the place is drawn. Journeys survive a reload. Taxis now also work abroad (the routing service finds the driver's way). Taxis still go up to 40 km, so the Djinn's places must be within that of an airport. |
| 15 Oct 2026 | **The lamp holds one thing at a time** (owner: "one after another, either fulfilled or not"). It had shown 17: two Detours plus 15 old intel leads that never expired. Now: the Orb within 25 km, else the soonest-ending Detour, else a whisper; kept until done or let go; whispers fade after 45 minutes; the icon shows a dot instead of a number. |
| 17 Oct 2026 | **The Djinn's Wager, steps 1–4 built (7.6).** 32 world wonders, each within 35 km of an airport and moved onto a path, with a verse and three traits (where in the world, what surrounds it, what it is; `scripts/data/djinn-sites.json`, `npm run djinn:upload`). A Wager picks a real place and seven decoys that share at most two of its traits; the riddle names all three. The gate: a cipher wheel, a cursed floor (stones obeying a rule) and an idol's scales, 4 minutes; 3 rooms = favour 2 (two decoys burn), 2 = favour 1, 1 = none, 0 or running out of time = turned away for 2 hours. One seal per player per Wager; the way is drawn only on "Show me the way", through the journey planner. The lamp smokes purple while the Djinn waits. The weekly surprise start is switched off (`djinn_auto`) until the chambers exist; the owner summons him from /admin. Test scripts now live in `scripts/tests/` (puppeteer-core is a dev dependency). |
| 17 Oct 2026 | **The Djinn's approach and chamber built (7.6 steps 5–7).** Traps: two hidden rings (600 m, 300 m) around each place, three of eight directions trapped on each, the same for everyone that Wager; crossing one springs quicksand (stuck 25 s), a dart wall (stuck 15 s, −10 energy), a snake pit (−25 energy) or a collapsing bridge (thrown back 300 m), with a red flash. Rivals who broke the same seal are counted, and the player is warned as one comes within 5 km, 2 km and 500 m. The chamber (within 60 m): a longer cipher, a 7-row floor with false stones, seven stones for the scales, 3 minutes, all three to be right. Real place, first: the Wonder (and every lamp hears who took it). Decoy: an empty vault. Failing: a whirlwind drops the player at an airport 10–300 km away (as if flown there); the traps reset and they may try again until the Wager closes. An unclaimed Wager makes the next one offer two Wonders, never one already held. Wonders show in the holder's bag only; their powers come next. |
| 17 Oct 2026 | **Fixes from the owner's play:** (1) a player is never put on a cut-off pocket of road (a small group of roads joined to nothing, wholly inside the loaded area, such as an airport's airside paths): the nearest proper road within ~240 m is used instead. The owner had landed at Lagos airport onto one and could only walk in circles. (2) The hunt panel has a ✕: the hunt goes on but the panel hides (a cookie), and the lobby's "Continue the hunt" brings it back. |
| 17 Oct 2026 | **Finds belong to hunts** (owner's call): Detours, whispers, hidden finds, relics and the Lockdown Orb only happen while the player is in a live hunt (`in_live_hunt`); nothing is stocked, shown or claimable otherwise. Between hunts the lamp is the Djinn's alone and says so. **Routes round fences:** when no road route turns up within ~1 km of the straight line (a fenced airport, a lagoon), the search widens to ~3 km before giving up, and a route never starts from a cut-off pocket. From outside Lagos airport's terminal, a petrol station 1.6 km away is now routed by road (12 km round the airport) instead of drawn as a straight line. |
| 17 Oct 2026 | **The Wonders' powers built (7.7).** Each Wonder has its button in the bag (tap twice: it's used once); the Coin works by itself. Every use reaches every player as a banner, with what it did to them; the Cataclysm flashes white. The Hourglass freezes (the server refuses moves; frost on the screen and a countdown), the Sandstorm halves speed (sand on the screen), the Eye shows a card of the hunters with direction, distance and keys, and their key areas on the map, the Cloak stops the player's position being sent and hides them from the broadcast, the Mirror sends three copies. The Carpet asks where to (any place in the world). A Coin save on a failed Key Trial says so. Also fixed: the step from a landing spot onto a road no longer costs energy (a 1.7 km step had cost 87), and the chamber's answer could fail with a database error on some connections. |
| 17 Oct 2026 | **The pocket garage (10.3, owner's call):** bought vehicles are always available, anywhere in the world: off one, it shrinks into the pocket (a short animation) and "Take it out" grows it back under the hunter. No more parked vehicles, green tags or walking to them. Fuel, tyres, servicing, kegs and the mechanic all work on a pocketed vehicle (the station fills the one that needs it most; the mechanic comes to you). Buses, trains, planes, taxis, rentals and the Carpet pocket the vehicle you're on instead of saying "get off first"; only a rental must be returned first. The Practice Hunt was taken off (unpublished) for free-roam testing. |
| 17 Oct 2026 | **Repair shops and the first event scene (10.3).** A broken-down vehicle is taken to a repair shop nearby with its own keeper; after a hospital stay the way there is drawn at once. Going in plays a short scene: the shop drawn in 2D (zinc roof, painted sign, bicycles or a car and oil drums, the player's own vehicle in front), the keeper (Mamas, Iyas and Aunties in a head-wrap) and the player, and a typed conversation with replies to pick; agreeing pays and the keeper works while a bar fills; the mended vehicle sparkles. The call-out mechanic now costs more than walking in (60 / 150). |
| 17 Oct 2026 | **Renting as a scene (10.3).** At the renter, Rent it opens the bike-hire stop with the renter, a short conversation about the price, and Deal! or no thanks (the renter goes back). Each renter has a name and the same look on the map and in the scene. |
| 17 Oct 2026 | **Go-slows you can feel** (owner: "the motorbike still moves normal"). A jam now runs along one named road for its ~1.1 km square (it was ~25 map points of one way, a few hundred metres, each jammed or not on its own): a typical go-slow is now 1.2–1.3 km (up to 3 km), so a motorbike at a standstill takes ~21 s through it instead of ~10 s, a car ~55 s. The jam chip shows your speed against your vehicle's top speed ("Go-slow · 17 of 35 km/h"). Speeds in jams unchanged: motorbikes 80% / 50%, cars 45% / 15%. Check: `scripts/tests/jam-check.mts`. |
| 17 Oct 2026 | **The bus rush (5.5).** City buses at night and at rush hour: a crowd at the stop, the RUSH strip with five quick questions as the bus pulls in, the crowd squeezing on as you answer; your chance of a place grows with each right answer; miss and wait for the next bus. Tables bus_rushes, transit_trips.rush / ride_s / rush_tries; RPCs bus_rush_start, bus_rush_answer; finish_trip waits for the rush. |
| 17–18 Oct 2026 | **The hunt, felt (6.3a).** The start show (countdown, GO!, the riddle revealed for all), the live race (news with distances, rank changes, rivals chasing the same key, who's in your key's area), the metal detector and the rising chest, road events as scenes (checkpoint, traveller, seller), and new kinds of trial question (count, memorise, unscramble, odd one out). A new practice hunt, "Practice Hunt: Lagos Run", live to 27 Oct. |
| 18 Oct 2026 | **The hunt, part 5 (6.3a):** first-finder bonuses (+100), showdowns (+50), golden minutes (detector ×2, +50 a key), catch-up tips for the trailing, and the shareable recap card. |
| 18 Oct 2026 | **More scenes (10.3):** the pump attendant (the meter running, a keg for the road), the cook at a buka (the day's menu, the plate cleared) and the nurse on leaving hospital (the bill, the damaged bicycle, advice). |
| 18 Oct 2026 | **Buses and taxis in traffic; traffic lights** (owner: "the bus does not respect the traffic"; "fetch where we have traffic signals"). A bus or taxi's ride (whose length the server fixes) is now shared out along the road: it crawls through the jams the map shows (as a car: 0.45 / 0.15 of its speed), waits at stops and red lights, and makes up time on clear road; the trip banner says "Go-slow", "Slow traffic" or "🚦 Red light". It never runs a red: on a road with more lights than the time allows (Victoria Island), it arrives a little after the server's time. Traffic lights: the 313 in OpenStreetMap for Nigeria (140 junctions; Lagos ~150 lights, Abuja ~106), `npm run signals:fetch` into public/data/traffic-signals.json. A junction's lights change together, every 20 s of game time (green 9, amber 2, red 9; travel runs 12× real life), the same for every player. Shown as 3D lights at the kerb (the cap glows the lit colour). Cars, motorbikes and bicycles stop 6 m before a red or amber light ("Red light · 7 s"); walkers cross. Checks: scripts/tests/ride-schedule-check.mts, traffic-lights-browser-test.mts. |
| 18 Oct 2026 | **Scenes in the world (10.3):** the repair shop is now an open-roof building on the map at the kerb: the camera looks in, you walk in, the keeper talks in bubbles over their head, the replies in a strip at the bottom, and the keeper repairs the vehicle on the stand in front of you. |
| 18 Oct 2026 | **Fast only where the road is free** (owner: "the car slows down and then suddenly starts moving fast even when the traffic is still on the map"). The car was held by the jam of the one road piece it was on; on an unnamed slip road inside Western Avenue's red go-slow that piece wasn't jammed, so it shot off. Now a car or motorbike is held by the worst jam drawn within 12 m of it (what it covers on screen), checked 5 times a second instead of once (a free car covers 150 m a second). Check: scripts/tests/goslow-probe-browser-test.mts compares the jam drawn around the car with the one holding it, several times a second. |
| 18 Oct 2026 | **Bike renters wait in side streets** (owner: "it has to be inside a street, not a highway"). A bicycle or okada renter used to come to the nearest bus stop, and many stand on expressways and main roads. Now they wait on the nearest ordinary street (residential, unclassified or tertiary, at ground level) at least 35 m from any main road, within 600 m (a named street wins if it's no more than 80 m further); only where there's none, the bus stop as before. Check: scripts/tests/street-spot-check.mts (the owner's spot on the Apapa-Oworonshoki Expressway → Obazur Street, 79 m away, 61 m off the expressway). |
| 18 Oct 2026 | **All the place scenes in the world** (owner: "I thought the scenes for food are on the map, not some popup"). The buka, the petrol station, the hospital ward (or the roadside with the paramedic) and the bike hire are now open places on the map like the repair shop, on one engine (openPlace/placeStep in GameMap; models3d makeOpenBuka, makeOpenPetrol, makeOpenWard, makeHireStand, makeRoadsideCare); the scenes tell the map what happens (SceneMoment: served, plate, pumping, meter, filled, rented). While inside, the directions, journey, pickup and advice banners step aside. |
| 18 Oct 2026 | **Road events in the world; words out of the way.** The checkpoint, the stranded traveller and the seller's stall happen at the kerb where you're stopped. Speech moved from big bubbles over the scene into a dialogue box in the reply strip; only a 💬 over the speaker and your short reply over you. The hunt card hides (kept, not closed) during a scene. |
| 18 Oct 2026 | **Tickets at the ticket office, check-in at the airport** (owner: "for trains, the user must go and purchase the ticket; at the airport, the user must go and check in"). Trains and planes are no longer paid for from the travel panel or the journey planner: they send you to the station's ticket office or the airport's check-in desk (at the road nearest the station, within its 150 m, or nearest the airport, within its 2 km; never on a cut-off airfield road), with the way drawn; at the door a gold "🎫 Ticket office" / "🛫 Check in" button opens the hall on the map. The ticket hall: the counter behind glass, the clerk, the departures board (where the line goes), benches, the turnstile, a train waiting beyond the back wall; where to (or the trip chosen in the panel) → the fare and the next train → pay → the ticket on the counter → to the platform. The terminal: three airline desks, the scale and the belt, the departures board, queue posts, a plane at the gate; where to → the fare → check in (pays) → your ID → your bag on the scale (it rides off on the belt) → boarding pass and gate. Test: scripts/tests/ticket-office-browser-test.mjs (Yaba station → Agbado; Lagos airport → Gateway). |
| 18 Oct 2026 | **Landmark check-ins and the Lamp's Detours on the map.** "Check in" at a landmark opens its plaza where you stand (paving, the stone plinth with the gold star, the board with its name, palms, a bench) with a guide in a yellow vest and cap (Guide Kemi, Tunde…); "Claim" at a Detour opens the Lamp's spot (a rug, a brass lamp glowing on a stool, purple smoke) with Zuri, the Lamp's messenger. Both: the host greets you and the clock starts only when you say "I'm ready!" (the greeting no longer eats the answering time); the question with its options and a countdown bar in the strip; the right answer brings the fact and the coins (the guide cheers; the Detour's prize rises glowing out of the lamp). The panels stay for the lists (the Landmarks and Lamp tools). Test: scripts/tests/quiz-scenes-browser-test.mjs. |
| 18 Oct 2026 | **The key's trial on the map.** Opening the chest no longer covers the screen: where it rose, a ring of standing stones on trodden earth, two torches burning, the chest open with the key's gold light rising, and the Keeper of the Key (in blue robes) by it; the camera dives in. The questions (every kind: sums, memorise, count, unscramble, emoji, the showdown banner) sit in a strip at the bottom in the Keeper's voice; the Keeper raises their arms at each right answer and cheers when the key is won (the key's card waits 1.7 s for it); a wrong answer or the clock running out throws you 2 km as before. HuntPanel tells the map with window events (loota:trial on/off with the outcome, loota:trial-step). |
| 19 Oct 2026 | **The Djinn's chamber on the map.** "Enter the chamber" opens the vault where you stand: sandstone walls open to the sky, three bays (the cipher on a glowing tablet with the wheel before it; the cursed floor of numbered stones; the idol's scales), the golden vault door at the back, and the Djinn hovering before it, purple and bigger than life. The rooms are in a sheet at the bottom with the Djinn's words; you walk to the room you're working on, the wheel turns as you turn it, the stones you step on glow, your stones land on the pan and the scales tip. Mastered: the door swings open on the Wonder's light. Failed: you spin up off the floor and the whirlwind carries you off (as before). Also verified 19 Oct, after the owner's Wager ended: the win path on the real database (djinn-chamber-api-test: the real place mastered, the Wonder won, the Wager won for everyone, the holder secret). |
| 19 Oct 2026 | **The weekly Djinn is on; the server insists on the ticket desk** (owner's calls). djinn_auto() is true: once a week, at a moment drawn from it (Monday–Thursday, 9:00–20:59 Lagos), the first player to look at the Djinn opens the Wager for everyone, unless a hunt is live (this week: the Practice Hunt runs to 27 Oct, so the first is Thursday 29 Oct, 11:00 Lagos). A Wager that ended within an hour of starting (a test's) doesn't count as the week's. Ticket desks: every Nigerian station's ticket office and airport's check-in desk (102 of 106 stops; the four without our road data are over the border) is worked out once from our road data (scripts/compute-desks.mts: the road nearest the stop that a hunter can reach, within 250 m of a station, 1.9 km of an airport) and stored with the stop; start_trip refuses a train ticket or a flight unless the player's saved position is within 60 m of it (reason "desk"), and you count as at the station when at its desk (Iwo and Auchan, beyond reach of any road before, now work). The game draws the hall at that same desk. Test: scripts/tests/ticket-desk-api-test.mjs. |
| 19 Oct 2026 | **Buying coins with Paystack** (owner's test keys) and the code pushed to github.com/femi17/Loota_new. The coin shop (tap your coins), five packs with naira prices, Paystack's payment window, the server checking every payment with Paystack before adding coins (once only, the right amount), and the signed webhook. Tests: scripts/tests/coins-api-test.mjs (forged and wrong-amount webhooks refused, a real test-card payment credited) and coins-paystack-browser-test.mjs (Paystack's checkout page is behind a Cloudflare bot check, so the card itself is paid through Paystack's API in tests; try the checkout by hand). |
| 19 Oct 2026 | **Every key's place is a scene** (owner: "make every key location a scene"). Where a key is won looks like where it is, with the person there asking the Key Trial (in the strip, in their name): a market (stalls under umbrellas, produce, baskets; Iya Oloja), a monument plaza (Guide Bayo), a beach (the sea, a canoe, palms; Ebi the fisherman), a park (trees, a fountain, flower beds; Uche the park keeper), a motor park (a danfo, the shelter, tyres; Sule the conductor), a school (the classroom block, the flag, the gate; Musa the gateman), a football pitch (goal and net, lines, the stands; Coach Gbenga), a palace (the wall and gate, the royal umbrella, talking drums, torches; Dogari the palace guard), or the stone circle with the Keeper of the Key anywhere else; the open chest with the key's light in the middle of each. hunt_keys.scene (default the circle); key_pulse sends it with the chest's spot. In /admin each key gets "The key's place": Automatic guesses from what's within 150 m of the spot (our landmarks, motor parks and parks first, then OpenStreetMap's markets, schools, stadiums and pitches, beaches and palaces; the stone circle if nothing or no answer), and it can be changed from the key's row at any time. Tests: key-scenes-browser-test.mjs, admin-key-scene-browser-test.mjs. |
| 19 Oct 2026 | **The vulcanizer, gear and papers, road events in free roam** (owner: "pump should have a scene and take some seconds"; "free roam is part of the game"; "I didn't buy a flashlight… no licence, registration or helmet"). **Pump:** at a vulcanizer or a petrol station's air, the Pump button opens the place on the map: a roadside stand with the sign, a red compressor, a stack of tyres, a water basin, your bicycle on the stand and the vulcanizer (Baba Sule, Emeka, Kunle, Alhaji Musa or Chinedu). "Go ahead" starts the job: he bends to the tyre, the compressor shakes, the bar fills for about 8 seconds (soft tyres, 5 coins) or 20 (a flat patched in the water basin, 20 coins), and only then is it charged and the tyre at 100. **Gear and papers** (prices: light 40; helmet 80, rider's licence 150, registration 200 for a motorbike; driver's licence 300, registration 400, insurance 250 for a car; the licences are yours, the rest belong to the vehicle; rentals come with all of it): offered, ticked, with the vehicle in the panel (Buy · 640 for a bicycle with its light), and bought later from the panel ("+ Helmet · 80" until ✓). A bicycle with no light after dark crawls (60% speed) and is told so. **Police checkpoints fine what's missing** (20 coins each, the only choice "Pay the fine"; a bicycle with no light at night can be stopped too); with everything in order it's the usual road-safety question. **Free roam has road events now** (checkpoints, stranded travellers, street sellers' riddles; not tied to any hunt): a traveller helped in free roam pays 15 coins (in a hunt they point to the key's area instead). Lamp finds, Detours and relics stay hunt-only for now (the owner's 17 Oct rule), to be asked. Tests: scripts/tests/papers-api-test.mjs, pump-scene-browser-test.mjs, gear-browser-test.mjs, free-roam-events-browser-test.mjs. |
| 19 Oct 2026 | **Stuck on a long straight road (fixed)** (owner: "the avatar cannot go forward anymore", on the F200 north of the Lagos–Abeokuta road). The roads around the player kept only segments with an END within 1.5 km; out in the country one straight stretch of the F200 is a single 3.9 km segment, so in its middle both ends were too far and the road under you vanished: no road, no moving. Now a segment is kept if any part of it passes within 1.5 km (both road builders). Probe: scripts/tests/forward-probe.mjs <lng> <lat> [mode] (holds ↑ and prints how far you got); scripts/tests/pocket-check.mts takes the mode as a third argument. |
| 19 Oct 2026 | **Traffic shows through the route; an Inventory with gear and papers** (owner: "the blue line is not making me see the traffic"; "where can I get helmet, licence and papers… a right icon for inventory"). The jam lines are now drawn over the blue route and a little narrower, so a go-slow on your way is a red (or orange) stripe inside the blue line. The bag is now the **Inventory** (a backpack icon, top bar): first "Gear and papers", each vehicle you own with ✓ for what it has and "+ Rider's licence · 150"-style buttons for what's missing (bought right there), then Wonders and relics. Gear and papers are still offered when you buy a vehicle, and in the vehicle panel. Test: scripts/tests/route-traffic-inventory-browser-test.mts. |
| 19 Oct 2026 | **Thrown back while riding fast (fixed)** (owner: "this doesn't move again on the map"). At a motorbike's top speed on a long road the server refused saves as "too fast" and the game threw the rider back up to a km ("Your position was corrected…"), again and again: each save was measured against the server time since the previous save arrived, and when one arrived late (a 2–7 s slow reply, common on phone connections) the next carried more riding than that time allowed. save_position now keeps a distance allowance (player_positions.allow_m) that builds up at 1.3× the top speed, capped at 10 s of it, and carries over between saves: honest riding is never refused however unevenly the saves arrive; a jump or going faster on average still is. A 90-second full-speed ride near Abeokuta: 2 then 0 refusals (normal and slow connection), 0 after. Tests: scripts/tests/speed-allowance-api-test.mjs, scripts/tests/long-ride-probe.mjs (SLOW=1, SAVES=1). |
| 19 Oct 2026 | **Out of fuel: parked at the roadside, a jerry can there and back; routes only by road** (owner: "the motorbike/car should be parked at the side of the road, the user should hold the jerry can to go buy fuel, come back and pour… only to 65%"; "when you draw a random road the user cannot travel on it"). An exception to the pocket garage: a motorbike or car that runs dry stays where it stopped (player_vehicles.stranded_at), drawn by the kerb with a red "NO FUEL" tag; it can't be taken out and a petrol station won't fill it from afar. The advice sends you to the NEAREST petrol station (not the next one ahead) and draws the way by road. There the attendant sells a jerry can (25) and fills it (keg_capacity() = 65% of a tank, 2 coins a percent: 130); you walk back with the can in your hand, the way back drawn; beside the vehicle "Pour can" tops the tank up to 65% (never more from a can) and you're back on it. Routes are never a straight line any more: with no road route (the routing service down), no line is drawn and it tries again in 15 s. Tests: scripts/tests/stranded-api-test.mjs (10), jerry-can-browser-test.mjs (14); probes dry-tank-route-probe.mjs, route-to-check.mts. |
| 19 Oct 2026 | **No scrollbars; the Inventory redone; the strike** (owner: "make all the modal scrollbars not visible… the inventory: add icons, make the UI better… when a user uses a relic or super tool that affects others, a thunder strike on the screen, and on the map a tool spinning out till it goes out of the way… think of Mario Kart"). Scrollbars are hidden everywhere (everything still scrolls). The Inventory has a header with the backpack and your coins, and three tabs with counts: 🎒 Gear (each vehicle as a card: its icon, fuel bar, status chip — riding, in your pocket, parked · no fuel; its gear and papers as tiles with pictures, ✓ Got it or "+ Buy · price"; the jerry can with its gauge), 💎 Relics (cards in the relic's colour: picture, rarity, effect, days left, Use) and ✨ Wonders. The strike: when a relic or Wonder that reaches other players is used (Rain Charm, Lockdown Orb; the Orbs, the Eye, the Hourglass, the Thief's Hand, the Bargain, the Sandstorm Crown, the Mirror), the screen flashes white-gold with a lightning bolt and the item's picture spins up and off the screen, the screen shakes, and on the map the item (its picture on a glowing disc in a ring of its colour) spins out from the player in an arc, faster and smaller until it's gone. The one who used it sees it fly ahead; everyone it reaches sees it spin past them (someone's rain reaching you, a new dome near you, a Wonder's news). Test: scripts/tests/strike-inventory-browser-test.mjs. |
| 19 Oct 2026 | **The jerry can, done properly; the vehicle panel redone** (owner: the vehicle showed at the petrol station, "it defeats the purpose of taking the jerry can to the parked vehicle"; "the route to it has been forgotten, except I click the button"; "improve the UI modal… as you did the last one"). At the station a vehicle parked at the roadside isn't at the pump any more: the attendant fills a jerry can standing there. While a vehicle stands at the roadside and you're on foot, the way is always drawn by itself, also after reopening the game: to the nearest petrol station while the can is empty, back to the vehicle once it has fuel (ending the directions or dismissing the advice turns that off for 5 minutes). The vehicle panel matches the Inventory: a header with your way of travel and coins, a red "Your motorbike ran dry · parked 675 m from you" card on top with "🧭 The way to it", then each vehicle as a card (its icon, speed, fuel bar, a chip: riding / yours · in your pocket / parked · no fuel / broken down / its price), its gear and papers as tiles (shared with the Inventory: ✓ Got it, or + Buy · price; for a vehicle not yet bought, tiles ticked to buy with it), and two buttons. Tests: jerry-can-browser-test.mjs (17, with the game reopened twice), gear-browser-test.mjs. |
| 19 Oct 2026 | **Back on your way after the jerry can** (owner: "when I poured the fuel, my old route that was mapped out before I ran out of gas is gone… but I still have the directions toast"). Running dry now sets the way you were going aside (kept on the device, so a reload doesn't lose it; a journey keeps its own step) and draws the way to the petrol station instead; before, an existing route kept the station's way from being drawn at all. Pouring the jerry can puts you back on the vehicle and draws your way again: the journey's current step, or the place you were heading for ("…you're back on it. On to Unilag Senate Building."). After a reload with a vehicle at the roadside, a journey waits to redraw its step until the fuel is in. Test: scripts/tests/resume-after-fuel-browser-test.mjs (11). |
| 19 Oct 2026 | **Games with people on the road** (owner: "for those lost on the way, or passersby that they meet, let them play a game, like mate in 1 chess… not just options riddle"). Passers-by now mostly challenge you to a real game for 25 coins (a riddle 3 times in 10): **♟ Mate in one** with an old chess player at his table (Baba Sola, Uncle Ikenna, Mallam Sani, Pa Adewale): a real board in the strip, tap a white piece then its square; **🥤 Find the coin** with a cups hustler (Tunde Wayo, Sharp Kola…): the coin shown, the cups come down and shuffle 5–8 times, tap the cup; **🃏 Pairs** with children and their cards (Little Bisi, Chidi and Ada…): twelve cards, find the six pairs with at most six misses. A stranded traveller you've helped offers one too, for 20 coins. On the map each has its table (a checkered board and pieces, three red cups and a coin, cards on a mat). The server keeps the answers and judges the move (road_event_play): the chess mate, where the shuffle left the coin, and the cards' flips replayed against the layout. The 30 chess puzzles come from scripts/build-chess-puzzles.mjs: natural-looking positions, each checked with chess.js to have exactly one mating move for White and at least one other check to tempt you (rechecked by scripts/tests/chess-puzzles-check.mjs; mates by queen 21, rook 6, knight 2, pawn 1). Tests: road-games-api-test.mjs (19), road-games-browser-test.mjs (13). |
| 19 Oct 2026 | **The Jerry Can relic counts; thank-you gifts** (owner: "I had a jerry can, and I was still made to purchase one"; "helping strangers… should not be limited to giving only coins… small items like jack, jerry can"). The owner's "jerry can" was the Jerry Can relic, which only fuelled the vehicle being ridden, so a dry vehicle at the roadside sent them to buy a can. The Jerry Can relic is now a full jerry can: beside a vehicle that ran dry it fills the tank to 65% and puts you back on (a gold "Jerry Can" button there; the way back to the vehicle is drawn when you have one, never the way to a station); on a ridden tank it tops up to 65%. A traveller you help now gives a gift: a relic (Jerry Can, Second Wind or Shield; 40%), a full jerry can (a new one, or yours filled; 15%), a tyre kit (pump and patches: a bicycle's tyres pumped or a flat fixed anywhere, from the gold button or the inventory; 15%), otherwise 15 coins; in a hunt the key hint, and 4 times in 10 a gift besides. (A car jack would need flat tyres on cars and motorbikes, which the game doesn't have yet: the tyre kit is the small tool for now.) Tests: gifts-api-test.mjs (8, 40 helped travellers), jerry-relic-browser-test.mjs (7). |
| 19 Oct 2026 | **The Loota logo** (owner's artwork: the script "Loota"; kept in assets/loota-logo-source.webp). scripts/build-logo.mjs makes transparent versions in public/brand (cream for the dark screens, brown for the parchment cards, gold for big moments) and the app icon (the cream logo on the ink tile: src/app/icon.png and apple-icon.png, replacing Next's default favicon). The logo is in every page header (home, log in, sign up, lobby, look, onboarding, owner tools: components/Logo.tsx, LootaLogo), and on the hunt: at the head of the hunt card on the map, in gold above the countdown, in brown on the first riddle and on the end-of-hunt card, and on the broadcast. Screenshots: scripts/tests/logo-shots.mjs. |
| 19 Oct 2026 | **The roadside games against the clock** (owner: "let there be some form of urgency, add a countdown timer"). Tapping Play starts the clock (road_event_game_start, kept on the server): 30 seconds for mate in one, 6 seconds to pick a cup once the shuffle ends, 50 seconds for pairs. The bar in the scene strip counts down (red in the last 5 seconds); at nought the board locks and it's lost ("Time! Too slow, my friend. It was Qc8#."). The server judges the clock too: a move later than the time (plus 4 seconds' grace for the network), or without Play tapped, loses. Tests: road-games-api-test.mjs (24), road-games-browser-test.mjs. |
| 19 Oct 2026 | **Servicing at the mechanic's is a scene and takes time** (owner: "the servicing of motorbike was not a scene and it was fast"). The Service button opens the mechanic's open workshop on the map: your motorbike or car on the stand, the mechanic (Oga Tunde, Mr Bayo, Kalu, Mallam Idris, Uche). He names the job ("Your okada's engine is at 60%. Oil change, plugs, a good tune: 60 coins, about 35 seconds"; a broken-down one: "I'll open the engine and fix it"); "Go ahead" and he bends over the engine with a spanner while the bar fills: 20 seconds for a light service, more the more worn the engine, 45 for a breakdown. Only then is it charged and the engine at 100, and it sparkles. Test: scripts/tests/service-scene-browser-test.mjs. |
| 19 Oct 2026 | **The ticket office from anywhere at the station** (owner: "the buy ticket for train… not showing a scene or anything when I got to the ticket location"). At Alaba station the owner stood 38 m from the stop, but the office door (placed by the road nearest the desk) was 60 m off, across the expressway, and the gold button only showed within 30 m of the door, which nothing marked. Now the button shows as soon as you're at the station ("🎫 Ticket office · 60 m"), a green "🎫 TICKETS" sign (✈ "CHECK-IN" at airports) stands over the door, and tapping the button walks you in when the door is close (up to ~110 m: within the desk's reach the server insists on), or draws the way to it when it's further. Tests: scripts/tests/ticket-near-browser-test.mjs (at the owner's spot: button, hall, fare, paid, trip), ticket-office-browser-test.mjs. |
| 20 Oct 2026 | **A new player's first hour, part 1** (owner: yes to 500 welcome coins and publishing the practice hunt). Walked through as a stranger (scripts/tests/first-hour-walkthrough.mjs: home, sign up checks, log in, onboarding, lobby, the map and every panel, the hunt). Changes: **500 welcome coins** when a player finishes onboarding (set_home, their first home, once: reference welcome:<id>); **Practice Hunt: Lagos Run published** (to 27 Oct; keys 2 and 3 now in the landmark plaza scene); a **welcome tour** the first time on the map for players welcomed at onboarding (four cards: welcome and the coins, getting around, the buttons, and the live hunt with "Join the hunt" or what to do first; once per device; WelcomeTour.tsx); a **"A hunt is live" invitation** on the map for players not in it (Join, or ✕ for this visit); a **too-far warning** on directions on foot or by bicycle ("Your energy lasts about 4.8 km on foot: take a taxi or bus, get a bike, or eat and rest on the way": the airport, the first key, is 11.5 km from Yaba and a newcomer would have fainted halfway); the hunt card's header without the logo (it squeezed "Key 1 of 3" to "K…"; the logo is in the top bar). |
| 20–22 Oct 2026 | **Search here only in the key's area** (from the detector's pulse); the detector's heat on a log scale (Burning ≈ 100 m or closer); "Open the chest" works with the hunt card put away. **Fresh questions**: no repeats per player (questions_seen; landmarks ask the least recently asked); the bank grown by Claude (scripts/generate-questions.mts: Claude Haiku 5.5 writes, Claude Sonnet 5.5 answers each blind; 49 → 169 bank questions, 51 → 181 landmark questions); /admin "Draft with Claude" riddles. **Owner's decisions (22 Oct):** bicycle stays 600 coins; checkpoint "Ride on" is a gamble (60% away, caught: 2.5× the fine and 60 s held); **the lamp's finds in free roam too, at half the coins** (Radar/Fast Pass as 60 coins; the Orb stays in hunts); **flat tyres** for motorbikes and cars (about one in 100 km; a jack, 120 coins once, or a roadside mechanic, 40). |
| 24 Oct 2026 | **Key Trials become puzzles** (owner: "the questions are too easy… I do not want always a question… it should be a task, like solve a puzzle… there are already competitors… we need to do better: graphics, UI/UX, logic, suspense, thrillers"; asked to research LinkedIn's and Netflix's mini puzzle games). Research: LinkedIn Games (Queens, Tango, Zip, Mini Sudoku, Pinpoint, Crossclimb: short daily logic puzzles, streaks, leaderboards among connections) and Netflix Puzzled (Nov 2025: Sudoku, Bonza, Jigsaw, Crossover, Keysmash, Waywords, Starstruck, Shapes; Scattergories 2026). Built: three puzzles in Loota dress, made fresh per attempt (seeded, exactly one answer, checked by the server; the answer never reaches the phone): **Sentries** (after Queens/Starstruck: one sentry per row, column and coloured district, none touching), **Route** (after Zip: one path through every square, numbers in order, walls), **Adire** (after Tango: indigo and white cloth, balanced rows and columns, never three alike, = and × signs). Harder by key (Sentries 7→9, Route 6→7 with fewer numbers, Adire fewer clues); 90–180 s; two lives; early keys warn when a rule is broken, later ones don't. hunt_keys.trial_kind (quiz, one puzzle, or a random puzzle; /admin, default a random puzzle); /api/trial/puzzle and /api/trial/solve; puzzle_ready/puzzle_result; award_trial shared with quizzes. Owner chose next: **relay keys set per key** (a chest that holds a clue to a second place), and priorities **UI/UX polish, thrill and suspense, story and characters**. Still to come in this push: relay keys, harder quizzes (typed answers), more puzzle kinds (a torn-map jigsaw of the key's real streets, Pinpoint-style "what links these", a word ladder, a code lock), then the thrill/story/polish plan. Tests: puzzles-check.mts, puzzle-trial-api-test.mjs, puzzle-trial-browser-test.mjs. |
| 25 Oct 2026 | **The Masquerade's trap chests** (owner: "do it"). A key can have a decoy chest, set per key in /admin ("Add a trap chest": on an ordinary street 180–280 m from the key's spot). Within 60 m it rises exactly like the key's chest, with the same words and drum roll; the tell is the detector, which always reads the real key, so the heat by a trap is never Burning. "Open the chest" there: the Masquerade's scene (light and playful), 25 coins (or what's left), then 15 s dizzy. Once per hunter and key; then it's gone for them. |
| 25 Oct 2026 | **Finds, relics and Detours inside the streets** (owner: "Items to find, relics, quiz location should not be on the main road, it should be inside the streets"). A square's find and decoy lie on an ordinary street (residential, unclassified, tertiary; not on a bridge or in a tunnel), at least 35 m from any main road; a square with only main roads stays empty. Each place has a street spot within 200 m of it, 30 m clear of main roads (found as players come near; Lagos done at once), and a Detour at that place is held there ("near <place>"). Landmarks stay where they are: they're real monuments. |
| 25 Oct 2026 | **The first launch, polished** (owner: "start" the UI polish pass). Home: a drawn hunt scene (a hunter with the riddle, the marching way to a glowing chest, the Masquerade by it), the live (or next) hunt with its countdown, the four steps brought up to date (puzzles, the Masquerade), and "Meet the villain". Lobby: the live hunt first, as the big card (keys, hunters, a live countdown, the prize, one big button); Free roam below it. The welcome tour shows rather than tells: an open chest, the hold/swipe/SPRINT moves animated, the Masquerade guarding a chest. The practice hunt's description no longer names its three places. |
| 25 Oct 2026 | **The panels, polished.** Help ("?") is now "How to play": a hunt in five steps (riddle, get there, the heat, the chest, the Key Trial), the Masquerade's trap tell, the moves animated as in the tour, the buttons, the rest folded under "Good to know", a sound switch and "Show the welcome tour again". Landmark and transport rows no longer cut off what matters: the reward is a gold "+80 coins" badge, distances a pill, names wrap; major landmarks are marked gold. A Buy button that's greyed out now says how many coins are short (and to rent meanwhile, or untick gear). |
| 25 Oct 2026 | **The riddle clock, a cleaner card, no landmarks** (owner: "all users get to answer within 15 seconds… you get to wait, while those who inputted a location get to travel, remember no one knows if the location is correct"; "include a way to input the direction in the board"; "make the leaderboard an icon on the right"; "I do not think we need the landmark"). When a hunter first sees a riddle (nothing in front of it), they have 15 s to type and pick the place in the card; it's locked in and the way there is planned. Miss it: 60 s standing still ("Too slow! Others are already on their way."), then another 15 s. The answer can't be changed on the way: reach it and, if it isn't the key's area, "Nothing here" and a new 15 s. The clock lives on the server (start_riddle, lock_guess, riddle_state; key_pulse clears a wrong place; search_here refuses until answered), so a refresh can't skip it. The riddle is no longer shown on the key/relay result cards or the hunt's opening card (no thinking time before the clock). The card loses "No typing…", "Key Trial: …", the prize line and "Golden minutes in…" (the chip shows only while they're on); 🏆 with your rank sits top right and opens the board (prize, rank, the next Key Trial). Landmarks are gone from the game: no button, panel, Check in, or monuments on the map (their tables stay, unused). |
| 25 Oct 2026 | **The top of the map** (owner: "in the center of the screen at the top, there are to be a countdown for each hunt… reduce the human strength meter, turn it into a circle… the leaderboard should have an icon on the right side too"). Energy is a small ring (green, gold under 50, red under 20) with the number inside. In its place in the middle: the hunt's clock (Starts in / Ends in, red in the last hour), for the joined hunt or a live one to join; during golden minutes it turns gold, "✨ Golden 6:39", and golden minutes are no longer on the card. 🏆 joins the tools on the right (in a hunt) and opens the card on its leaderboard, bringing the card back if it was put away. The card keeps its own 🏆 too. Fixed on the way: the riddle clock could show "Too slow!" too early when the phone was busy loading the map (the card's clock lagged); it now never reads older than the server's answer. |
| 25 Oct 2026 | **The leaderboard, plainer; the place search, faster** (owner: "The leaderboard when opened should only show the users and the number of keys they have collected"). The board lists each hunter and 🗝 their keys, yours highlighted; nothing else. With only 15 seconds to answer, the place search now looks in our own famous places and named places first (a fraction of a second) alongside OpenStreetMap, waiting for OpenStreetMap only a moment more when ours already has matches; it starts searching sooner after typing. Typing a riddle's place and picking it went from about 8 s to about 1.3 s. |
| 25 Oct 2026 | **The leaderboard on its own; sounds; the metal detector** (owner: "Clicking on the leaderboard. I am still getting the quiz question and all. Also, let hear the heart beat if someone is tired, also, let hear the sound if someone is closer to the key location, like a metal detector. I think there should be an option to buy metal detector"; chose: it beeps and reaches farther, 300 coins, kept). 🏆 turns the card into just the leaderboard (hunters and 🗝 keys) with "Back to the riddle". The heartbeat now means tired: under 25 energy it beats, faster and stronger as energy runs out. Near a key, a bought metal detector beeps, faster and higher as you close in (no beeping without one; everyone keeps the silent heat chip and glowing edges). The detector is bought once in the inventory (300 coins, profiles.detector, buy_detector) and picks a key up from 1.5× farther (key_pulse). |
| 25 Oct 2026 | **Never stranded off the road** (owner: "I cannot get on any of my vehicle"). Thrown 2 km out of a failed Key Trial, the owner had landed off any road (south of TBS); the map put them on the nearest road 380 m away, which the server took for walking too fast, so every save, and every attempt to get on a vehicle, was refused from then on. Now: (1) when the map has to put a hunter onto a road more than 30 m from where the server last saw them, it says so (place_on_road: up to 800 m, at most once every two minutes), and ordinary saves wait meanwhile; (2) a failed trial throws the hunter to a street spot 1.5–2.5 km from the key (the places' street spots), the old random point only where there's none. The owner's position was moved onto the road by hand. |
| 25 Oct 2026 | **Police chases** (owner: "if you escape police, they should give you a chase"). Riding (or walking) past a checkpoint no longer rolls a die: the police come after you along the very road you take, sirens wailing, the screen's edges flashing red and blue, a chip counting "Police 45 m behind · 32s". An officer on foot (7 km/h) after a walker, a patrol car after a rider (24 km/h after a bicycle, 40 km/h after a motorbike or a car), starting 25–60 m behind. They close in when you slow (a red light, a jam, a turn): within a few metres you're caught, the fine of before (50 coins, 100 with two papers missing) and 60 s held. A lead of 150–400 m, or holding out 40 s: "You lost them!", nothing to pay. A walker gets away only by sprinting; a motorbike only by never stopping; a car by keeping moving. |
| 26 Oct 2026 | **Cruise** (owner: "change the sprint button to a cruise button… users can collect tokens to fill it up… move without pressing the keys… it can only go straight, users will need to monitor it"; chose: Cruise beside Sprint, which stays; tokens from the side streets, travellers' gifts, buying and a free daily top-up; 15 s a token, 8 at most). The teal CRUISE button (beside SPRINT, or in its place on a motorbike or in a car) takes the hunter on by themselves: straight on at junctions unless they swipe or press ← → to turn there. A token is 15 s of moving (waiting at a red light or in a jam doesn't use it up); it stops at a dead end, when the tokens run out, or when something stops the hunter (a scene, the riddle clock, a trip). Tokens: two lie in the side streets of the square around a player (teal discs, picked up within 15 m; restocked when gone, 3 h each), a stranded traveller's thank-you can be two, the inventory sells 4 for 40 coins, and everyone gets 2 free each day (Lagos time). The button's ring shows the tokens held, or what's left of the one in use. |
| 26 Oct 2026 | **Hunting hours, a resting Lamp, rarer cruise tokens, no jerry-can chip** (owner: "the hunt for each day should be from 9 am to 9 pm. After that users can be allowed free roam"; "the [Lamp], when one is completed… shows another immediately. It should not be" (chose: rest 15 min); "the cruise item on the map is too much"; "remove the empty jerry can icon… on the screen"). A hunt is live 9:00–20:59 Lagos time each day between its start and end; outside, it's 'paused' (hunt_phase): no searching, detector, trials or riddle clock, so free roam; the card says "🌙 The hunt rests from 9 pm to 9 am… Back in 08:42:10", the top clock "🌙 Back in", the lobby "Back at 9 am". (hunts.all_day lets a hunt run round the clock: the automated tests' hunts.) The Lamp rests 15 minutes after each thing is claimed, tried, over or let go ("🌙 The lamp is resting…"). Cruise tokens: a square is rolled once per 3 hours, a single token 40% of the time, seen only within 150 m, and smaller. The jerry can's chip is gone from the screen (the can is in the inventory). |
| 26 Oct 2026 | **Pouring the jerry can, as a scene** (owner: "You don't need to pour can on the screen in the middle, maybe up close to the fuel icon"; "the pour should be a scene, the user gets off the bike, and pour, also, show a jerry can with the fuel as percentage, that is showing the fill of the fuel in the jerry can"). Riding with a can of fuel and a tank below 65%, "🛢 Pour · 77%" sits by the fuel gauge at the top (a little can showing its fill), not in the middle (in the middle only on foot by a vehicle stranded at the roadside, where there's no gauge). It opens the scene: the hunter off the vehicle beside it, the can and the tank as gauges; "Pour it in": the can tips, the fuel runs, the can's fill counts down and the tank's up together; then Ride on. Also: the bottom message box keeps clear of CRUISE; /favicon.ico answers with the app's icon. |
| 26 Oct 2026 | **The jerry can as a badge; the departure lounge** (owner: "The jerry can is a collectible item… empty until filled at the gas station… the pour is not needed. Remove it from the screen, but in case the user has some fuel in it, remind them by adding it as a badge on the gas tank icon"; "The check-in at the airport, instead of standing at the road waiting for the plane… make the user walk to the lounge to sit. This will create a scene"). No Pour button on the screen: a can with fuel shows as a little can (its fill) on the ⛽ gauge, and tapping the gauge opens the pour scene; "Pour can" stays in the middle only on foot by a vehicle stranded at the roadside. After check-in ("Thanks! To the lounge 🛋️"), the departure lounge: the hunter walks in and sits with other passengers, windows on a plane at its stand, the board ("MUR → GAT · GATE 2 · BOARDING IN 7:03", the gate the same as on the boarding pass: gateFor), a chime and "Now boarding" in the last 20 s; it closes as the plane leaves. "Look at the map" puts it away; a "🛋 Lounge · boards in 6:42" chip brings it back. Also: Next.js 16.4.0 → 16.4.3 (critical security fixes). |
| 26 Oct 2026 | **The jerry can only when the fuel runs out** (owner: "remove the jerry can totally. I don't think it is needed… except when fuel finishes"). No badge on the fuel gauge, nothing about the can on the screen while a tank has fuel, and no topping up a half-full tank: "Pour can" (the pour scene) appears only beside a vehicle that ran dry at the roadside, or for an empty one in the pocket. The can itself stays in the inventory, bought and filled at petrol stations. |
| 26 Oct 2026 | **Bigger on phones; help with the tools** (owner: "Let's work on the mobile responsiveness. Zoom in a little more. If we are using 14, use 16 on mobile"; chose: text and buttons; "the ? icon should be moved down so that the relics icon can move to the [end]"). On screens up to 640 px wide the root size grows by 16/14: 14px text reads 16px, and everything sized with it (buttons, chips, panels) grows about 14%; the map's zoom is unchanged. The ? button moved from the top bar to the top of the tools column on the right, so the inventory (relics) button ends the top bar. Vehicle panel buttons stay on one line. |
| 26 Oct 2026 | **Swipe anywhere to turn** (owner: "On mobile we should be able to swipe left and right to make turns"). On a touch screen a sideways swipe anywhere on the map turns at the next junction (the Left/Right chip; the same way again cancels), not only in the lower part; holding the lower part still walks and a swipe down there still turns back. In the upper part, up or down tilts the view; turning the view sideways is left to a mouse (on a phone the view swings back behind the hunter as they move anyway). |
| 26 Oct 2026 | **Riding and driving tire you too** (owner: "Even when someone is riding a motorbike or driving a car, their energy should still deplete so we can tell them to go rest, they have been driving for too long"). A motorbike drains energy at about a third of walking's rate per second and a car a little less (a full bar lasts about 14–16 min riding flat out, 21–24 min driving; walking about 5); the server counts the same (energy_per_m). Reminders at 50 ("Time for a break"), 25 ("Pull over and rest") and 0 ("Too tired to go on"), pointing to a park or a place to eat, or Rest here. Riders and drivers can now Rest at a chill spot and Rest here ("You pull over and rest by your motorbike"). Out of energy at the wheel there is no fainting: the vehicle stops and won't go on until energy is back to 15. |
| 26 Oct 2026 | **A Fast Pass while you wait** (owner: "I am at the bus stop and I cannot use the fast pass"). It could only be ticked when booking a ride; now, once booked and waiting, the trip banner has a 🎟️ Fast Pass button (and the Bag's Use works too). A bus, train or taxi comes at once, and a crowded bus's scramble is skipped; a flight skips the check-in queue (5 minutes off). Used with nothing booked, it says how and is kept. |
| 26 Oct 2026 | **More from the lamp** (owner: "the lamp only gives jerry can, it should give cruise and other things too"). A Detour now holds coins, a relic, cruise tokens (2 in a flash, 3 in a rush, 4 in a flash rush, up to the 8 a hunter can hold) or a tyre kit; cruise tokens turn up twice as often as any one relic, and a jerry can is now about 1 Detour in 15. Cruise tokens and tyre kits are given in free roam too. |
| 26 Oct 2026 | **News for everyone** (owner: "when a user picks a tool, all users should see an announcement"). A relic picked up on the map, and a lamp prize that isn't coins, are news on every player's map within about 12 seconds ("Ada picked up 🛡️ a Shield!", "🪔 Ada won 🚗 3 cruise tokens from the lamp near Tejuosho Market!"), a few seconds each, in the same strip as the hunt's news. Coins aren't news; the finder doesn't see their own. Only the server writes news (world_news). |
| 26 Oct 2026 | **The leaderboard tool like the others, and it lights up** (owner: "the leader icon should be like all other icons, when a user collects a key, it lits up"). A line-drawn trophy in the right-hand column, dark like the other tools; when another hunter takes a key it turns gold and glows (as the lamp does with something new) until it's opened. |
| 26 Oct 2026 | **Loota livery on buses, trains and planes** (owner: "let's brand our bus, trains, and plane. This can be used as ads for investors"). The logo on each side of a bus and train carriage, and gold on their dark roofs (what the map's camera sees most); planes get a gold tail with the logo, the logo by the door and across both wings; the lounge's plane through the window too. Trains now wear the brand's gold stripe and nose. |
| 27 Oct 2026 | **Never stuck behind an airport's fence** (owner, landed at San Francisco: "I cannot leave the airport, I was dropped on a road that leads nowhere"). Roads with no public access (an airport's airside, a private yard) are known as such; a group of roads with no way out to the public ones (none in it at all, or, apart from the town's own, mostly closed) counts as shut in, however big. A hunter there is put on the nearest road that leads somewhere: up to 800 m away any time, up to 3 km just after landing. Landing at a foreign airport now puts you by the terminal side, not the middle of the airfield. Ordinary streets in Nigeria are unaffected (checked across Lagos, and every station and airport desk). |
| 27 Oct 2026 | **"Get me out": nobody stays stuck** (owner: "we need an everlasting solution to this, because it will be disastrous when we go live"). Whatever the map's roads get wrong, a hunter can be put on the nearest road that leads somewhere (the biggest group of joined-up roads around them), up to 2 km away. The game offers it ("🧭 Going nowhere? Get me out") when it sees them going nowhere: three dead ends close together within 3 minutes, 600 m walked in 8 minutes without getting 200 m from the start, shut in with no road out near enough to step onto, or no road near enough to stand on at all. It's always in the help panel too. The server allows it once every 10 minutes, 3 times a day, never mid-trip, frozen or into a Lockdown dome, and logs every use (unstuck_log: where they were stuck), so the places the map gets wrong can be found and fixed. |
| 27 Oct 2026 | **Loota Radio** (owner: "enable music or radio, so users can listen as they move so it is not just boring"; chose real Nigerian radio, a button on the map). A radio tool in the right-hand column opens ten live stations (Cool FM, Beat FM, Wazobia, Naija FM, Rhythm, LagosJump, Softlife Afrofusion, InterSpace Sound, Eagle 7 Sports, Nigeria Info): on/off, previous/next, any from the list, volume. It keeps playing while you walk, ride or drive and through scenes, dips under the game's own sounds, shows on the phone's lock screen, and is remembered on the device (back on at the first touch). Streams come from the stations themselves (listed in a public directory); **before launch, get the stations' OK** (or keep only those that allow it). Uses about 60 MB of data an hour. `ALL=1 node scripts/tests/radio-browser-test.mjs` checks every station still answers. |
| 27 Oct 2026 | **Closer on a phone** (owner: "on mobile … zoom to 18"). Phones (screens up to 600 px wide) play at zoom 18 instead of 17; larger screens stay at 17. Hunters and vehicles keep their size on screen (they're scaled to stay readable); the streets around them are twice as big. Long bus rides and trains pull back one step as before (17 on a phone); scenes are unchanged. |
| 27 Oct 2026 | **A faint that sticks** (owner: "the logic to make the user faint when on 0 health is no longer working, the avatar just looks like falling, and then continue moving"). The server counts energy from the straight line between saves, so after winding streets or turning back it thought a little was left when the phone reached 0, and the hunter was stood back up. Now the phone's collapse is taken when the server's count is low too (15 or less): on foot or a bicycle the hunter stays down and the ambulance comes. A faint is never lost behind a save already on its way. |
| 27 Oct 2026 | **One energy, whatever you do** (owner: "it is one health life… on 5%, riding a bike, and I get on the plane… the health should start from 5% but can begin to increase because they are in a rest mode… on a motorbike… it will continue from 5%, and still get tired"). Energy is one value across walking, cycling, riding, driving and trips. A bus, train or plane ride (and the wait for it) is rest: it climbs as on a pause (15 a minute), from where you were. Off it, any vehicle carries on from there and tires you as before. The server never loses rest time: anything that moves its clock on (a trip ending, being put on a road, Get me out) banks the rest first (database rule bank_rest). |
| 27 Oct 2026 | **No false dead ends abroad** (owner, cycling on Cowper Street, Palo Alto: "on a free and straight road no obstacle or dead end, and yet, when I move, it turns back, then turn back again acting as if both ends are dead"). Outside our own road data the roads come from the map's tiles, and each tile also carries a margin of its neighbours' roads: near every tile edge the same road came twice, half a metre apart, and the copies tangled into stubs and hairpins that turned the hunter round. Now each tile's roads are cut to the tile itself (only the most detailed tiles are used), and loose ends left after duplicates merge are joined to the road they lie on. False dead ends around the owner's spot: 8 → 2 (two 2 m driveway nubs at junctions). |
| 27 Oct 2026 | **Places and bus stops everywhere** (owner, in the United States: "I cannot pump my tire at the gas station… when I pass bus signs on the map my bus icon is not lit up"). Petrol stations, places to eat and rest, tyre shops, mechanics, hospitals and bus stops were imported for Nigeria only; abroad there were none (the bus signs on the map are only its drawing). Now each ~5 km square a hunter comes to outside Nigeria is filled once from OpenStreetMap (the Overpass service, with public mirrors when it's busy) and kept: the square they're in first, then the eight around, one per visit to the server, in the background (each takes ~40 s; they show within half a minute). Places marked private (a firm's fuel yard) are left out, in Nigeria's next import too. Palo Alto: 13 petrol stations, 270 places to eat and 262 bus stops within ~3 km. |
| 27 Oct 2026 | **One size fits all: buses and trains by the country** (owner: "if I am in other countries, the bus, train should work according to the country not showing nigeria again"). Abroad the travel panel offered "Jebba station · Lagos–Kano Train, 12,457 km" and "motor parks all over Nigeria". Now: only a train station within 100 km and a bus stop within 50 km are offered; a long-distance bus leaves from a "motor park" in Nigeria and a "bus station" elsewhere; the journey planner's long-distance bus, train and drive no longer require Nigeria (a coach within 1,500 km anywhere, a train between stations on the same line, a plane beyond 150 km). Train lines abroad come in with the area, whole, from OpenStreetMap (a line's way and stations, the two directions as one; a very long line as its stations joined up). Planning a trip to a place whose area isn't in yet starts it ("being looked up: check again in a minute"). |
| 27 Oct 2026 | **Places from the map itself** (owner, in San Francisco: "to chill, it should be either restaurants or eateries, malls. But it is telling no chill area", cafés all round on the map). Areas abroad are now filled from the map's own tiles (the cafés, restaurants, petrol stations, bus stops, parks and malls it draws): seconds instead of minutes, and what the game knows is what the hunter sees. One area at a time, retried if it stops part-way; its places count before its (slow) train lines. **Malls are chill spots** everywhere, as parks and places to eat are (scripts/add-malls.mts adds Nigeria's). The owner's spot on Division Street: Dumpling Time 14 m away. |
| 27 Oct 2026 | **The logo along the bus** (owner: "the logo and the bus should have been vertical aligned instead of horizontal so that it can show very well"). On bus and train roofs the logo now reads from the back to the front, the way they run up the screen, as big as the roof is wide (2.2 m, was 1.9). |
| 27 Oct 2026 | **Long-distance buses abroad, straight away** (owner, in Calgary: "I want to go to red deer but it is telling me Looking up the bus stations around Red Deer: try again in a minute"). A trip to a place whose area isn't in yet now waits the few seconds its square takes (from the map's tiles) and prices the bus there and then; the squares around and the train lines follow behind. A long-distance bus's way abroad goes by the routing service: our main-road network is Nigeria's, and it had taken Calgary to Red Deer by way of Nigeria (21,311 km, 8,545 coins; now 140 km, 76 coins). Searching a city's name finds the city: the search favours places near the player so much that from Calgary "Edmonton" found only Edmonton Trail, a street there; a town or city by that name now comes first. The ambulance abroad drives by the routing service to a hospital too (it had always sent paramedics: no roads of ours there). |
| 28 Oct 2026 | **The country you're in, not just Nigeria** (owner: "it is not only focused on Nigeria but the country which you find yourself"). The game knows which country the hunter is in (/api/world/country, asked again every 20 km travelled) and plays as that country does (src/game/locale.ts). Words: a motor park or a bus station, a vulcanizer or a tyre shop, an okada or a motorbike. People: the pump attendant, cook, vulcanizer, mechanic, nurse, paramedic, renter and ticket clerk have names from that part of the world (Nigeria's as before; Ghana, East and Southern Africa, francophone, Arabic-speaking, Spanish, Portuguese, German, Italian, Dutch, South Asian, Chinese, Japanese, Korean, Turkish, Russian, Filipino; English names elsewhere). Talk: Nigerian pidgin in Nigeria ("No wahala", "Ehen!", "soft o"), plain English elsewhere ("No problem"). Radio: the stations of the country you're in first (its most-listened in the public directory), then Nigeria's under their own heading; what's playing keeps playing across a border. Left as Nigerian on purpose: the Masquerade's voice (he's Loota's own), hunts in Lagos time, coins priced in naira. |
| 28 Oct 2026 | **A new home page** (owner: "You need to improve the landing page"). The page now shows the real game: phone-framed screenshots (the chest burning on the map, the Torn Map, a Sentries trial, the beach keeper, the Masquerade's story, a petrol station scene, roadside chess) instead of only an illustration, and says what the game is now: play from anywhere (no more "across Nigeria"; Nigeria's flavour stays as an example, "Okada in Lagos"). Sections: hero (500 coins to start, walking free, no download; the live/next hunt card as before), how a hunt works (4 steps), the game in pictures (swipe on phones), getting there (7 ways to travel + the Lamp, the Djinn's Wager, trouble on the road, local people, radio), the Masquerade, fair play (4 promises incl. hunts resting at night), questions, a last call to sign up, footer. Pictures: `node scripts/build-landing-shots.mjs <shot.png>=<name>` from the browser tests' screenshots, taken with `node --import ./scripts/tests/shot-mode.mjs` (hides the dev badge; SHOT_DAY=1 for daylight where nothing counts down). Check: `scripts/tests/landing-shots.mjs` (phone + desktop, no errors, no sideways scroll, every picture loads). Retake the pictures when the game's look changes. |
| 28 Oct 2026 | **Phone: the road ahead, and no accidental presses** (owner: "on mobile … we are too close to the front"; "my hands are mistakenly pressing the prompts on the screen like refuel"; "super faster on mobile while laptop speed looks normal"). On a phone the camera keeps the hunter two-thirds of the way down the screen (map padding, `chasePad` in GameMap), so twice as much road ahead shows; laptops stay centred. The gold "do it here" buttons (Refuel, Eat, Pump, Open the chest…) ignore a tap in their first 0.9 s on screen, a press held longer than 0.6 s (a thumb resting there to move) and a swipe across them; the keyboard always works. Speed: measured the same on both (`scripts/tests/speed-probe.mjs`: 52.8 m/s on a bicycle, phone and laptop, 58 fps); the phone only looks faster because its zoom is 18 (twice the pixels per metre on a small screen: 0.26 screen heights a second against 0.12). Speeds stay the same on every device (a fair race). Test: `scripts/tests/here-tap-browser-test.mjs`. |
| 28 Oct 2026 | **A tidier phone screen** (owner: "we cannot keep too many toast on the screen on mobile. We might need to use icons… like calling a taxi, we can just show taxi icon and the time badge"; zoom: chose the middle, 17.5). Phone zoom is now 17.5 (laptop 17): the ground slides by about 1.4× as fast as on a laptop instead of 2×. On a phone the status cards (journey, directions, ambulance, taxi or rental, warning, "Going nowhere?", bus/train/plane trip) fold into a row of icons with a short badge (🚕 2:30, 🚌 45s, an arrow and 200 m, 🧭 2/4); tap one to open its card, tap again to fold it. A new card shows in full for 4 s first; a card waiting for the player (taxi here, Board) glows gold and stays open. News shows one toast at a time on a phone (two lines at most), and long chips drop their extra words. Laptops are unchanged. Test: `scripts/tests/status-pills-browser-test.mjs`; `scripts/tests/tile-load-probe.mjs` counts the map tiles a phone loads (5 tiles, ~280 KB, on a road in ~5 s). |
| 28 Oct 2026 | **The plane on a phone; the lamp while riding** (owner: "the plane is too big on mobile, also, when inside a plane or train, one cannot go to find a relic even when the lamps turn on"). On a phone the plane is smaller (0.3 at the gate, 0.75 at cruising height; 0.45 and 1.4 on a laptop). The lamp rests while you're on a bus, train, plane or taxi (waiting included): lamp_state answers `riding` with nothing in it and spawns no Detour around the stop you left; the lamp panel says it rests while you travel. Getting off, the lamp looks around where you are; a Detour or whisper it held more than 5 km away (lamp_left_behind_m) is let go with no rest before the next (the Detour set aside in lamp_dismissed, the whisper faded). Migration lamp_rests_while_riding. Test: `scripts/tests/lamp-riding-api-test.mjs`. |
| 28 Oct 2026 | **Plane size and the km countdown** (owner: the phone plane was then "too small"; "add the km countdown in the icon for travel"). Phone plane halfway: 0.38 at the gate, 1.05 at cruising height. On a phone the trip's icon shows the distance still to go and the time, counting down once moving ("✈ 422 km · 49:43"; under 10 km to a tenth, under 1 km in 50 m steps); while waiting, just the time. Test: `scripts/tests/trip-pill-browser-test.mjs`. |
| 29 Oct 2026 | **Where to, on the trip's icon** (owner: "add the location name to the travel icon, just make the font small, it doesn't make sense travelling without showing the address one is going"). On a phone the trip's icon (bus, train, plane, taxi) and the journey's icon show the destination in small letters (10 px, cut short if long) above the badge: "Abuja / 422 km · 49:45". Test: `scripts/tests/trip-pill-browser-test.mjs`. |
| 31 Oct 2026 | **Radio: see the stations** (owner: "improve it so we can see the stations list"). On a phone the radio is now a sheet from the bottom over the whole map (the gold buttons no longer cover it). What's playing and ⏮ ▶ ⏭ share one slim row, so the list gets the room: about six stations at once, scrolling, grouped under "Stations in <your country>" and "Nigerian stations", with a "Find a station" search when there are more than eight. Laptops keep it in the left column. |
| 31 Oct 2026 | **Admin: a tidier hunt list, and deleting hunts** (owner: "work on the admin, and remove all hunts we do not need"). Hunts are grouped Live now / Coming up / Drafts / Finished (finished folded away), each with its status. Any hunt that isn't live can be deleted (Delete → type DELETE → "Delete for good"): its keys, hunters, trials, story and bonuses go with it; coins already won stay. A live hunt must be unpublished first. Finished hunts no longer show Broadcast or Publish. The Djinn box shows the real state (the Wager on now, its Wonder and end, or "comes by surprise"); Summon only shows when none is on. Test: `scripts/tests/admin-hunts-browser-test.mjs`. |
| 31 Oct 2026 | **Story hunts in the admin** (owner: "the hunt is a story generation sequence… what I need is to enter the number of keys, the start time is from 9am to 9pm… a prompt for image generation… and where I will upload it to"). Owner tools → **New story hunt**: keys, the day it starts, days, prize, winners (always 9 am–9 pm Lagos). The story engine (src/lib/story/engine.ts, the same one `npm run story:new` uses) writes it one step per request while the page is open (`/api/admin/story-step`, 5 minutes a step at most), with a progress bar; a stop (no API credit, lost connection) shows the reason and **Carry on**. When ready, the hunt takes the story's title and logline, gets a key at each real place (snapped to a road, asked by the story's question, a puzzle trial), and a slot per picture prompt: **Copy prompt** for ChatGPT, **Upload picture** straight to Storage (bucket story-pictures). **Read the story and its answers** (/admin/story/<id>). The old full form is folded under "Make a hunt by hand". Tables: hunts.story / story_status / keys_wanted, story_pictures, story_registry (replaces docs/stories/registry.json). Test: `scripts/tests/story-hunt-admin-browser-test.mjs`. The story player for hunters and the live channels are still to build. |
| 31 Oct 2026 | **Story hunts written in Claude Code, not the paid API** (owner: "No, that would cost us more… Since hunts are per day, I can always prompt you to create a new story"). **New story hunt** now only makes the hunt (keys, day, days, prize, winners; 9 am–9 pm Lagos) with story_status `waiting`, and its card shows the request to copy: `/new-story-hunt <hunt id> <N> keys`. Given to Claude Code, the project skill `.claude/skills/new-story-hunt` runs `npm run story:pick` (genre, theme, a lock and a channel per key, least used first; everything earlier stories used), writes the plan, designs, 22+ decoys per key, chapters (`docs/stories/drafts/<date>-<id>/<n>.md`) and picture prompts, then `npm run story:import` checks it free, its map lookups through the live site (`/api/admin/map-check`, with a day pass worked out from the database secret key on both ends; `--map-here` asks from the computer) (shape, every code worked out, no chapter naming a key place, every answer/alias/decoy on the map, decoys ≥ 1 km from the answer) and brings it into the hunt (title, logline, keys at the real places, picture slots, registry row, PDFs). The paid path (`npm run story:new`, `/api/admin/story-step`) stays for later. Tests: `story-hunt-admin-browser-test.mjs`, `story-import-test.mjs` (needs the map search). |
| 31 Oct 2026 | **The admin is only hunt creation** (owner: "so i only see the hunt creation area. There is no need for start on and days. We already know hunts is everyday 9am - 9pm"; "remove make a hunt by hand. we wont need that"). New story hunt asks for keys, prize and winners; one hunt a day (owner: "only 1 hunt per day. Before 9am the next day"): the hunt is for today until 9 am Lagos, then for tomorrow, never further ahead; the form says which day, and once that day has its hunt it closes until 9 am. Removed from /admin: Make a hunt by hand, the Djinn box (the weekly Wager still comes on its own), and the per-key tools on cards (place, trial, trap chest, beat story, Add key). Cards keep Publish, Broadcast, Delete, the story request, Read the story, and the pictures. |
| 31 Oct 2026 | **The story scroll and the trailer** (owner: "we create a reader, something like a scroll that user can always open and close. What will be in the lobby, story trailer, I will create that, and there should be a place for me to upload it"). On the map, a story hunt's hunters get a 📜 tool (it glows until first read): the story on a parchment scroll, chapter by chapter (Prologue, Chapter 1…, Epilogue; a chapter list, Previous/Next; it reopens at the chapter being read), with the owner's pictures spread through each chapter; ✕ or Escape closes it. The chapters open with the hunt; before that the scroll shows the logline and when it opens. `/api/hunt/story` hands a signed-in hunter only the title, logline, chapter titles, settings and text, and the uploaded pictures of a published story hunt, never the answers, decoys or live pieces (hunts stays unreadable to players). The trailer: the owner uploads a video on the hunt's card (🎬, MP4/WebM/MOV up to 50 MB, straight to Storage bucket story-trailers; hunts.trailer_path), and the lobby shows it on the hunt with the story's first picture as its cover. Test: `story-scroll-browser-test.mjs`. |
| 31 Oct 2026 | **Story formula, second go** (owner, on The Lamp-Room Diary: "30 pictures is money… the images will just be used in the trailer… I did not see a voice over"; "it was somehow like work than a thrill"; "you place all the decoys in the same place"; "you talked about clara born in canada, they talked about ifoma in lagos. The story does not tally"; "New story everyday"; keys "could be any, 7, 12, 10, 3"). The Bible now asks for one continuous story (one hero, one day, no flashback chapters), short chapters (~300-word cold open, 600–850 words a chapter), one "aha" per key, 6+ decoys per key that are false trails in the plot (never lists), and a trailer pack instead of illustrations: 3 picture prompts (ChatGPT's 3 a day) + a ~45-second voice-over script with which lines go over which picture (admin: 🎙 Copy script). The scroll is text only; its chapters open through the hunt (the first two at the start, then one every 45 minutes, all within 9 hours), locked ones show their time, the 📜 glows when a new one opens; its text can't be selected, copied or long-pressed (screenshots can't be blocked on the web). Importer: 6+ decoys, warns on chapters over 1,100 words or more than 3 pictures. Sunday 1 Nov: "Twelve Sharp" (7 keys) replaced The Lamp-Room Diary. |
| 31 Oct 2026 | **Each key opens the next chapter** (owner: "only when you obtain the first key, you get the next chapter scroll with the key"). Replaces the timed release: a hunter starts with the opening and chapter 1; every key found opens one more chapter; the last key (or finishing) opens the ending. `/api/hunt/story` counts from hunt_players.keys_held and keeps the furthest reached in hunt_players.story_chapters (it only grows, so a Thief's Hand doesn't close a chapter already read). The key card says "📜 The next chapter has opened on your scroll" (the finish card: the ending), the scroll refreshes on the game's loota:key-earned, locked chapters say "🔒 find Key N", and the 📜 glows until the new chapter is read. |
| 31 Oct 2026 | **Exact story keys** (owner, seeing Galle Fort Hotel, Spa, Restaurant, Lighthouse and Museum in one search: "We should not let player pick any of them. The key location has to be in one, which can be hidden in the story too, that way we create more suspense and thrills"). hunt_keys.exact_m: for a story key only arriving within that radius of the place (or the chest) counts; anywhere else, even the hotel 300 m away, is "wrong place" and a new 15 seconds to answer (key_pulse; keys without exact_m keep the 1.5 km area). The story's answer is one spot (`answer.radius`: 120 m, up to 300 m for a canal or island fortress); decoys must be radius + 100 m away, and the Bible asks for near misses next door that the story rules out. Twelve Sharp: the rock not the town, the lighthouse not the fort (a search for "Galle Fort" lands on the hotel), the cathedral not the quay, the old light not the cape's tip, the Noon Gun not the top of Signal Hill. Test: `exact-key-api-test.mjs`. |
