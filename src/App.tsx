/**
 * App shell: picks the page for the current hash route and applies the access rules.
 *
 *   #/                     Home
 *   #/register, #/login    Accounts
 *   #/demo                 Opens the demo family (shareable demo link)
 *   #/setup                Habits & times (parent)
 *   #/parent               Dashboard (parent)
 *   #/quests[/:child]      Quest library: bonus quests per child (parent)
 *   #/rewards              Reward shop prices and time limits (parent)
 *   #/kid                  Who's playing?          (kid mode)
 *   #/kid/:child           Today's picture quests  (kid mode)
 *   #/world/:child/:world  Explore a world         (kid mode)
 *   #/shop/:child          Reward shop and buddy wardrobe (kid mode)
 *
 * Parent pages need a signed-in family; while kid mode is on they also need the parent PIN.
 */
import { useEffect, useRef } from "react";
import { Login, Register } from "./pages/Auth";
import HabitSetup from "./pages/HabitSetup";
import Home from "./pages/Home";
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
  const { family } = useStore();

  if (!page) return <Home />;
  if (page === "register") return <Register />;
  if (page === "login") return <Login />;
  if (page === "demo") return <OpenDemo />;

  // Everything below belongs to a signed-in family.
  if (!family) return <Redirect to="/login" />;

  if (page === "kid") return a ? <KidQuests childId={a} /> : <KidPicker />;
  if (page === "world" && a && b) return <WorldExplore childId={a} worldId={b} />;
  if (page === "shop" && a) return <KidShop childId={a} />;

  if (["setup", "parent", "quests", "rewards"].includes(page)) {
    if (getKidMode()) return <ParentLock />;
    if (page !== "setup" && !family.habitsChosen) return <Redirect to="/setup" />;
    if (page === "setup") return <HabitSetup />;
    if (page === "quests") return <QuestLibrary childId={a} />;
    if (page === "rewards") return <RewardsPage />;
    return <ParentDashboard />;
  }
  return <Home />;
}

function OpenDemo() {
  const { startDemo } = useStore();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // run once, even though startDemo changes after it saves
    started.current = true;
    startDemo().then(() => go("/parent"));
  }, [startDemo]);
  return null;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => go(to), [to]);
  return null;
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
