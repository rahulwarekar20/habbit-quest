/**
 * App shell: picks the page for the current hash route and applies the access rules.
 *
 *   #/                     Home
 *   #/privacy              What we store and what reaches the AI provider
 *   #/login                Sign in (#/register lands here too)
 *   #/welcome              First-time setup: family, then the first child
 *   #/setup[/:child]       Child details and routine times (parent)
 *   #/parent               Dashboard (parent)
 *   #/quests[/:child]      Quest library: a child's plan (parent)
 *   #/rewards              Record rewards, shop prices and time limits (parent)
 *   #/kid                  Who's playing?          (kid mode)
 *   #/kid/:child           Today's picture quests  (kid mode)
 *   #/world/:child/:world  Explore a world         (kid mode)
 *   #/shop/:child          Reward shop and buddy wardrobe (kid mode)
 *
 * Parent pages need a signed-in family with a child; while kid mode is on they also need the PIN.
 */
import { useEffect } from "react";
import Logo from "./components/Logo";
import { Login, Welcome } from "./pages/Auth";
import HabitSetup from "./pages/HabitSetup";
import Home from "./pages/Home";
import Privacy from "./pages/Privacy";
import { KidPicker, KidQuests, WorldExplore } from "./pages/Kid";
import KidShop from "./pages/KidShop";
import ParentDashboard from "./pages/ParentDashboard";
import QuestLibrary from "./pages/QuestLibrary";
import RewardsPage from "./pages/RewardsPage";
import { go, useRoute } from "./lib/router";
import { getKidMode, setKidMode } from "./lib/storage";
import { useStore } from "./lib/store";

export default function App() {
  const [page, a, b] = useRoute();
  const { family, phase, loadError, retry } = useStore();

  if (!page) return <Home />;
  if (page === "privacy") return <Privacy />;
  if (phase === "booting") return <Holding message="Getting things ready…" />;
  if (phase === "failed") return <Holding message={loadError ?? "We couldn't load your family."} onRetry={retry} />;

  if (page === "login" || page === "register") {
    if (phase === "ready") return <Redirect to="/parent" />;
    if (phase === "noFamily") return <Redirect to="/welcome" />;
    return <Login />;
  }

  // Everything below belongs to a signed-in caregiver.
  if (phase === "signedOut") return <Redirect to="/login" />;
  if (phase === "noFamily" || !family) return <Welcome />;
  if (family.children.length === 0) return <Welcome />;
  if (page === "welcome") return <Redirect to="/parent" />;

  if (page === "kid") return a ? <KidQuests key={a} childId={a} /> : <KidPicker />;
  if (page === "world" && a && b) return <WorldExplore childId={a} worldId={b} />;
  if (page === "shop" && a) return <KidShop childId={a} />;

  if (["setup", "parent", "quests", "rewards"].includes(page)) {
    if (getKidMode()) return <ParentLock />;
    if (page === "setup") return <HabitSetup childId={a} />;
    if (page === "quests") return <QuestLibrary childId={a} />;
    if (page === "rewards") return <RewardsPage />;
    return <ParentDashboard />;
  }
  return <Home />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => go(to), [to]);
  return null;
}

/** First load, or a load that failed: the waking-up notice shows on top of this. */
function Holding({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="holding">
      <Logo />
      <p role="status">{message}</p>
      {onRetry && <button className="btn btn--primary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Shown when a child in kid mode reaches a parent page: ask for the PIN or go back. */
function ParentLock() {
  const { askPin } = useStore();
  useEffect(() => {
    askPin("This page is for grown-ups.").then((ok) => {
      if (ok) {
        setKidMode(false);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else {
        go("/kid");
      }
    });
  }, [askPin]);
  return <div className="page page--kid" />;
}
