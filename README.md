# HabbitQuest (prototype)

Picture quests that build good habits, for children aged 3 to 13. Parents choose habits and times, kids tap
**"I did it!"**, parents approve with a PIN, and kids earn a **Spark** and **points** with a sparkle
celebration. Sparks raise the child's level (unlocking harder quests) and open worlds to explore; points buy
real-world rewards. Parents describe a problem in their own words and get suggested goals and quests.

Accounts, children, plans, the daily loop and points run on the HabitQuest backend API. Worlds, chests, buddy
accessories, check-ins, surprises, boosts and the kid-mode time limit stay in the browser for now.

## Run it

```bash
npm install
cp .env.example .env.local   # API URL, Google client id, VITE_DEV_LOGIN (git-ignored)
npm run dev        # http://localhost:5180  (also on your local network, for phones and tablets)
npm test           # rules, rewards, guardrails, retrieval and the coach's tool loop
npm run build      # production build in dist/
```

Keep the dev server on port 5180: the API and Google only allow that origin. The API sleeps on Render's free plan,
so the first request can take up to a minute; the app shows "Waking up the server…" while it waits.

With `VITE_DEV_LOGIN=true` the sign-in page also offers a development login: `parent`, or `parent:<label>` for a
separate test parent, with the shared password from the backend owner. Never put that password in an env file.


## Pages

| Route | Page |
|---|---|
| `#/` | Home: how it works, the habits, the worlds, the parent promise |
| `#/login` | Google sign-in, plus the development login when enabled |
| `#/welcome` | First-time setup: create or join a family, add the first child |
| `#/setup/:child` | Routine times per child |
| `#/parent` | Dashboard: safety alerts, approvals, reward requests, each child's level, Sparks and points, invite code and caregivers, kids' check-ins, surprise planner, "Describe a problem" |
| `#/quests/:child` | Quest library: a child's plan, up to 6 quests; retime, pause, remove, change goals |
| `#/rewards` | Rewards & limits: record a reward, points history, kid-mode time limit, shop prices |
| `#/kid/:child` | Kid mode: quests with points and boosts, golden quest, level and streak, chest, check-in, surprises |
| `#/shop/:child` | Kid reward shop: ask a grown-up, savings goal, mystery box, buddy wardrobe, points history |
| `#/world/:child/:world` | Explore an unlocked world and find hidden treasures |

## Game rules

- **Sparks:** one per quest per day, only when a parent approves. Never taken away.
- **Levels:** Sprout (0 Sparks), Explorer (5), Adventurer (15), Hero (30), Legend (50). Explorer unlocks tier 2 quests, Adventurer tier 3.
- **Points:** tier 1 quests pay 10, tier 2 pay 15, tier 3 pay 20, on the backend. Only a parent can spend them.
- **Bonus points (this browser only):** boosts (the day's **golden quest**, day 3+ of a **streak**, a parent's **surprise double day**, max 3x) pay the extra as bonus points, as do chests and surprises. They buy **mystery boxes**.
- **Reward shop:** a child asks a grown-up; the parent's yes (PIN) records the reward on the backend. Nothing is held while waiting.
- **Surprises:** finishing every quest opens a **treasure chest** (bonus points or a buddy accessory to collect). Parents can **plant a surprise**: a note with bonus points, or a double-points day.
- **Kid-mode time limit:** kid mode counts time on screen; when today's limit is used up, a break screen appears and only a parent (PIN) can add minutes.
- **Check-ins:** kids tell their grown-ups how today felt (mood faces, tricky and favourite quest pictures, message stickers, an optional note from age 6).
- Worlds: Starter Camp is open from the start, Mosswood Forest unlocks at 5 Sparks and Sky Islands at 20.
- Leaving kid mode, or opening a parent page from it, needs the parent PIN.

## AI helpers

All AI runs on the HabitQuest backend: the habit coach, quest planner, weekly review, buddy lines and note screening.
No API key reaches the browser. Helpers only suggest; a parent accepts each card with the PIN, which the server checks.

## Code layout

```text
src/lib/        api.ts (typed client), store.tsx (app state), sync.ts (mirror of backend data), buddy.ts (buddy lines),
                useKidDay.ts (kid session), family.ts (levels, worlds, celebrations), plan.ts, playtime.ts
src/components/ AiHelpers.tsx, ParentPanels.tsx, KidExtras.tsx and shared pieces
src/pages/      One file per route, including Privacy.tsx
```

The backend repository holds the rules, safety checks and data. The browser keeps only which celebrations it has shown.