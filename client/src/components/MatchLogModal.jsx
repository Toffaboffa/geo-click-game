// client/src/components/MatchLogModal.jsx
import React, { useEffect, useMemo, useState } from "react";

function fmtSigned(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const s = v > 0 ? "+" : "";
  return `${s}${Math.trunc(v)}`;
}

function safePct(wins, played) {
  const w = Number(wins) || 0;
  const p = Number(played) || 0;
  if (p <= 0) return null;
  return Math.round((1000 * w) / p) / 10; // 1 decimal
}

export default function MatchLogModal({
  open,
  onClose,
  t,
  me,
  rows,
  defaultOpponent, // "__ALL__" or username
  title,
}) {
  const [opponent, setOpponent] = useState(defaultOpponent || "__ALL__");

  useEffect(() => {
    if (open) setOpponent(defaultOpponent || "__ALL__");
  }, [open, defaultOpponent]);

  const opponents = useMemo(() => {
    const set = new Set();
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const o = String(r?.opponent || "").trim();
      if (o) set.add(o);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const all = Array.isArray(rows) ? rows : [];
    if (!opponent || opponent === "__ALL__") return all;
    return all.filter((r) => String(r?.opponent || "") === opponent);
  }, [rows, opponent]);

  const vsStats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const r of filtered) {
      const res = String(r?.result || "").toLowerCase();
      if (res === "win") wins += 1;
      else if (res === "loss") losses += 1;
      else if (res === "draw") draws += 1;
    }
    const played = wins + losses + draws;
    const pct = safePct(wins, wins + losses); // ignore draws in win% denominator
    return { played, wins, losses, draws, pct };
  }, [filtered]);

  if (!open) return null;

  const allLabel = t("lobby.matchlog.allOpponents");

  return (
    <div className="finish-overlay" onClick={onClose}>
      <div className="finish-card finish-card-wide matchlog-card" onClick={(e) => e.stopPropagation()}>
        <div className="finish-title">{title || t("lobby.matchlog.title")}</div>

        <div className="matchlog-top">
          <div className="matchlog-filter">
            <div className="ps-label">{t("lobby.matchlog.filterLabel")}</div>
            <select
              className="matchlog-select"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
            >
              <option value="__ALL__">{allLabel}</option>
              {opponents.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div className="matchlog-vsstats">
            <div className="ps-label">{opponent && opponent !== "__ALL__" ? `${me} vs ${opponent}` : ""}</div>
            <div className="matchlog-vsstats-line">
              <span>{t("lobby.matchlog.played", { n: vsStats.played })}</span>
              <span>•</span>
              <span>{t("lobby.matchlog.wins", { n: vsStats.wins })}</span>
              <span>•</span>
              <span>{t("lobby.matchlog.losses", { n: vsStats.losses })}</span>
              <span>•</span>
              <span>
                {t("lobby.matchlog.winrate", { n: vsStats.pct == null ? "—" : `${vsStats.pct}%` })}
              </span>
            </div>
          </div>
        </div>

        <div className="matchlog-list">
          {filtered.length === 0 ? (
            <div className="progress-hint">{t("lobby.matchlog.empty")}</div>
          ) : (
            filtered.map((r) => {
              const opp = String(r?.opponent || "");
              const res = String(r?.result || "").toLowerCase();
              const cls = res === "win" ? "ml-win" : res === "loss" ? "ml-loss" : "ml-draw";
              const resLabel =
                res === "win"
                  ? t("lobby.matchlog.win")
                  : res === "loss"
                  ? t("lobby.matchlog.loss")
                  : t("lobby.matchlog.draw");

              return (
                <div key={String(r?.matchId || `${opp}-${r?.createdAt}`)} className="matchlog-row">
                  <div className="matchlog-left">{me} vs {opp}</div>
                  <div className={`matchlog-result ${cls}`}>{resLabel}</div>
                  <div className="matchlog-elo">{fmtSigned(r?.eloDelta)}</div>
                </div>
              );
            })
          )}
        </div>

        <div className="finish-actions">
          <button className="hud-btn" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
