import { useEffect, useRef, useState, type CSSProperties } from "react";

export const DARK_SOULS_HOLO_CARD_VARIANTS = ["ashen-one", "cindermane"] as const;
export type DarkSoulsHoloCardVariant = (typeof DARK_SOULS_HOLO_CARD_VARIANTS)[number];

/* `ashen-one` is the packaged document, untouched. `cindermane` is the owner-supplied
   sibling document on the same engine, served as its own file. */
const DARK_SOULS_DOCUMENTS: Record<DarkSoulsHoloCardVariant, string> = {
  "ashen-one": "/landing-pages/dark-souls-holo-card.html",
  cindermane: "/landing-pages/dark-souls-holo-card-cindermane.html",
};

const DARK_SOULS_TITLES: Record<DarkSoulsHoloCardVariant, string> = {
  "ashen-one": "Dark Souls Holo Card — The Ashen One",
  cindermane: "Dark Souls Holo Card — Cindermane",
};

export type DarkSoulsHoloCardProps = {
  className?: string;
  style?: CSSProperties;
  variant?: DarkSoulsHoloCardVariant;
};

export function DarkSoulsHoloCard({ className = "", style, variant = "ashen-one" }: DarkSoulsHoloCardProps) {
  const safeVariant = DARK_SOULS_HOLO_CARD_VARIANTS.includes(variant) ? variant : "ashen-one";
  const hostRef = useRef<HTMLDivElement>(null);
  const [documentVisible, setDocumentVisible] = useState(() => (
    typeof document === "undefined" || !document.hidden
  ));
  const [hostVisible, setHostVisible] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setHostVisible(entry?.isIntersecting ?? true);
    }, { rootMargin: "80px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const mounted = hostVisible && documentVisible;

  useEffect(() => {
    setReady(false);
  }, [mounted, safeVariant]);

  return (
    <div
      ref={hostRef}
      className={`threeui-background dark-souls-holo-card${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="Interactive Dark Souls holographic card"
      data-state={!mounted ? "paused" : ready ? "ready" : "loading"}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#050404",
        pointerEvents: "auto",
        ...style,
      }}
    >
      {mounted ? (
        <iframe
          key={safeVariant}
          title={DARK_SOULS_TITLES[safeVariant]}
          src={DARK_SOULS_DOCUMENTS[safeVariant]}
          sandbox="allow-scripts"
          loading="eager"
          onLoad={() => setReady(true)}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            border: 0,
            background: "#050404",
            opacity: ready ? 1 : 0,
            pointerEvents: ready ? "auto" : "none",
            transition: "opacity 240ms ease-out",
          }}
        />
      ) : null}
    </div>
  );
}
