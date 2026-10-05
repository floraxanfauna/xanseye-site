import type { BookingView } from "./booking";
import { balanceSummary } from "./booking";
import { FIELD_LABELS, displayField, firstNameOf, renderIntakeText, type FieldChange, type FieldKey } from "./intake";
import { formatWhen, formatTime, formatDateLong, tzAbbrev } from "./time";
import { appUrl, dollars, escapeHtml } from "./util";
import type { DocLine } from "./google/client";

export interface Built { subject: string; text: string; html: string }

const wrap = (text: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;color:#27313C;max-width:620px">${escapeHtml(text)
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>`;
const build = (subject: string, text: string): Built => ({ subject, text, html: wrap(text) });

export const adminUrl = (id: string) => `${appUrl()}/admin/sessions/${id}`;

function money(b: BookingView) {
  const s = balanceSummary(b.quote, b.intake.beautyEdit.state === "answered" ? b.intake.beautyEdit.value : null, b.paidCents);
  const lines = [`Deposit paid: ${dollars(b.paidCents)}`];
  if (s.sessionPriceCents != null) lines.push(`Session price: ${dollars(s.sessionPriceCents)}${b.quote.depositPolicy === "credit" ? ` (deposit credited: ${dollars(s.depositCreditedCents)})` : ""}`);
  if (s.beautyDueCents) lines.push(`Beauty editing (2 photos): ${dollars(s.beautyDueCents)} — billed later, not charged yet`);
  if (s.balanceDueCents != null) lines.push(`Estimated balance due later: ${dollars(s.balanceDueCents)}`);
  else lines.push("Session price: not set in the dashboard yet");
  return lines.join("\n");
}

export function ownerNewBooking(b: BookingView, tz: string, o: { docUrl: string | null; calendarSynced: boolean; googleConnected: boolean }): Built {
  const text = [
    `New mini session booked: ${b.ref}`,
    ``,
    `When: ${formatWhen(b.startsAt, tz)}`,
    ``,
    `— Their answers —`,
    renderIntakeText(b.intake),
    ``,
    `— Money —`,
    money(b),
    b.quote.isDemo ? `\n(DEMO MODE: no real money moved.)` : "",
    ``,
    `Open in dashboard: ${adminUrl(b.id)}`,
    `Google Doc: ${o.docUrl ?? (o.googleConnected ? "still being created (you'll get the link in the next update)" : "Google isn't connected yet")}`,
    `Calendar: ${o.calendarSynced ? "added" : o.googleConnected ? "still syncing" : "Google isn't connected yet, so it's not on your calendar"}`,
  ].join("\n");
  return build(`New booking ${b.ref}: ${formatWhen(b.startsAt, tz)}`, text);
}

export function ownerIntakeChanged(b: BookingView, tz: string, version: number, changes: FieldChange[], o: { docUrl: string | null; savedAt: Date }): Built {
  const text = [
    `${b.ref} updated their form (version ${version}).`,
    `Session: ${formatWhen(b.startsAt, tz)}`,
    `Saved: ${o.savedAt.toLocaleString("en-US", { timeZone: tz })} ${tzAbbrev(o.savedAt, tz)}`,
    ``,
    `— What changed —`,
    ...changes.map((c) => `• ${c.label}\n    before: ${c.before}\n    now:    ${c.after}`),
    changes.some((c) => c.field === "beautyEdit") ? `\n⚠ Their beauty-editing choice changed. Nothing was charged; review their balance.` : "",
    ``,
    `— Full current answers —`,
    renderIntakeText(b.intake),
    ``,
    `Open in dashboard: ${adminUrl(b.id)}`,
    `Google Doc: ${o.docUrl ?? "being updated"}`,
  ].join("\n");
  return build(`Form updated: ${b.ref}, ${changes.map((c) => c.label).slice(0, 3).join(", ")}`, text);
}

export function clientConfirmation(b: BookingView, tz: string, o: { manageLink: string; rescheduled: boolean; siteName: string; ownerEmail: string }): Built {
  const q = b.quote;
  const text = [
    o.rescheduled ? `Your mini session was moved.` : `You're booked! Here are your details.`,
    ``,
    `When: ${formatWhen(b.startsAt, tz)}`,
    q.location ? `Where: ${q.location}` : "",
    q.durationMin ? `Length: ${q.durationMin} minutes` : "",
    `Reference: ${b.ref}`,
    ``,
    q.isDemo ? `(This is a DEMO booking. No real payment was taken.)` : `Deposit received: ${dollars(b.paidCents)}.`,
    q.depositPolicy === "credit" ? `Your deposit is credited toward your session.` : "",
    ``,
    `You can change your answers (who's coming, what you hope for, anything that would help you feel comfortable) any time here:`,
    o.manageLink,
    `Keep this email private. The link opens your booking.`,
    ``,
    `Need a different date or need to cancel? Reply to this email or write ${o.ownerEmail}.`,
    ``,
    `— ${o.siteName}`,
  ].filter((l) => l !== "").join("\n");
  return build(o.rescheduled ? `Your session was moved: ${formatWhen(b.startsAt, tz)}` : `You're booked: ${formatWhen(b.startsAt, tz)}`, text);
}

export function clientReminder(b: BookingView, tz: string, hours: number, o: { manageLink: string; siteName: string; prep: string }): Built {
  const text = [
    `A friendly reminder: your mini session is ${hours >= 48 ? "in 2 days" : "tomorrow"}.`,
    ``,
    `When: ${formatWhen(b.startsAt, tz)}`,
    b.quote.location ? `Where: ${b.quote.location}` : "",
    o.prep ? `\nGood to know:\n${o.prep}` : "",
    ``,
    `Update your answers any time: ${o.manageLink}`,
    ``,
    `— ${o.siteName}`,
  ].filter((l) => l !== "").join("\n");
  return build(`Reminder: your session ${formatDateLong(b.startsAt, tz)}`, text);
}

export function clientRecovery(link: string, siteName: string): Built {
  return build(`Your sign-in link`, [`Here's your private link to open your booking. It works once and expires in 30 minutes:`, ``, link, ``, `If you didn't ask for this, you can ignore it.`, `— ${siteName}`].join("\n"));
}
export function clientVerifyEmail(link: string, siteName: string): Built {
  return build(`Please confirm your new email`, [`You asked to use this address for your mini session. Confirm it here (expires in 24 hours):`, ``, link, ``, `Until you confirm, we'll keep using your previous address. If this wasn't you, ignore this message.`, `— ${siteName}`].join("\n"));
}
export function clientEmailChangedNotice(siteName: string): Built {
  return build(`Your session email was changed`, `The email address for your mini session was just changed. If this wasn't you, reply to this email right away.\n\n— ${siteName}`);
}
export function clientGallery(url: string, siteName: string, firstName: string | null): Built {
  return build(`Your photos are ready`, [`Hi${firstName ? " " + firstName : ""},`, ``, `Your gallery is ready:`, url, ``, `It was such a joy to photograph you.`, `— ${siteName}`].join("\n"));
}

export function ownerAlert(subject: string, message: string, link?: string): Built {
  return build(subject, [message, link ? `\n${link}` : ""].join("\n"));
}

export function ownerRunSheet(date: string, sessions: BookingView[], tz: string): Built {
  const lines = sessions.map((b) => {
    const parts = [
      `${formatTime(b.startsAt, tz)} · ${firstNameOf(b.intake) ?? b.ref} (${b.ref})`,
      `   People: ${displayField(b.intake, "peopleCount")} · For: ${displayField(b.intake, "purposes")}`,
      `   ${displayField(b.intake, "orientation")} · ${displayField(b.intake, "posing")} · Beauty edit: ${displayField(b.intake, "beautyEdit")}`,
    ];
    return parts.join("\n");
  });
  return build(`Today's mini sessions (${sessions.length})`, [`Run sheet for ${date}`, ``, ...lines, ``, `Full printable sheet: ${appUrl()}/admin/run-sheet?date=${date}`].join("\n"));
}

// ---------------------------------------------------------------- Google Doc brief

export function briefLines(b: BookingView, tz: string, o: { seasonName: string; canceled: boolean }): DocLine[] {
  const L: DocLine[] = [];
  const add = (text: string, style: DocLine["style"] = "p") => L.push({ text, style });
  add(`${o.canceled ? "CANCELED — " : ""}Session Brief — ${b.ref}`, "title");
  add(`${o.seasonName}`);
  add(`Last updated: ${new Date().toLocaleString("en-US", { timeZone: tz })} ${tzAbbrev(new Date(), tz)} · form version ${b.intakeVersion}`);
  add("");
  add("Appointment", "h2");
  add(formatWhen(b.startsAt, tz));
  add(b.quote.location ? `Location: ${b.quote.location}` : "Location: (not set)");
  add("");
  add("Money", "h2");
  for (const m of money(b).split("\n")) add(m);
  add("");
  add("Client answers", "h2");
  for (const k of Object.keys(FIELD_LABELS) as FieldKey[]) add(`${FIELD_LABELS[k]}: ${displayField(b.intake, k)}`);
  add("");
  add("This Doc is a read-only mirror of the website form. Edit owner notes in the dashboard, not here; edits here are overwritten on the next save.");
  return L;
}
