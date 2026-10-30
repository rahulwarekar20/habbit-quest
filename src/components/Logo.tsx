/** HabbitQuest wordmark: a spark badge plus the name. Links home. */
import { SparkIcon } from "./Spark";

export default function Logo({ href = "#/" }: { href?: string }) {
  return (
    <a href={href} className="logo" aria-label="HabbitQuest home">
      <span className="logo__badge">
        <SparkIcon size={22} />
      </span>
      <span className="logo__text">
        Habbit<span>Quest</span>
      </span>
    </a>
  );
}
