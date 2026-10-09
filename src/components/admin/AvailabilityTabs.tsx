"use client";
import { useState } from "react";
import ScheduleView from "./ScheduleView";
import AvailabilityView from "./AvailabilityView";
import SlotEditor from "./SlotEditor";

export default function AvailabilityTabs() {
  const [tab, setTab] = useState<"weekly" | "dates" | "edit">("weekly");
  return (
    <div className="stack">
      <h1 style={{ marginBottom: 0 }}>Availability</h1>
      <p className="muted" style={{ margin: 0 }}>Set your usual hours once, then publish. Only published times can be booked; free time on your calendar is never made public automatically.</p>
      <div className="row" role="tablist" aria-label="How to set availability">
        <button role="tab" aria-selected={tab === "weekly"} className={`btn btn-sm ${tab === "weekly" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("weekly")}>Weekly schedule</button>
        <button role="tab" aria-selected={tab === "edit"} className={`btn btn-sm ${tab === "edit" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("edit")}>Edit individual times</button>
        <button role="tab" aria-selected={tab === "dates"} className={`btn btn-sm ${tab === "dates" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("dates")}>Add several dates at once</button>
      </div>
      {tab === "weekly" ? <ScheduleView /> : tab === "edit" ? <SlotEditor /> : <AvailabilityView embedded />}
    </div>
  );
}
