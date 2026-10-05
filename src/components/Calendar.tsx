"use client";
import { useMemo } from "react";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface CalendarProps {
  year: number; month: number;                   // month: 1-12
  today: string;                                 // YYYY-MM-DD in venue timezone
  available: Record<string, number>;             // date -> number of open times
  selected: string | null;
  onSelect: (date: string) => void;
  onMonth: (year: number, month: number) => void;
  minMonth: { y: number; m: number };
  maxMonth: { y: number; m: number };
  mode?: "pick" | "multi";                       // owner availability editor uses multi-select over every day
  multi?: Set<string>;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** True calendar math: weekday of the 1st and length of the month are computed, never assumed. */
export default function Calendar(p: CalendarProps) {
  const { year, month } = p;
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { first, days };
  }, [year, month]);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const atMin = year < p.minMonth.y || (year === p.minMonth.y && month <= p.minMonth.m);
  const atMax = year > p.maxMonth.y || (year === p.maxMonth.y && month >= p.maxMonth.m);
  const multi = p.mode === "multi";

  const items: React.ReactNode[] = [];
  for (let i = 0; i < cells.first; i++) items.push(<span key={"b" + i} className="day blank" aria-hidden="true" />);
  for (let d = 1; d <= cells.days; d++) {
    const date = ymdOf(year, month, d);
    const count = p.available[date] ?? 0;
    const isPast = date < p.today;
    const sel = multi ? p.multi?.has(date) : p.selected === date;
    const longName = new Date(Date.UTC(year, month - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    if (multi) {
      items.push(
        <button key={date} type="button" className={`day open${sel ? " sel" : ""}${date === p.today ? " today" : ""}`} disabled={isPast} aria-pressed={!!sel}
          aria-label={`${longName}${count ? `, ${count} published times` : ""}`} onClick={() => p.onSelect(date)} style={isPast ? { opacity: .4 } : undefined}>
          {d}{count > 0 && <small>{count}</small>}
        </button>,
      );
      continue;
    }
    if (count > 0 && !isPast) {
      items.push(
        <button key={date} type="button" className={`day open${sel ? " sel" : ""}${date === p.today ? " today" : ""}`} aria-pressed={!!sel}
          aria-label={`${longName}, ${count} time${count === 1 ? "" : "s"} available`} onClick={() => p.onSelect(date)}>
          {d}<small>{count} open</small>
        </button>,
      );
    } else {
      items.push(
        <span key={date} className={`day closed${date === p.today ? " today" : ""}`} role="img" aria-label={`${longName}, ${isPast ? "past" : "no times available"}`}>{d}</span>,
      );
    }
  }

  return (
    <div>
      <div className="cal-head">
        <h3 id="cal-title" aria-live="polite">{MONTHS[month - 1]} {year}</h3>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" disabled={atMin} onClick={() => p.onMonth(prev.y, prev.m)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" disabled={atMax} onClick={() => p.onMonth(next.y, next.m)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
      <div className="cal" role="group" aria-labelledby="cal-title">
        {DOW.map((d) => <div className="dow" key={d} aria-hidden="true">{d}</div>)}
        {items}
      </div>
      {!multi && (
        <div className="legend" aria-hidden="true">
          <span><i className="swatch open" /> Times available</span>
          <span><i className="swatch sel" /> Your choice</span>
          <span><i className="swatch closed" /> Not available</span>
        </div>
      )}
    </div>
  );
}
