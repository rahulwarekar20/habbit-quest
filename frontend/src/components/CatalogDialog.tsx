/** Bounded catalog detail reader, with keyboard focus kept inside and restored on close. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function CatalogDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [host] = useState(() => document.createElement("div"));
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(host);
    const siblings = [...document.body.children].filter(element => element !== host);
    const inert = siblings.map(element => element.hasAttribute("inert"));
    siblings.forEach(element => element.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...panel.current!.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex='0']")]
      .filter(element => !element.closest("[hidden]") && ![...panel.current!.querySelectorAll("details:not([open])")].some(details => details.contains(element) && element !== details.querySelector(":scope > summary")));
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (panel.current?.closest("[inert]")) return; // A nested reader owns focus and Escape until it closes.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      siblings.forEach((element, index) => { if (!inert[index]) element.removeAttribute("inert"); });
      document.body.style.overflow = overflow;
      host.remove();
      if (previous?.isConnected) previous.focus();
    };
  }, [host]);
  return createPortal(<div className="catalog-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <header className="catalog-dialog__header"><h2 id={id}>{title}</h2><button type="button" className="btn btn--ghost btn--sm" aria-label="Close details" onClick={onClose}>Close <span aria-hidden="true">×</span></button></header>
      <div className="catalog-dialog__content">{children}</div>
    </div>
  </div>, host);
}
