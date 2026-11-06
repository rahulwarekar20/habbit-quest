# Frontend integration guide

How to connect the HabitQuest frontend (`rahulwarekar20/habbit-quest`) to this backend: settings, the API
contract (every endpoint and response shape the frontend needs), the screen-by-screen changes and local test
steps. It doubles as the brief for a coding session in the frontend repository. Progress is tracked in
[status.md](status.md); the backend's own docs are in the [README](../README.md).

The `habbit-quest` frontend (React 18 + Vite + TypeScript, hash router, port 5180). Today it
keeps every family in `localStorage` (`src/lib/store.tsx`, `src/lib/storage.ts`) and has its own Groq agent
server (`server/`). Your job: make accounts, children, onboarding, the daily quest loop and points run against
the HabitQuest backend API described below, so the app can be tested locally against the hosted API.

Work on a new git branch (`feat/backend-api`). Keep the existing design system (`src/styles.css`) and
components. Run `npm test` and `npm run build` before you finish, and try the flows in the browser.

## 1. Configuration

Create `.env.local` (git-ignored) and an `.env.example` entry:

```
VITE_API_URL=https://habitquest-api-qmt1.onrender.com
VITE_GOOGLE_CLIENT_ID=589389699921-ol224oo6m4svf9tts3enahorubm4lb1s.apps.googleusercontent.com
VITE_DEV_LOGIN=true
```

- The API is on Render's free plan: the first request after it has been idle can take up to a minute. Show a
  "waking up the server…" state rather than failing fast (use a 70-second timeout on the first call).
- The backend allows browser calls from `http://localhost:5180` (CORS), and the Google client allows the
  origins `http://localhost` and `http://localhost:5180`. Keep the dev server on port 5180.
- `VITE_DEV_LOGIN=true` shows a development login (username + shared password) next to Google sign-in, for
  testing without a Google account. Never put the password in an env file; the tester types it.

## 2. API basics

- Base URL: `VITE_API_URL`. All bodies are JSON (`Content-Type: application/json`) except the dev login.
- Auth: `Authorization: Bearer <token>`. There are two kinds of token:
  - **Caregiver token** (from Google or dev login): for every endpoint except `/v1/kid/*`. Lasts 8 hours (dev
    login: 1 hour). Store it in `localStorage` with its expiry.
  - **Kid token** (from `POST /v1/children/{id}/kid-session`): only for `/v1/kid/*`. Lasts 8 hours. Store it in
    `sessionStorage` (per tab, like today's kid mode).
- Errors: `{"detail": "message"}`, or for invalid input (422 from validation) `{"detail": [{"msg": ..., "loc": [...]}]}`.
  401 means the token is missing or expired: send the user to sign in again (or, in kid mode, to the parent PIN).
  404 also means "not yours". Show `detail` strings to the user; they are written for people.
- The frontend's typed client is `frontend/src/lib/api/`: `client.ts` holds the request helper (tokens, errors,
  waking the server), `types.ts` the response shapes, and one file per area has one function per endpoint below.

## 3. Endpoints and shapes

### Sign-in
- **Google**: load `https://accounts.google.com/gsi/client`, call
  `google.accounts.id.initialize({client_id: VITE_GOOGLE_CLIENT_ID, callback})` and `renderButton`. In the
  callback, `POST /v1/auth/google {credential: response.credential}` →
  `{access_token, token_type: "bearer", expires_in: 28800}`.
- **Dev login** (only when `VITE_DEV_LOGIN=true`): `POST /v1/auth/token` as
  `application/x-www-form-urlencoded` with `username` (`parent`, or `parent:<any label>` for a separate test
  parent) and `password` → same shape, `expires_in: 3600`.
- `GET /v1/me` → `{id, name, email, families: [{id, name, display_name, role}]}`. Empty `families` → show
  family setup.

### Family
- `POST /v1/families {name, timezone, pin, display_name, role}` → 201 Family. `timezone` is IANA (use
  `Intl.DateTimeFormat().resolvedOptions().timeZone`); `pin` is exactly 4 digits, or left out for a family
  without a parent PIN; `role` is `father | mother | guardian | other`.
- Family = `{id, name, timezone, invite_code, has_pin, created_at, caregivers: [{user_id, display_name, role}]}`.
- `POST /v1/families/join {invite_code, display_name, role}` → Family. 404 unknown code, 409 already a member.
- `GET /v1/families/{id}`, `PATCH /v1/families/{id} {name?, timezone?}`,
  `PATCH /v1/families/{id}/caregivers/me {display_name?, role?}`,
  `POST /v1/families/{id}/invite-code` (new code) → Family.
- `PUT /v1/families/{id}/pin {pin, current_pin?}` → 204 (sets, changes or turns on the PIN; replacing a PIN needs `current_pin`, 403 if missing or wrong). `POST /v1/families/{id}/pin/verify
  {pin}` → `{valid: boolean}`. Use verify wherever the app asks for the parent PIN today (leaving kid mode,
  grown-up pages). The PIN is no longer hashed in the browser.
- The parent PIN is optional. `POST /v1/families/{id}/pin/remove {pin}` → 204 turns it off (403 wrong PIN). While
  `has_pin` is false, skip the PIN prompt and leave `pin` out of every request that takes one (approving a
  reward, accepting a suggestion, more app time, deleting a child or the family); verify answers `{valid: true}`.

### Children
- `POST /v1/families/{familyId}/children {name, age, buddy, routine_times}` → 201 Child.
  - `age` 3-13; `buddy` `fox | owl | bear | bunny`, which also themes kid mode;
    `routine_times`: `{morning?, midday?, after_school?, evening?, bedtime?}` as 24-hour `"HH:MM"`.
- Child = `{id, family_id, name, age, buddy, world, tier_override, routine_times, created_at}`. `world` is the world
  the child has reached, set by the server. `PATCH` takes `tier_override`: the highest quest tier to allow, 0 to follow
  the child's world.
- `GET /v1/families/{familyId}/children` → Child[]; `GET /v1/children/{id}`; `PATCH /v1/children/{id}` (any
  field; `routine_times` replaces the whole object).

### Onboarding: pain points → goals → habits
- `POST /v1/children/{id}/pain-points {text}` (5-2000 chars, the parent's own words). AI maps it to 1-3
  pre-approved goals with a reason and recommends up to 2 habits per goal.
  - 201 → `{pain_point: {id, text, mapped_by, created_at}, safety: null, plan: Plan}`. `mapped_by` is `ai`,
    `keywords` (AI unavailable; no recommendations) or `manual` (nothing matched: let the parent pick goals
    from `GET /v1/goals`).
  - 200 → `{pain_point: null, safety: {guidance}, plan: null}` when the text suggests a child may be at risk.
    Show `guidance` prominently and nothing else.
- Plan = `{child_id, progress, goals: PlanGoal[], habits: PlanHabit[]}`
  - progress = `{sparks, pending_sparks, level, level_name, world, unlocked_tier, next_level_at, next_landmark}`. A
    quest earns its tier in Sparks, at most 6 a day. Levels are worlds: Starter Camp 0, Mosswood Forest 30 (tier 2),
    Sky Islands 90 (tier 3), Coral Cove 180, Crystal Caves 300, Star Harbour 450. `next_level_at` is null at the top.
  - `GET /v1/kid/journey` and `GET /v1/children/{id}/journey` → `{progress, worlds, discoveries, quest_stars}`. `worlds`
    lists each world's landmarks with the Sparks they need and their place on the scene. `PATCH /v1/kid/extras` takes
    `discover` (409 until the child has the Sparks) and `buddy`. `quest_stars` give each quest's `targets`: 5, 15 and
    30 approvals, or 3, 8 and 15 for a quest done on fewer than 3 days a week.
  - Streaks, the streak bonus and the welcome back count quest days only. A day with no scheduled quests is a rest day:
    today's view then has `rest_day: true` and `next_quest_day`.
  - PlanGoal = `{goal_id, title, status: "suggested" | "active", reason, recommended_habit_ids, options: Option[]}`,
    Option = `{id, goal_id, title, description, kid_title, kid_hint, icon, anchor, tier, points, recommended}`.
    `options` are already filtered to the child's age and unlocked tier.
  - PlanHabit = `{id, habit_id, goal_id, title, description, kid_title, kid_hint, icon, anchor, tier, points,
    cue_time: "HH:MM", days: ["mon",...], status: "active" | "paused", started_on}`. `id` is the child-habit id.
- `GET /v1/children/{id}/plan` → Plan.
- `PUT /v1/children/{id}/plan {goals: string[], habits: [{habit_id, cue_time?, days?}]}` → Plan. At most 6
  habits; each must belong to a listed goal. Times default to the child's routine time, days to every day.
  Unlisted goals are dropped and unlisted habits removed. 422 `detail` explains a refusal. Use it for the first
  plan and for later changes.
- `PATCH /v1/child-habits/{childHabitId} {cue_time?, days?, status?: "active" | "paused" | "removed"}` → Plan.
- Catalog: `GET /v1/goals` → `[{id, title, description}]`; `GET /v1/goals/{id}/habits?age=&max_tier=`.
- Whole catalog: `GET /v1/catalog` → every pre-approved habit with `goal_title`, `min_age`, `max_age`, `tier`,
  `points`, `kid_title`, `icon`, ordered by goal, tier and title. The Quest library groups it by age (3-5, 6-8, 9-13).
- Custom habits (a family's own): `GET /v1/families/{id}/habits`; `POST /v1/families/{id}/habits {goal_id, title,
  kid_title?, description?, kid_hint?, icon, anchor}` → 201 habit with an id starting `my-` (every age, tier 1,
  10 points); `PUT /v1/habits/{id}` edits; `DELETE /v1/habits/{id}` retires it and takes it out of every plan.
  422 for an unknown goal or text unsuitable for kids, 409 past 30 per family. Add one to a child with
  `PUT /v1/children/{id}/plan`, listing its goal. Custom habits show their own `icon`; they never reach the AI.

### Kid mode and the daily loop
- `POST /v1/children/{id}/kid-session [{pin}]` (caregiver token) → `{access_token, token_type, expires_in, child: {id, name}}`.
  When the child has a kid PIN (`has_pin` on the child), `pin` is required: 403 when missing or wrong.
- Kid login (a child's own device): `POST /v1/families/{id}/login-code` (caregiver) makes or replaces the family's
  `login_code`, shared as a QR code to `#/join/<code>`; `PUT` / `DELETE /v1/children/{id}/kid-pin {pin}` sets or
  removes the child's PIN. Without any token, `GET /v1/kid-login/{code}` → `{family: {id, name}, children:
  [{id, name, buddy, has_pin}]}` and `POST /v1/kid-login/{code} {child_id, pin}` → kid token plus `child` and
  `family`. 404 unknown code or child, 409 no PIN yet, 403 wrong PIN, 429 too many tries.
- `GET /v1/kid/me` (kid token) → `{id, name, age, buddy, world}`.
- `GET /v1/kid/today` (kid token) or `GET /v1/children/{id}/today` (caregiver) → Today =
  `{child: {id, name, buddy, world}, day: "YYYY-MM-DD", progress, points, habits: TodayHabit[]}`,
  TodayHabit = `{child_habit_id, habit_id, kid_title, kid_hint, icon, anchor, tier, points, cue_time,
  status: "todo" | "submitted" | "approved" | "rejected", completion_id}`. "Today" is in the family's time zone.
- `POST /v1/kid/completions {child_habit_id}` (kid token) → Today. "I did it!". A repeat tap is harmless; a
  `rejected` habit can be submitted again; 409 if already approved.
- `GET /v1/families/{familyId}/approvals` → `[{completion_id, child_id, child_name, habit_id, title, kid_title,
  icon, points, day, submitted_at}]`, oldest first.
- `POST /v1/completions/{id}/approve` / `.../reject` → `{completion: {id, status, day, submitted_at, decided_at},
  child_id, progress, points}`. Approve gives Sparks equal to the habit's tier (up to the daily cap) and the habit's points; reaching gold on a quest
  (30 approvals) adds a `mastery` suggestion; compare `progress.level` with the
  previous value to trigger the level-up celebration. 409 if already decided.

### Points
- `POST /v1/children/{id}/redemptions {points, note}` (caregiver) → 201 `{entry, points}`; 422
  `"Not enough points: N available"`. Sparks are never spent.
- `GET /v1/children/{id}/points?limit=50` (caregiver) and `GET /v1/kid/points` (kid) →
  `{points, earned, spent, entries: [{id, amount, reason: "earned" | "redeemed" | "adjusted", note, created_at,
  habit_id, kid_title, icon, completion_day, by?}]}` (`by` = caregiver display name, caregiver view only).

### AI helpers, rewards, check-ins and extras

`/docs` and `/openapi.json` have every shape. In short:

- Coach: `GET`, `POST`, `DELETE /v1/children/{id}/coach/messages`. Suggestions: `GET /v1/families/{id}/suggestions`,
  `POST /v1/suggestions/{id}/accept` with `{pin}`, `POST /v1/suggestions/{id}/dismiss`. The thread carries
  `plan_full`: when the child already has 6 habits, the coach gives tips without new-habit cards, so show
  "already has 6 quests" rather than the `no_habit_match` warning. A coach message's `covered_by` lists the titles
  of quests already in the plan that suit the problem, when the reply offered no new one; show "already has quests
  for this" instead of the warning.
- `POST /v1/families/{id}/plan-suggestions`, `POST /v1/families/{id}/reviews`, `GET /v1/families/{id}/reports`,
  `POST /v1/kid/buddy-line`.
- Rewards: `/v1/families/{id}/rewards`, `/v1/rewards/{id}`, `/v1/kid/rewards`, `/v1/kid/reward-requests`,
  `/v1/families/{id}/reward-requests`, `/v1/reward-requests/{id}/approve` (`{pin}`) and `/decline`.
- Check-ins and surprises: `/v1/kid/checkins`, `/v1/kid/checkins/today`, `/v1/families/{id}/checkins` and `/read`,
  `/v1/families/{id}/surprises`, `/v1/kid/surprises`, `/v1/kid/surprises/{id}/open`.
- Extras: `/v1/kid/extras`, `/v1/kid/chest`, `/v1/kid/app-time`, `/v1/children/{id}/extras`,
  `/v1/children/{id}/app-time/extend`, `/v1/families/{id}/settings`.
- Data: `GET /v1/families/{id}/export`, `POST /v1/families/{id}/delete` and `POST /v1/children/{id}/delete` (`{pin}`),
  `DELETE /v1/families/{id}/caregivers/me`.
- `today` also returns `streak`, `week`, and each habit's `boosts` and `multiplier`. Worlds are `camp`, `mosswood`, `sky`, `coral`, `crystal`, `star`.
## 4. How the screens map

What each screen calls today. Every endpoint has a function of the same purpose in `frontend/src/lib/api/`.

| Screen | Endpoints |
|---|---|
| Sign-in (`#/login`) | Google button → `POST /v1/auth/google` (or the dev login, `POST /v1/auth/token`), then `GET /v1/me`. "I'm a kid" → `GET` and `POST /v1/kid-login/{code}` |
| First-time setup (`#/welcome`) | `POST /v1/families` (optional PIN) or `POST /v1/families/join`; then `POST /v1/families/{id}/children` |
| Join (`#/join/:code`) | The family code from a QR code: kid sign-in as above, or a grown-up joins |
| Child details (`#/setup/:child`) | `PATCH /v1/children/{id}` (name, age, buddy, routine times) |
| Dashboard (`#/parent`) | `GET /approvals`, `approve` / `reject`; reward requests; each child's `today`; check-ins and safety alerts; surprises; suggestions, reviews and the quest planner |
| Habit coach (`#/coach/:child`) | `GET` and `POST /v1/children/{id}/coach/messages`; cards from `GET /suggestions`, `accept` (PIN if set) or `dismiss` |
| Quest library (`#/quests/:child`) | `GET` and `PUT plan`; `PATCH child-habits`; `GET /v1/catalog` for Add quests; custom habits under `/v1/families/{id}/habits` |
| Rewards & limits (`#/rewards`) | The shop under `/v1/families/{id}/rewards`; `POST redemptions`; `GET /points`; family `settings` for the time limit |
| Family settings (`#/family`) | Login code, invite code, PIN (`PUT`, `remove`), kid PINs, `export`, `delete`, leaving the family |
| Kid mode (`#/kid`, `#/kid/:child`) | `kid-session`, then with the kid token: `today`, `completions`, `journey`, `extras`, `chest`, `app-time`, `checkins`, `buddy-line`. Leaving kid mode: `pin/verify` |
| Kid shop and journal (`#/shop/:child`, `#/journal/:child`) | `GET /v1/kid/rewards`, `POST /v1/kid/reward-requests` (points held until a grown-up decides), `GET /v1/kid/points`, `PATCH /v1/kid/extras` for the wardrobe |

Nothing is kept only in the browser any more except its sign-in and which celebrations it has shown.

Habit ids from the frontend's library are the same in the backend catalog (`wake`, `bedtime`, `brush-teeth`,
`story-time`, `make-bed`, …), with two additions: `tidy-space` and `day-chat`. Ages, buddies and the level
thresholds match the frontend.

## 5. Test it locally

1. `npm install`, then `npm run dev` and open http://localhost:5180.
2. Sign in (Google, or dev login as `parent` with the shared password the backend owner gives you).
3. Create a family, add a child, describe a problem ("bedtime is a battle and he wants more tablet"), pick
   habits, save the plan.
4. Start kid mode for the child, tap "I did it!", leave kid mode with the PIN, approve on the dashboard, and see
   Sparks and points go up.
5. Sign in as `parent:test2` in another browser, join with the invite code, and check that both caregivers see
   the same children.

Finish with `npm test` and `npm run build` passing, and summarise what changed and anything left in the browser.
