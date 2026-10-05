export default function Help() {
  const H = ({ t, children }: { t: string; children: React.ReactNode }) => <section className="card stack"><h2 style={{ margin: 0, fontSize: "1.4rem" }}>{t}</h2>{children}</section>;
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>How to…</h1>
      <H t="Create a new season (Holiday, Spring…)"><ol><li>Page editor → <strong>Duplicate this one</strong> → name it.</li><li>Change the headline, colors and photos. Tap <strong>Save draft</strong>, check the Preview (Desktop and Phone).</li><li><strong>Publish</strong>. Your booking link stays the same; the newest published season is what people see.</li></ol></H>
      <H t="Publish dates"><ol><li>Availability → tap the days on the calendar.</li><li>Set start time, end time, session length and buffer (add a lunch break if you want).</li><li><strong>Preview times</strong>, then <strong>Publish these times</strong>. Only published times can be booked.</li></ol></H>
      <H t="Change a photo"><ol><li>Page editor → Photos → <strong>Upload a photo</strong> (or pick one you've uploaded before).</li><li>Describe it (for people who use screen readers). Use ↑ ↓ to reorder; the first three show at the top.</li><li>Save draft → Publish.</li></ol></H>
      <H t="Review today"><p>The <strong>Today</strong> tab shows your next session, today's schedule and anything that needs you. <strong>Printable run sheet</strong> makes a one-page brief with first names and what they asked for.</p></H>
      <H t="When a client updates their form"><p>You get an email with what changed (before → now) plus their full current answers, and the Google Doc is refreshed. If they changed the beauty-editing choice, a task appears in "Needs attention". Nothing is charged automatically.</p></H>
      <H t="Pause everything"><p>Top-right <strong>Pause bookings</strong>. The page shows a friendly "paused" message. Existing bookings aren't touched.</p></H>
      <H t="When something says 'waiting for setup' or 'failed'"><p>Waiting means Google or email isn't connected yet; it will run by itself once it is. Failed means it tried several times: open that booking and tap <strong>Retry sync</strong>. Your client's answers are always safe in the database either way.</p></H>
    </div>
  );
}
