import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import { googleAction, overview } from "@/lib/admin-api";
import { getGoogleIntegration } from "@/lib/google/client";
import { setup } from "./helpers";

describe("blocking calendars selection", () => {
  beforeEach(async () => { await setup({ google: true }); });
  it("is saved, survives a reload, and the dedicated calendar is never a blocker", async () => {
    const db = await getDb();
    await db.query(`insert into integrations(provider, status, account_email, tokens_enc, meta) values ('google','connected','x@y.com','enc', $1)`, [JSON.stringify({ calendarId: "dedicated@group.calendar.google.com" })]);
    await googleAction("conflicts", { ids: ["primary@gmail.com", "dedicated@group.calendar.google.com", "family@group.calendar.google.com"] });
    const g = await getGoogleIntegration();
    expect(g!.meta.conflictCalendarIds).toEqual(["primary@gmail.com", "family@group.calendar.google.com"]);
    expect(g!.meta.calendarId).toBe("dedicated@group.calendar.google.com");
    const ov = await overview();
    expect(ov.integrations.google.conflictCalendarIds).toEqual(["primary@gmail.com", "family@group.calendar.google.com"]);
    // saving again with fewer replaces, not appends
    await googleAction("conflicts", { ids: ["family@group.calendar.google.com"] });
    expect((await getGoogleIntegration())!.meta.conflictCalendarIds).toEqual(["family@group.calendar.google.com"]);
  });
});
