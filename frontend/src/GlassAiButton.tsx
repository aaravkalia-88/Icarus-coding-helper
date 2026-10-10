import { useEffect, useState, type CSSProperties } from "react";
import { useFrameRendering } from './rendering-lifecycle';

import originalDocument from "../public/landing-pages/icarus-glass.html?raw";

// Adapt the application boundary and label; the authored renderer stays intact.
const sourceDocument = originalDocument.replaceAll("GPT 6 Sol", "Open ICARUS")
  .replace("Open ICARUS — activate the galaxy", "Open ICARUS command menu")
  .replace("</body>", `<script>document.getElementById('activate').addEventListener('click', () => parent.postMessage({type:'icarus-glass-activate'}, '*'));</script></body>`);

export type GlassAiButtonProps = {
  onActivate: () => void;
  className?: string;
  style?: CSSProperties;
};

export function GlassAiButton({ onActivate, className = "", style }: GlassAiButtonProps) {
  const [hostRef, syncRendering] = useFrameRendering();
  const [documentVisible, setDocumentVisible] = useState(() => (
    typeof document === "undefined" || !document.hidden
  ));
  const [hostVisible, setHostVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setHostVisible(true));
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setHostVisible(entry?.isIntersecting ?? true);
    }, { rootMargin: "80px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const receive = (event: MessageEvent) => {
      if (event.source === host?.querySelector("iframe")?.contentWindow
        && event.data?.type === "icarus-glass-activate") onActivate();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [hostRef, onActivate]);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (hostVisible && documentVisible) queueMicrotask(() => setMounted(true));
  }, [hostVisible, documentVisible]);

  return (
    <div
      ref={hostRef}
      className={`threeui-background glass-ai-button${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="Open ICARUS with the glass button"
      data-state={!hostVisible || !documentVisible ? "paused" : ready ? "ready" : "loading"}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#a8b0bd",
        pointerEvents: "auto",
        ...style,
      }}
    >
      {mounted ? (
        <iframe
          title="Open ICARUS — glass button"
          srcDoc={sourceDocument}
          sandbox="allow-scripts"
          loading="eager"
          onLoad={() => { setReady(true); syncRendering(); }}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            border: 0,
            background: "#a8b0bd",
            opacity: ready ? 1 : 0,
            pointerEvents: ready ? "auto" : "none",
            transition: "opacity 240ms ease-out",
          }}
        />
      ) : null}
    </div>
  );
}
