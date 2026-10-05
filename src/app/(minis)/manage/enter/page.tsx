import type { Metadata } from "next";
import Enter from "./Enter";
export const metadata: Metadata = { title: "Opening your booking", robots: { index: false, follow: false } };
export default function Page() { return <Enter />; }
