/**
 * Home page: what HabbitQuest is, how a day works, the habits parents can choose,
 * the worlds children unlock, and why parents can trust it.
 */
import Buddy from "../components/Buddy";
import Clock from "../components/Clock";
import HabitArt from "../components/HabitArt";
import { Footer, SiteHeader } from "../components/Headers";
import { SparkCount, SparkIcon } from "../components/Spark";
import WorldArt from "../components/WorldArt";
import { WORLDS } from "../lib/family";
import { HABITS } from "../lib/habits";
import { formatMinutes, formatTime } from "../lib/time";

const STEPS = [
  { title: "Parents choose", text: "Pick the habits that matter and set the times that suit your family." },
  { title: "Kids see pictures", text: "Each habit becomes a bright picture quest with a clock to match." },
  { title: "“I did it!”", text: "Your child taps the quest when it's done. No reading needed." },
  { title: "You approve", text: "A quick check from you, protected by your parent PIN." },
  { title: "Sparkle!", text: "A Spark lands in their jar, and Sparks unlock new worlds." },
];

export default function Home() {
  return (
    <div className="page page--home">
      <SiteHeader />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <FloatingSparks />
        <div className="wrap hero__inner">
          <div className="hero__copy">
            <p className="eyebrow">For parents &amp; kids, ages 4 to 12</p>
            <h1>
              Little habits.
              <br />
              <span className="gradient-text">Big adventures.</span>
            </h1>
            <p className="lead">
              HabbitQuest turns everyday routines like waking up on time, finishing homework and getting to bed early
              into picture quests your child loves. Every habit you approve earns a sparkling reward that unlocks
              new worlds to explore.
            </p>
            <div className="hero__ctas">
              <a className="btn btn--primary btn--lg" href="#/login">Get started</a>
            </div>
          </div>

          <div className="hero__stage" aria-hidden="true">
            <div className="stage-card stage-card--quest">
              <div className="stage-card__top">
                <Buddy buddy="fox" size={40} />
                <div>
                  <b>Good morning, Alex!</b>
                  <span>2 of 4 quests done</span>
                </div>
                <SparkCount count={7} />
              </div>
              <div className="stage-quest">
                <HabitArt habit="wake" />
                <div className="stage-quest__row">
                  <div>
                    <b>Rise and shine!</b>
                    <span>by 7:00 AM</span>
                  </div>
                  <Clock time="07:00" size={46} />
                </div>
                <span className="btn btn--gold btn--block">I did it!</span>
              </div>
            </div>
            <div className="stage-card stage-card--approve">
              <p className="eyebrow">Parent space</p>
              <b>Homework hero</b>
              <span className="muted">Alex marked it done</span>
              <span className="btn btn--primary btn--sm">Approve +1 Spark</span>
            </div>
            <div className="stage-badge">
              <SparkIcon size={34} />
              <span>+1 Spark!</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="section" id="how">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">A simple daily journey</p>
            <h2>Five small steps, every day</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`step step--${i + 1}`}>
                <span className="step__num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Habits ───────────────────────────────────────────────────── */}
      <section className="section section--tint" id="habits">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Good habits, your way</p>
            <h2>Choose the habits. Set the times.</h2>
            <p className="lead">Start with one or two, or choose all six. You can change them any time.</p>
          </div>
          <div className="habit-grid">
            {HABITS.map((h) => (
              <article key={h.id} className="habit-tile">
                <HabitArt habit={h.id} />
                <div className="habit-tile__body">
                  <h3>{h.parentTitle}</h3>
                  <p>{h.description}</p>
                  {h.setting.kind === "time" && (
                    <span className="chip">{h.setting.label} {formatTime(h.setting.default)}</span>
                  )}
                  {h.setting.kind === "minutes" && (
                    <span className="chip">Limit {formatMinutes(Number(h.setting.default))} a day</span>
                  )}
                  {h.setting.kind === "none" && <span className="chip">Every school day</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Worlds ───────────────────────────────────────────────────── */}
      <section className="section" id="worlds">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Worth the effort</p>
            <h2>Sparks unlock worlds to explore</h2>
            <p className="lead">Sparks are never taken away. Once a world is open, it stays open.</p>
          </div>
          <div className="world-grid">
            {WORLDS.map((w) => (
              <article key={w.id} className="world-tile">
                <WorldArt world={w.id} />
                <div className="world-tile__body">
                  <h3>{w.name}</h3>
                  <p>{w.blurb}</p>
                  <span className="chip chip--gold">
                    <SparkIcon size={14} /> {w.sparks === 0 ? "Open from day one" : `${w.sparks} Sparks to unlock`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── For parents ──────────────────────────────────────────────── */}
      <section className="section section--tint" id="parents">
        <div className="wrap parents">
          <div>
            <p className="eyebrow">Made for grown-ups too</p>
            <h2>You stay in charge, without the nagging</h2>
            <p className="lead">
              HabbitQuest is the friendly middle ground between a chore chart and a screen. Children feel proud;
              parents get calmer mornings and evenings.
            </p>
          </div>
          <ul className="trust">
            <li><b>Only you award Sparks.</b> Every reward needs your approval, protected by your parent PIN.</li>
            <li><b>Your times, your rules.</b> Wake-up, meals, screen limits and bedtime are set by you.</li>
            <li><b>Encouraging, never punishing.</b> &ldquo;Not yet&rdquo; lets them try again. Sparks are never taken away.</li>
            <li><b>No ads, no chat, no strangers.</b> Kid mode is a closed space just for your family.</li>
          </ul>
        </div>
      </section>

      {/* ── Final call to action ─────────────────────────────────────── */}
      <section className="cta-band">
        <div className="wrap cta-band__inner">
          <div>
            <h2>Start your family's first quest tonight</h2>
            <p>Two minutes to set up. One sparkle to win them over.</p>
          </div>
          <a className="btn btn--gold btn--lg" href="#/login">Get started free</a>
        </div>
      </section>

      <Footer />
    </div>
  );
}

/** Slowly drifting sparks behind the hero. */
function FloatingSparks() {
  const spots = [
    [6, 18, 18], [14, 70, 12], [30, 10, 10], [46, 84, 14], [62, 14, 12], [78, 76, 20], [90, 30, 12], [96, 64, 10],
  ];
  return (
    <div className="floaters" aria-hidden="true">
      {spots.map(([x, y, s], i) => (
        <span key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.7}s` }}>
          <SparkIcon size={s} />
        </span>
      ))}
    </div>
  );
}
