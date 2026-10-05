import type { Metadata } from "next";
import Booked from "./Booked";
export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function Page() { return <Booked />; }
