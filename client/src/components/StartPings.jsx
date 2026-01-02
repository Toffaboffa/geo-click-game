import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Animated "radar pings" that float over the Login/Lobby start background.
 * Points are sampled from /city_dots_points.json (land-safe dots).
 *
 * Renders in the same coordinate system as the start background:
 * - JSON points are in pixels for a 5600×2900 map.
 * - We scale to the rendered overlay width and keep aspect ratio.
 *
 * Purely visual: pointer-events are disabled in CSS.
 */
export default function StartPings({
  maxPings = 12,
  spawnEveryMs = 520,
  lifetimeMs = 2600,
  sizeMin = 10,
  sizeMax = 18,
}) {
  const [data, setData] = useState(null); // { width, height, points: [{x,y,...}] }
  const [pings, setPings] = useState([]);
  const overlayRef = useRef(null);
  const [scale, setScale] = useState(1);

  // Load land-safe dots from public/
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/city_dots_points.json", { cache: "force-cache" });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setData(json);
      } catch {
        // Silent fail: it's only a background decoration.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Track rendered overlay width -> scale to JSON coordinate system
  useEffect(() => {
    if (!overlayRef.current || !data) return;

    const el = overlayRef.current;
    const baseW = Number(data.width) || 5600;

    const update = () => {
      const w = el.clientWidth || 1;
      setScale(w / baseW);
    };

    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const points = useMemo(() => {
    const pts = data?.points || [];
    // Filter out any weird points (defensive)
    return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }, [data]);

  // Spawn pings
  useEffect(() => {
    if (!data || points.length === 0) return;

    const spawn = () => {
      const pick = points[Math.floor(Math.random() * points.length)];
      const size = Math.floor(sizeMin + Math.random() * (sizeMax - sizeMin + 1));
      const now = Date.now();
      const ping = {
        id: `${now}_${Math.random().toString(16).slice(2)}`,
        x: pick.x,
        y: pick.y,
        size,
        born: now,
      };

      setPings((prev) => {
        const next = [...prev, ping];
        // Keep it light
        while (next.length > maxPings) next.shift();
        return next;
      });
    };

    const int = setInterval(spawn, spawnEveryMs);

    const cleanup = setInterval(() => {
      const now = Date.now();
      setPings((prev) => prev.filter((p) => now - p.born < lifetimeMs));
    }, 400);

    return () => {
      clearInterval(int);
      clearInterval(cleanup);
    };
  }, [data, points, maxPings, spawnEveryMs, lifetimeMs, sizeMin, sizeMax]);

  // Nothing to render until JSON is available
  if (!data) return null;

  return (
    <div className="start-bg-overlay" ref={overlayRef} aria-hidden="true">
      {pings.map((p) => (
        <div
          key={p.id}
          className="start-ping"
          style={{
            left: `${p.x * scale}px`,
            top: `${p.y * scale}px`,
            width: `${p.size}px`,
            height: `${p.size}px`,
          }}
        >
          <span className="ping-core" />
          <span className="ping-ring ring1" />
          <span className="ping-ring ring2" />
          <span className="ping-ring ring3" />
        </div>
      ))}
    </div>
  );
}
