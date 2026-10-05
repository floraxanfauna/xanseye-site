import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPaymentProvider } from "@/lib/payments";
import DemoPay from "./DemoPay";

export const metadata: Metadata = { title: "Demo payment", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ bookingId: string }> }) {
  if (getPaymentProvider().name !== "demo") notFound(); // exists only while Stripe isn't connected
  const { bookingId } = await params;
  return <DemoPay bookingId={bookingId} />;
}
