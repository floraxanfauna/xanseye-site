import type { Metadata } from "next";
import Verify from "./Verify";
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };
export default function Page() { return <Verify />; }
