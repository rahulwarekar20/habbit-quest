/**
 * Habit coach (parent): its own tab, so a parent can talk through a child's problem without
 * scrolling past the dashboard. Opens on the child in the route, or the first child.
 */
import { Coach } from "../components/Coach";
import { Footer, ParentHeader } from "../components/Headers";
import { useStore } from "../lib/store";

/** The Habit coach page (#/coach[/:child]). */
export default function CoachPage({ childId }: { childId?: string }) {
  const { family } = useStore();
  const fam = family!;
  return (
    <div className="page page--app page--coach">
      <ParentHeader active="coach" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <h1>What's going on?</h1>
            <p className="lead">
              Find a useful goal, make a few small habits, and choose what fits your child.
              Your plan changes only when you add a habit.
            </p>
          </div>
        </div>
        <Coach key={childId} family={fam} childId={childId} onChange={async () => {}} />
      </main>
      <Footer />
    </div>
  );
}
