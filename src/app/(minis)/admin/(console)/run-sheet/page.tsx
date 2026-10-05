import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getBookingView } from "@/lib/booking";
import { localDate, localDayRange, formatTime, formatDateLong, isValidDate } from "@/lib/time";
import { FIELD_LABELS, displayField, firstNameOf, type FieldKey } from "@/lib/intake";
import { dollars } from "@/lib/format";
import PrintButton from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";

export default async function RunSheet({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const s = await getSettings();
  const sp = await searchParams;
  const date = sp.date && isValidDate(sp.date) ? sp.date : localDate(new Date(), s.timezone);
  const { start, end } = localDayRange(date, s.timezone);
  const db = await getDb();
  const ids = (await db.query(`select id from bookings where status='confirmed' and starts_at >= $1 and starts_at < $2 order by starts_at`, [start, end])).rows;
  const views = (await Promise.all(ids.map((r) => getBookingView(r.id)))).filter((v): v is NonNullable<typeof v> => !!v);
  const keys: FieldKey[] = ["peopleCount", "participants", "purposes", "hopes", "orientation", "posing", "beautyEdit", "comfort"];
  return (
    <div className="stack">
      <div className="row between no-print"><h1 style={{ margin: 0 }}>Run sheet</h1><PrintButton /></div>
      <h2 style={{ margin: 0 }}>{formatDateLong(start, s.timezone)}</h2>
      <p className="muted small" style={{ margin: 0 }}>First names and only what you need on the day.</p>
      {views.length === 0 && <div className="card">No sessions on this date.</div>}
      {views.map((v) => (
        <section key={v.id} className="card stack" style={{ gap: 8 }}>
          <div className="row between"><h3 style={{ margin: 0 }}>{formatTime(v.startsAt, s.timezone)} · {firstNameOf(v.intake) ?? v.ref}</h3><span className="muted small">{v.ref}</span></div>
          <table className="t"><tbody>{keys.map((k) => <tr key={k}><th scope="row" style={{ width: "34%" }}>{FIELD_LABELS[k]}</th><td>{displayField(v.intake, k)}</td></tr>)}
            <tr><th scope="row">Deposit</th><td>{v.paymentStatus === "paid" ? `paid ${dollars(v.paidCents)}` : v.paymentStatus}</td></tr>
            <tr><th scope="row">Public photo OK?</th><td>{displayField(v.intake, "photoRelease")}</td></tr></tbody></table>
        </section>
      ))}
      <section className="card"><h3>Gear check</h3><ul style={{ columns: 2 }}>{s.prepChecklist.map((i) => <li key={i.key} style={{ listStyle: "none" }}>☐ {i.label}</li>)}</ul></section>
    </div>
  );
}
