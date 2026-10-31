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

Optional: `GROQ_API_KEY` in `.env` powers buddy lines and check-in moderation; without it the built-in fallbacks apply.

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

The coach now lives on the backend ("Describe a problem"). A small server inside Vite (`server/`, mounted at
`/api/agent` by `npm run dev` and `npm run preview`) still serves the two helpers below when `GROQ_API_KEY` is
set, so the key stays in Node and never reaches the browser.

| Agent | Where | What it does |
|---|---|---|
| Kid buddy | Kid mode | One short line of encouragement: hello, after "I did it!", and in the celebration |
| Note moderation | Kid check-ins | An AI safety check on top of the local guardrails |

The server's coach, planner, reviewer and retrieval code (`server/agents.ts`, `rag.ts`, `knowledge.ts`) and the proposal
helpers in `src/lib/agents.ts` are no longer used by the app.

## Safety and guardrails

HabbitQuest is for children aged 3 to 13, so safety is layered:

1. **Only a parent changes the plan.** Suggestions from the backend are options; nothing is saved until a parent picks and confirms with the PIN.
2. **Goals and quests come from a pre-approved catalog** on the backend, filtered to the child's age and unlocked tier.
3. **Text kids read** (buddy lines) passes a local word and pattern check and then an AI safety classifier (`server/guardrails.ts`). If it fails or can't be checked, a safe built-in line is shown instead.
4. **Text kids write** (check-in notes): personal info (phone numbers, emails, addresses, links) and explicit, violent, unkind or unsafe content are blocked with a friendly "try saying it another way". **Signs a child may be unsafe or self-harming are never silently dropped.** The note is saved, the parent sees an alert on the dashboard, flagged notes are kept away from the AI, and the child sees a gentle "talk to a grown-up you trust" message. Ages 3 to 5 use stickers only.
5. **Parent messages:** if a described problem suggests a child may be at risk, the backend saves nothing and returns guidance, which the dashboard shows on its own.
6. **Privacy:** buddy lines see a first name, age, Sparks and quest titles. Parents' surprise messages and reward names get the local check too, because kids read them.
The word lists in `src/lib/guardrails.ts` are deliberately conservative, not exhaustive. The AI classifier
covers context and wording that lists miss.

## Code layout

```
server/         agents.ts (agents, prompts, coach tools, HTTP handler), llm.ts (Groq client, JSON answers), rag.ts (BM25 retrieval),
                knowledge.ts (guidance articles), guardrails.ts (AI safety classifier), plugin.ts (mounts it in Vite),
                agents.test.ts (retrieval, coach tools and loop with a scripted fake client)
src/
  lib/          family.ts (data model, quests, points, streaks, levels), habits.ts (routine + bonus quest library),
                rewards.ts (shop, mystery box, chest, accessories, surprises), playtime.ts (kid-mode time limit),
                feedback.ts (kid check-ins), guardrails.ts (local safety checks), agents.ts (agent context,
                proposals, recommendations), agentClient.ts (browser calls to /api/agent), migrate.ts (older saved data),
                api.ts (typed backend client), sync.ts (mirrors the server's day locally), plan.ts (building a plan),
                useKidDay.ts (kid session and today), store.tsx (state, sign-in, PIN), storage.ts, router.ts, auth.ts, time.ts, testing.ts, *.test.ts
  components/   AiHelpers (describe a problem), PlanEditor, ChildForm, GoogleButton, ParentPanels (alerts, requests, check-ins, surprises),
                KidExtras (playtime, chest, surprise, check-in, level badge, wardrobe), Buddy (with accessories),
                HabitArt, WorldArt, Clock, Spark, Celebration, PinDialog, Headers, Logo
  pages/        Home, Auth, HabitSetup, ParentDashboard, QuestLibrary, RewardsPage, Kid, KidShop
  styles.css    design system: tokens, components, responsive rules
```

## Prototype limits (before publishing)

- Browser-only extras (bonus points, chests, surprises, check-ins, streaks and the week chart, shop prices, kid-mode time) don't sync across devices or caregivers.
- The agent API has no sign-in of its own. Anyone who can reach the dev server (it listens on your local
  network for phone demos) can use it, and your API key pays for it. Put it behind real auth before publishing.
- Buddy lines and check-in moderation send children's first names, ages, quest titles and notes to Groq. Tell parents
  this in the privacy policy before launch, and review the requirements for children's data in your markets (for example COPPA and GDPR-K).
- The knowledge base is general guidance written for this prototype. Have it reviewed by a qualified professional before launch.
- `npm run build` alone produces a static site with no agent API. To host the agents, run `npm run preview`
  or move `createAgentHandler` (server/agents.ts) into your own Node server or serverless function.
