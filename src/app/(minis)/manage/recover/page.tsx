import type { Metadata } from "next";
import Recover from "./Recover";
export const metadata: Metadata = { title: "Manage your session", robots: { index: false, follow: false } };
export default function Page() { return <Recover />; }
