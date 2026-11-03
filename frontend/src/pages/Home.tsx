/**
 * Home page: what HabbitQuest is, how a day works, the habits parents can choose,
 * the worlds children unlock, and why parents can trust it. One call to action: Get started.
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
            <p className="eyebrow">For families with kids aged 3 to 13</p>
            <h1>
              Little habits.
              <br />
              <span className="gradient-text">Big adventures.</span>
            </h1>
            <p className="lead">
              Everyday routines become picture quests your child loves. Every quest you approve earns a Spark, and
              Sparks unlock new worlds to explore.
            </p>
            <div className="hero__ctas">
              <a className="btn btn--primary btn--lg" href="#/login">Get started</a>
              <a className="hero__kid" href="#/join">I'm a kid &rarr;</a>
            </div>
            <p className="hero__note">Free · No ads · Every reward approved by you</p>
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
          <ol className="flow">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flow__step">
                <span className="flow__num">{i + 1}</span>
                <div>
                  <b>{step.title}</b>
                  <p>{step.text}</p>
                </div>
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
            <p className="lead">Start with the daily routines, then add quests from a catalog of over forty, or make your own.</p>
          </div>
          <div className="mini-habits">
            {HABITS.map((h) => (
              <article key={h.id} className="mini-habit">
                <HabitArt habit={h.id} className="mini-habit__art" />
                <div>
                  <b>{h.parentTitle}</b>
                  <span>
                    {h.setting.kind === "time" && `${h.setting.label} ${formatTime(h.setting.default)}`}
                    {h.setting.kind === "minutes" && `Up to ${formatMinutes(Number(h.setting.default))} a day`}
                    {h.setting.kind === "none" && "Every school day"}
                  </span>
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
          <div className="mini-worlds">
            {WORLDS.map((w) => (
              <article key={w.id} className="mini-world">
                <WorldArt world={w.id} />
                <b>{w.name}</b>
                <span><SparkIcon size={12} /> {w.sparks === 0 ? "Open from day one" : `${w.sparks} Sparks`}</span>
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
