/** What HabitQuest stores, what reaches the AI provider, and how a family can export or delete it. */
import { Footer, SiteHeader } from "../components/Headers";

export default function Privacy() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">Privacy</p>
            <h1>Your family's data</h1>
          </div>
        </div>
        <section className="panel">
          <h2>What we store</h2>
          <p>Your Google name and email, your family and caregivers, your children's first names and ages, their quests, Sparks and points, check-ins, rewards and surprises, and your conversations with the habit coach.</p>
        </section>
        <section className="panel">
          <h2>What reaches the AI provider</h2>
          <p>The AI helpers use Nebius Token Factory. Children's names from your family are replaced with labels before anything is sent. The provider receives what you type to the coach, children's ages, quest titles and progress, and notes children write in check-ins for a safety check.</p>
          <p>Messages suggesting a child may be at risk are not sent to the coach. Please avoid typing surnames, addresses or other identifying details.</p>
        </section>
        <section className="panel">
          <h2>Keeping and deleting</h2>
          <p>Coach conversations are kept for 90 days. From the parent dashboard you can export your family's data or delete your family at any time. Deleting cannot be undone.</p>
        </section>
        <p className="hint">HabitQuest gives general guidance, not medical advice. In an emergency, contact your local emergency number.</p>
      </main>
      <Footer />
    </div>
  );
}
