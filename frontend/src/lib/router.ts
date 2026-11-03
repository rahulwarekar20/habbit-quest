/**
 * Tiny hash router: "#/kid/abc" -> ["kid", "abc"]. Hash routes work on any static host
 * without server rewrites, which keeps publishing simple later.
 */
import { useEffect, useState } from "react";

const parse = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);

/** The current route as parts ("#/kid/abc" -> ["kid", "abc"]); re-renders when the address changes. */
export function useRoute(): string[] {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Navigates to a route, e.g. go("/parent"). */
export function go(path: string): void {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}
