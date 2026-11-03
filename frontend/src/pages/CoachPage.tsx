/**
 * Habit coach (parent): its own tab, so a parent can talk through a child's problem without
 * scrolling past the dashboard. Opens on the child in the route, or the first child.
 */
import { Coach } from "../components/AiHelpers";
import { Footer, ParentHeader } from "../components/Headers";
import { useStore } from "../lib/store";

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
              Describe a problem in your own words. The coach suggests quests from expert guidance, and nothing
              changes until you add them with your PIN.
            </p>
          </div>
        </div>
        <Coach key={childId} family={fam} childId={childId} onChange={async () => {}} />
      </main>
      <Footer />
    </div>
  );
}
