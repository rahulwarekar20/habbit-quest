/**
 * A fake HabitQuest API for screen tests: it replaces `fetch` and answers like the backend, from a small
 * family kept in memory. It keeps enough state that one screen's change shows on another: a kid's "I did it!"
 * puts the quest in the parent's approvals, approving it marks it done in kid mode, and saving a plan changes
 * today's quests.
 *
 * Every response is typed with the API's own types, so a change to a response shape breaks these fixtures at
 * compile time (`npm run build` type-checks them). Requests the fake doesn't know are answered 404 and listed in
 * `unhandled`, and every request is kept in `calls` so tests can check what the app sent.
 */
import { vi } from "vitest";
import type {
  ApiChild, ApiFamily, Approval, CatalogHabit, Decision, Extras, Goal, HabitStatus, Journey, Me, Plan, PlanHabit,
  Progress, Today, TokenResponse,
} from "../lib/api";

/** One request the app sent. `body` is the parsed JSON, or the form fields for the dev login. */
export interface Call { method: string; path: string; body: unknown }

/** The password the fake's development login accepts. */
export const DEV_PASSWORD = "test-password";
/** The family PIN, when the fake family has one. */
export const PIN = "1234";

export const GOALS: Goal[] = [
  { id: "mornings", title: "Smoother mornings", description: "Getting up and ready without a fuss" },
  { id: "bedtime", title: "Calmer bedtimes", description: "Winding down for sleep" },
];

const habit = (id: string, goal_id: string, title: string, kid_title: string, icon: string, anchor: CatalogHabit["anchor"], tier = 1): CatalogHabit => ({
  id, goal_id, goal_title: GOALS.find((g) => g.id === goal_id)!.title, title, description: `${title}, every day`,
  kid_title, kid_hint: "You can do it!", icon, anchor, min_age: 3, max_age: 13, tier, points: 5 + 5 * tier,
});

export const CATALOG: CatalogHabit[] = [
  habit("wake", "mornings", "Wake up on time", "Rise and shine", "⏰", "morning"),
  habit("brush-teeth", "mornings", "Brush teeth", "Sparkly teeth", "🪥", "morning"),
  habit("bedtime", "bedtime", "In bed on time", "Off to bed", "🛏️", "bedtime"),
  habit("story-time", "bedtime", "Read before bed", "Story time", "📖", "bedtime"),
];

const progress = (sparks: number): Progress => ({
  sparks, pending_sparks: 0, level: sparks >= 30 ? 2 : 1, level_name: sparks >= 30 ? "Forest Explorer" : "Camp Sprout",
  world: sparks >= 30 ? "mosswood" : "camp", unlocked_tier: sparks >= 30 ? 2 : 1, next_level_at: sparks >= 30 ? 90 : 30,
  next_landmark: null,
});

const extras = (): Extras => ({
  app_limit: 0, buddy_talk: true, discoveries: [], accessories: [], wearing: null, goal: null, chests: [], level_seen: 1,
  app_seconds: {}, app_extra_minutes: {}, screen_bonus: {},
});

const DAY = new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();

/** What the fake remembers. Tests may read or change it directly to set up a scene. */
export interface FakeState {
  me: Me;
  family: ApiFamily | null;
  pin: string | null;
  children: ApiChild[];
  plans: Record<string, PlanHabit[]>; // child id -> current quests
  status: Record<string, HabitStatus>; // child-habit id -> today's status
  sparks: Record<string, number>;
  points: Record<string, number>;
}

/** A signed-in parent with a family, one child (Alex, 8) and two morning quests, unless `empty`. */
export function defaultState({ empty = false, pin = PIN as string | null } = {}): FakeState {
  const me: Me = { id: "u1", name: "Pat", email: "pat@example.com", families: [] };
  if (empty) return { me, family: null, pin: null, children: [], plans: {}, status: {}, sparks: {}, points: {} };
  const family: ApiFamily = {
    id: "f1", name: "The Testers", timezone: "Europe/London", invite_code: "INVITE22", login_code: "KIDCODE1",
    has_pin: pin !== null, created_at: NOW, caregivers: [{ user_id: "u1", display_name: "Pat", role: "mother" }],
  };
  me.families = [{ id: "f1", name: family.name, display_name: "Pat", role: "mother" }];
  const alex: ApiChild = {
    id: "c1", family_id: "f1", name: "Alex", age: 8, buddy: "fox", world: "camp", tier_override: 0,
    routine_times: { morning: "07:00", bedtime: "19:30" }, has_pin: false, created_at: NOW,
  };
  return {
    me, family, pin, children: [alex],
    plans: { c1: [planHabit("c1", "wake", "07:00"), planHabit("c1", "brush-teeth", "07:15")] },
    status: {}, sparks: { c1: 4 }, points: { c1: 40 },
  };
}

function planHabit(childId: string, habitId: string, cue_time: string): PlanHabit {
  const { id, goal_title: _goal, min_age: _min, max_age: _max, ...text } = CATALOG.find((h) => h.id === habitId)!;
  return { ...text, id: `${childId}-${id}`, habit_id: id, cue_time, days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], status: "active", started_on: DAY };
}

/** The fake API. Install it with `startFakeServer()`; `on` adds or replaces a route for one test. */
export interface FakeServer {
  state: FakeState;
  calls: Call[];
  unhandled: string[];
  /** Calls whose method and path match, e.g. `sent("POST", /approve$/)`. */
  sent: (method: string, path: RegExp) => Call[];
  on: (method: string, path: RegExp, handler: Handler) => void;
}

type Reply = { status?: number; body?: unknown };
type Handler = (match: RegExpMatchArray, body: unknown, token: string | null) => Reply | unknown;

const ok = (body: unknown): Reply => ({ status: 200, body });
const created = (body: unknown): Reply => ({ status: 201, body });
const refuse = (status: number, detail: string): Reply => ({ status, body: { detail } });
let active: FakeServer | null = null;

/** The fake installed by the current test, if any. */
export const activeServer = (): FakeServer | null => active;

/** Forgets the current test's fake (the screen test helper calls this after every test). */
export function stopFakeServer(): void {
  active = null;
}

const isReply = (r: unknown): r is Reply => typeof r === "object" && r !== null && ("status" in r || "body" in r) && Object.keys(r).every((k) => k === "status" || k === "body");

/** Replaces `fetch` with the fake API for the current test. */
export function startFakeServer(state: FakeState = defaultState()): FakeServer {
  const calls: Call[] = [];
  const unhandled: string[] = [];
  const s = state;
  const child = (id: string) => s.children.find((c) => c.id === id);
  const kidChild = (token: string | null) => token?.startsWith("kid:") ? token.slice(4) : null;

  const today = (childId: string): Today => {
    const c = child(childId)!;
    return {
      child: { id: c.id, name: c.name, buddy: c.buddy, world: c.world }, day: DAY, welcome_back: false, rest_day: false,
      next_quest_day: null, progress: progress(s.sparks[c.id] ?? 0), points: s.points[c.id] ?? 0, streak: 0, week: {},
      habits: (s.plans[c.id] ?? []).filter((h) => h.status === "active").map((h) => ({
        child_habit_id: h.id, habit_id: h.habit_id, kid_title: h.kid_title, kid_hint: h.kid_hint, icon: h.icon,
        anchor: h.anchor, tier: h.tier, points: h.points, cue_time: h.cue_time, status: s.status[h.id] ?? "todo",
        completion_id: s.status[h.id] ? `done-${h.id}` : null, boosts: [], multiplier: 1, stars: 0,
      })),
    };
  };
  const plan = (childId: string): Plan => {
    const habits = s.plans[childId] ?? [];
    const goals = GOALS.filter((g) => habits.some((h) => h.goal_id === g.id));
    return {
      child_id: childId, progress: progress(s.sparks[childId] ?? 0), habits,
      goals: goals.map((g) => ({
        goal_id: g.id, title: g.title, status: "active", reason: null, recommended_habit_ids: [],
        options: CATALOG.filter((h) => h.goal_id === g.id).map(({ goal_title: _t, min_age: _a, max_age: _b, ...o }) => o),
      })),
    };
  };
  const approvals = (): Approval[] => s.children.flatMap((c) => (s.plans[c.id] ?? [])
    .filter((h) => s.status[h.id] === "submitted")
    .map((h) => ({
      completion_id: `done-${h.id}`, child_id: c.id, child_name: c.name, habit_id: h.habit_id, title: h.title,
      kid_title: h.kid_title, icon: h.icon, points: h.points, day: DAY, submitted_at: NOW,
    })));
  const decide = (completionId: string, verdict: "approved" | "rejected"): Reply => {
    const childHabitId = completionId.replace(/^done-/, "");
    if (s.status[childHabitId] !== "submitted") return refuse(409, "This quest has already been decided.");
    const c = s.children.find((k) => (s.plans[k.id] ?? []).some((h) => h.id === childHabitId))!;
    const h = s.plans[c.id].find((p) => p.id === childHabitId)!;
    s.status[childHabitId] = verdict;
    if (verdict === "approved") {
      s.sparks[c.id] = (s.sparks[c.id] ?? 0) + h.tier;
      s.points[c.id] = (s.points[c.id] ?? 0) + h.points;
    }
    const decision: Decision = {
      completion: { id: completionId, status: verdict, day: DAY, submitted_at: NOW, decided_at: NOW },
      child_id: c.id, progress: progress(s.sparks[c.id]), points: s.points[c.id],
    };
    return ok(decision);
  };
  const journey = (childId: string): Journey => ({
    progress: progress(s.sparks[childId] ?? 0), discoveries: [], quest_stars: [],
    worlds: [
      { id: "camp", name: "Starter Camp", sparks: 0, rank: "Camp Sprout", tier: 1, blurb: "Where it begins.", landmarks: [] },
      { id: "mosswood", name: "Mosswood Forest", sparks: 30, rank: "Forest Explorer", tier: 2, blurb: "Giant trees.", landmarks: [] },
    ],
  });
  const token = (access_token: string): TokenResponse => ({ access_token, token_type: "bearer", expires_in: 3600 });

  const routes: [string, RegExp, Handler][] = [
    ["POST", /^\/v1\/auth\/token$/, (_m, body) => {
      const form = body as Record<string, string>;
      return form.password === DEV_PASSWORD ? ok(token("parent-token")) : refuse(401, "Incorrect username or password");
    }],
    ["GET", /^\/v1\/me$/, () => s.me],
    ["POST", /^\/v1\/families$/, (_m, body) => {
      const b = body as { name: string; timezone: string; pin?: string; display_name: string; role: ApiFamily["caregivers"][0]["role"] };
      s.family = {
        id: "f1", name: b.name, timezone: b.timezone, invite_code: "INVITE22", login_code: null, has_pin: Boolean(b.pin),
        created_at: NOW, caregivers: [{ user_id: s.me.id, display_name: b.display_name, role: b.role }],
      };
      s.pin = b.pin ?? null;
      s.me.families = [{ id: "f1", name: b.name, display_name: b.display_name, role: b.role }];
      return created(s.family);
    }],
    ["GET", /^\/v1\/families\/(\w+)$/, () => s.family],
    ["GET", /^\/v1\/families\/\w+\/children$/, () => s.children],
    ["POST", /^\/v1\/families\/\w+\/children$/, (_m, body) => {
      const b = body as Pick<ApiChild, "name" | "age" | "buddy" | "routine_times">;
      const kid: ApiChild = { ...b, id: `c${s.children.length + 1}`, family_id: "f1", world: "camp", tier_override: 0, has_pin: false, created_at: NOW };
      s.children.push(kid);
      s.plans[kid.id] = [];
      return created(kid);
    }],
    ["POST", /^\/v1\/families\/\w+\/pin\/verify$/, (_m, body) => ({ valid: (body as { pin: string }).pin === s.pin })],
    ["GET", /^\/v1\/families\/\w+\/approvals$/, () => approvals()],
    ["POST", /^\/v1\/completions\/([\w-]+)\/approve$/, (m) => decide(m[1], "approved")],
    ["POST", /^\/v1\/completions\/([\w-]+)\/reject$/, (m) => decide(m[1], "rejected")],
    ["GET", /^\/v1\/children\/(\w+)\/today$/, (m) => today(m[1])],
    ["GET", /^\/v1\/children\/(\w+)\/extras$/, () => extras()],
    ["GET", /^\/v1\/children\/(\w+)\/plan$/, (m) => plan(m[1])],
    ["PUT", /^\/v1\/children\/(\w+)\/plan$/, (m, body) => {
      const b = body as { habits: { habit_id: string; cue_time?: string }[] };
      const before = new Map((s.plans[m[1]] ?? []).map((h) => [h.habit_id, h]));
      s.plans[m[1]] = b.habits.map((h) => before.get(h.habit_id) ?? planHabit(m[1], h.habit_id, h.cue_time ?? "07:00"));
      return plan(m[1]);
    }],
    ["PATCH", /^\/v1\/child-habits\/([\w-]+)$/, (m, body) => {
      const b = body as { status?: "active" | "paused" | "removed" };
      const c = s.children.find((k) => (s.plans[k.id] ?? []).some((h) => h.id === m[1]))!;
      const status = b.status;
      s.plans[c.id] = status === "removed"
        ? s.plans[c.id].filter((h) => h.id !== m[1])
        : s.plans[c.id].map((h) => h.id === m[1] && status ? { ...h, status } : h);
      return plan(c.id);
    }],
    ["GET", /^\/v1\/catalog$/, () => CATALOG],
    ["GET", /^\/v1\/goals$/, () => GOALS],
    ["GET", /^\/v1\/families\/\w+\/habits$/, () => []],
    ["POST", /^\/v1\/children\/(\w+)\/kid-session$/, (m) => ({ ...token(`kid:${m[1]}`), child: { id: m[1], name: child(m[1])!.name } })],
    ["GET", /^\/v1\/kid\/today$/, (_m, _b, t) => today(kidChild(t)!)],
    ["POST", /^\/v1\/kid\/completions$/, (_m, body, t) => {
      s.status[(body as { child_habit_id: string }).child_habit_id] = "submitted";
      return created(today(kidChild(t)!));
    }],
    ["GET", /^\/v1\/kid\/extras$/, () => extras()],
    ["PATCH", /^\/v1\/kid\/extras$/, () => extras()],
    ["POST", /^\/v1\/kid\/app-time$/, () => extras()],
    ["GET", /^\/v1\/kid\/journey$/, (_m, _b, t) => journey(kidChild(t)!)],
    ["GET", /^\/v1\/kid\/checkins\/today$/, () => null],
    ["POST", /^\/v1\/kid\/buddy-line$/, () => ({ line: "You've got this!" })],
    ["GET", /^\/v1\/families\/\w+\/settings$/, () => ({ app_limit: 0, buddy_talk: true })],
    // Lists that start empty.
    ["GET", /^\/v1\/(kid\/surprises|families\/\w+\/(checkins|reward-requests|suggestions|surprises|reports|rewards))$/, () => []],
  ];

  const server: FakeServer = {
    state: s, calls, unhandled,
    sent: (method, path) => calls.filter((c) => c.method === method && path.test(c.path)),
    on: (method, path, handler) => void routes.unshift([method, path, handler]),
  };

  active = server;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const { pathname } = new URL(url, "http://api.test");
    const headers = (init.headers ?? {}) as Record<string, string>;
    const raw = typeof init.body === "string" ? init.body : undefined;
    const body = raw === undefined ? undefined
      : headers["Content-Type"] === "application/x-www-form-urlencoded" ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
    calls.push({ method, path: pathname, body });
    const auth = headers.Authorization?.replace(/^Bearer /, "") ?? null;
    for (const [m, pattern, handler] of routes) {
      const match = method === m ? pathname.match(pattern) : null;
      if (!match) continue;
      const result = handler(match, body, auth);
      const reply = isReply(result) ? result : ok(result);
      const status = reply.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? null), { status, headers: { "Content-Type": "application/json" } });
    }
    unhandled.push(`${method} ${pathname}`);
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  return server;
}

