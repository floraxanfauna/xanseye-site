import type { Metadata } from "next";
import Manage from "./Manage";
export const metadata: Metadata = { title: "Your session", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function Page() { return <Manage />; }
