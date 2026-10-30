# HabbitQuest (prototype)

Picture quests that build good habits, for children aged 3 to 13. Parents choose habits and times, kids tap
**"I did it!"**, parents approve with a PIN, and kids earn a **Spark** and **points** with a sparkle
celebration. Sparks raise the child's level (unlocking harder quests) and open worlds to explore; points buy
real-world rewards. A team of AI helpers (open-weight models on Groq, the same setup as the Wealth Intelligence Copilot) coaches parents, plans routines, reviews the week and
cheers kids on, and every change they suggest waits for a parent's PIN.

## Run it

```bash
npm install
cp .env.example .env   # then add your GROQ_API_KEY from console.groq.com (needed only for the AI helpers)
npm run dev        # http://localhost:5180  (also on your local network, for phones and tablets)
npm test           # rules, rewards, guardrails, retrieval and the coach's tool loop
npm run build      # production build in dist/
```

Fastest demo: open **http://localhost:5180/#/demo**. Demo sign-in is `demo@habbitquest.app` / `demo1234`, and the parent PIN is `1234`.
The demo has a quest and a reward request waiting, a check-in from Alex, a surprise waiting for Alex in kid mode,
and Maya at level 3 wearing a crown. Kid-mode time is limited to 30 minutes a day.

Without an API key everything works except the AI helpers; kids' notes are still screened by the local guardrails.

## Pages

| Route | Page |
|---|---|
| `#/` | Home: how it works, the habits, the worlds, the parent promise |
| `#/register`, `#/login` | Parent account, parent PIN, first child and their buddy; sign in |
| `#/setup` | Routine habits and times (shared by every child) |
| `#/parent` | Dashboard: safety alerts, approvals, reward requests, each child's level, points, streak and app time, kids' check-ins, surprise planner, habit coach, planner, reviewer |
| `#/quests/:child` | Quest library: up to 4 bonus quests per child, by tier (tiers unlock with levels) and age |
| `#/rewards` | Rewards & limits: reward shop prices, kid-mode time limit, screen-time goal, request history |
| `#/kid/:child` | Kid mode: quests with points and boosts, golden quest, level and streak, chest, check-in, surprises |
| `#/shop/:child` | Kid reward shop: spend points, savings goal, mystery box, buddy wardrobe, points history |
| `#/world/:child/:world` | Explore an unlocked world and find hidden treasures |

## Game rules

- **Sparks:** one per quest per day, only when a parent approves. Never taken away.
- **Levels:** Sprout (0 Sparks), Explorer (5), Adventurer (15), Hero (30), Legend (50). Explorer unlocks tier 2 bonus quests, Adventurer tier 3.
- **Points:** tier 1 quests pay 10, tier 2 pay 15, tier 3 pay 20. Multiplier 1x, plus 1x each for the day's **golden quest**, being on day 3+ of a **streak**, and a parent's **surprise double day** (max 3x).
- **Reward shop:** a request holds the points; the parent says yes (PIN) or "not this time" (points refunded). Approved screen-time rewards add minutes to that day's screen-time quest. The **mystery box** gives a random prize, sometimes a 100-point jackpot.
- **Surprises:** finishing every quest opens a **treasure chest** (bonus points or a buddy accessory to collect). Parents can **plant a surprise**: a note with bonus points, or a double-points day.
- **Kid-mode time limit:** kid mode counts time on screen; when today's limit is used up, a break screen appears and only a parent (PIN) can add minutes.
- **Check-ins:** kids tell their grown-ups how today felt (mood faces, tricky and favourite quest pictures, message stickers, an optional note from age 6).
- Worlds: Starter Camp is open from the start, Mosswood Forest unlocks at 5 Sparks and Sky Islands at 20.
- Leaving kid mode, or opening a parent page from it, needs the parent PIN.

## AI helpers

The agents run on a small server inside Vite (`server/`, mounted at `/api/agent` by `npm run dev` and
`npm run preview`), so the API key stays in Node and never reaches the browser. They call Groq's
OpenAI-compatible API (`server/llm.ts`): `openai/gpt-oss-120b` for the coach, planner and reviewer, and the faster
`openai/gpt-oss-20b` for buddy lines and safety checks. JSON answers are validated with Zod and retried once with
a bigger budget.

| Agent | Where | What it does |
|---|---|---|
| Habit coach (RAG) | Dashboard → "Habit coach" | The parent describes a problem in their own words. The coach retrieves parenting guidance and cites it, searches the quest library for that child, and recommends 1-3 bonus quests as cards. The parent ticks the ones they want, or says "too hard" or "something different" to refine. It can also propose routine changes. |
| Quest planner | Dashboard → "Suggest a plan" | Suggests routine habits and times from ages, history and check-ins |
| Weekly reviewer | Dashboard → "Write this week's review" | Per child: a win and a thing to watch, patterns, at most 2 changes |
| Kid buddy | Kid mode | One short line of encouragement: hello, after "I did it!", and in the celebration |

**Retrieval (RAG):** `server/knowledge.ts` holds short guidance articles (sleep, screens, tantrums, mealtimes,
homework, chores, hygiene, motivation, building habits, when to get help). `server/rag.ts` indexes them with
BM25 (one chunk per section, light stemming, parent-language synonyms). Each passage has a short ref (G1, G2...);
the coach cites them inline as [G12], and the chat shows the matching titles as sources under each reply. The same search ranks the quest library,
filtered to the child's age and unlocked tiers. To add knowledge, append an article to `KNOWLEDGE`.

## Safety and guardrails

HabbitQuest is for children aged 3 to 13, so safety is layered:

1. **Agents only suggest.** Proposals and recommendations are cards a parent approves with the PIN. No agent can change Sparks, points or approvals.
2. **Output checks for parents' cards.** Recommendations must be real library quests that fit the child's age and unlocked tier (checked on the server and again in the browser). Routine changes are validated against the habit catalog.
3. **Text kids read** (buddy lines) passes a local word and pattern check and then an AI safety classifier (`server/guardrails.ts`). If it fails or can't be checked, a safe built-in line is shown instead.
4. **Text kids write** (check-in notes): personal info (phone numbers, emails, addresses, links) and explicit, violent, unkind or unsafe content are blocked with a friendly "try saying it another way". **Signs a child may be unsafe or self-harming are never silently dropped.** The note is saved, the parent sees an alert on the dashboard, flagged notes are kept away from the AI, and the child sees a gentle "talk to a grown-up you trust" message. Ages 3 to 5 use stickers only.
5. **Parent messages:** if a message suggests a child may be at risk, the coach gets a safety instruction to lead with emergency and helpline guidance, and the dashboard shows the same guidance.
6. **Privacy:** agents see first names, ages, levels, quests, 14 days of statuses and check-ins, never email, password or PIN hashes. Parents' surprise messages and reward names get the local check too, because kids read them.
7. The coach's prompt rules out diagnosis, physical punishment, shaming, withholding food or sleep, and taking earned rewards away.

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
                store.tsx (state, accounts, PIN, demo), storage.ts, router.ts, auth.ts, time.ts, testing.ts, *.test.ts
  components/   AiHelpers (coach, planner, reviewer), ParentPanels (alerts, requests, check-ins, surprises),
                KidExtras (playtime, chest, surprise, check-in, level badge, wardrobe), Buddy (with accessories),
                HabitArt, WorldArt, Clock, Spark, Celebration, PinDialog, Headers, Logo
  pages/        Home, Auth, HabitSetup, ParentDashboard, QuestLibrary, RewardsPage, Kid, KidShop
  styles.css    design system: tokens, components, responsive rules
```

## Prototype limits (before publishing)

- Data is saved in this browser only (localStorage). Accounts don't sync across devices, and kid-mode time is counted per device.
- Passwords and PINs are SHA-256 hashed locally. This is not real authentication; use a proper auth service (for example Supabase Auth).
- The agent API has no sign-in of its own. Anyone who can reach the dev server (it listens on your local
  network for phone demos) can use it, and your API key pays for it. Put it behind real auth before publishing.
- The AI helpers send children's first names, ages, quest history and check-ins to Groq. Tell parents
  this in the privacy policy before launch, and review the requirements for children's data in your markets (for example COPPA and GDPR-K).
- The knowledge base is general guidance written for this prototype. Have it reviewed by a qualified professional before launch.
- `npm run build` alone produces a static site with no agent API. To host the agents, run `npm run preview`
  or move `createAgentHandler` (server/agents.ts) into your own Node server or serverless function.
