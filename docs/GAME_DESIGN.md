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
- **Train:** the same, using real stations and lines where the data exists.
- **Plane:** travel to a real airport → book a ticket (price by distance) → check in **before the deadline** (late means a rebooking fee) → board → fly along the great-circle path → land → leave the airport.
- **Vehicle at the airport:** owned vehicles must be parked (daily fee) or left behind; rentals are returned. Owned vehicles stay where they were parked and must be collected later.

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

---

## 8. Things to do along the route

### 8.1 Road events

| Event | Applies to | Player choice |
|---|---|---|
| Traffic jam | Car, bus | Wait, or take a side road (longer, but moving) |
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

### 10.2 What coins are spent on

Rentals, fares, plane tickets, fuel, food, maintenance, towing, hospital bills, parking, add-ons, vehicle purchases, hints that narrow the "Cold" band, and cosmetics.

### 10.3 Vehicles

- **Bought once, kept across hunts.** They are expensive to start with.
- They need **maintenance** to keep working, and they can break down, needing towing and the garage.
- **Add-ons** matter at police checkpoints.
- They **stay where they were left.** A bicycle parked at Heathrow is still at Heathrow.

**Built (v1, 13 Oct 2026).** Prices are first guesses to tune once real players are spending:

| | Buy | Rent | Fuel |
|---|---|---|---|
| Bicycle | 600 coins | 4 coins a minute | None (uses your energy) |
| Motorbike | 2,500 coins | 10 coins a minute | 0.8% a km |
| Car | 8,000 coins | 20 coins a minute | 1.2% a km |

- **Renting** is charged per started minute until you get off. The first minute is paid up front. A rental left running with no sign of the player for 3 minutes is ended and charged by the server.
- **Owned vehicles** are bought once and parked where you get off, with a green "YOUR MOTORBIKE" tag on the map. To ride one you must be within 30 m of it; the game walks you there.
- **Fuel** costs 2 coins per 1%. The Refuel button appears only within 40 m of a real petrol station on the map. Rentals come fuelled. An owned motorbike or car with an empty tank can only be pushed, at walking pace.
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
| 13 Oct 2026 | **Look around and search places.** Dragging the map no longer slides it away: sideways turns the view around the hunter, up or down tilts it, and moving off swings the camera back behind them (pinch still zooms). "Go to a place" has a search box for places and addresses (OpenStreetMap search via Photon, Nominatim as backup, through our own /api/geocode); picking a result plots the route and the hunter travels it, with distance and rough time. Nearby places on loaded roads are routed instantly by the game; farther ones use the routing service (12 s limit). |
| 13 Oct 2026 | **Junctions rebuilt where map tiles lost them.** Map tiles simplify roads and sometimes drop the point two roads share, so the roads cross without meeting and there is no turn. The game now puts a junction wherever two roads at the same level cross (bridges and tunnels excluded) and merges junction points drawn a metre apart. Swept five Lagos areas: 3,608 of 3,611 possible turns work (about 1 in 4 turns were missing before). Google Maps was considered and rejected: it gives apps no road-junction data (its Roads API only snaps GPS points, is paid, and its terms restrict reuse). Long term, build the roads from our own copy of raw OpenStreetMap data for Nigeria (exact junctions, names, one-way streets), refreshed monthly. |
| 13 Oct 2026 | **Street label:** a small label at the bottom shows the street the hunter is on, from OpenStreetMap names ("Unnamed road" where the street has no name yet). Junction turns also work when standing on the junction. |
| 13 Oct 2026 | **Turning fixed:** ← or → takes any road leaving on that side (not only near-square turns), and a turn pressed up to 30 m after passing a junction goes back and takes it. Movement instructions are no longer shown on screen (a small ? button explains the controls); game messages fade after a few seconds. Starting zoom is now 20.5 on desktop too. |
| 13 Oct 2026 | **Hunts v1 built** using the section 6.2 proposal. A riddle points to an area. The player presses **Search here**: far away gives "Cold" with a distance band; inside the area gives the Final Approach clue and hot/cold bands; within 40 m of the spot starts the Key Trial. Trial categories: mental maths and number sequences (made fresh every time), general knowledge and "Know Nigeria" (question bank). Later keys get harder questions. A wrong answer or timeout throws the player 2 km away (a trial left running counts as a timeout). The first N players to collect every key win. The owner creates and publishes hunts at /admin by pasting Google Maps coordinates; key spots snap to the nearest road. A 3-key practice hunt (airport → National Theatre → Tafawa Balewa Square) is live for testing. |
| 13 Oct 2026 | **Economy v1 built:** rent or buy a bicycle, motorbike or car; fuel; meals at real restaurants; owned vehicles stay parked (see 10.3). Wear, breakdowns, parking fees, add-ons and public transport come later in phase 3. |

## 16. Open questions

1. **Section 6.2:** is the area riddle → Final Approach → Key Trial flow right?
2. **Section 10.5:** do the hunt tiers match how you want to schedule prizes?
