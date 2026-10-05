import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentOwner } from "@/lib/auth";
import AdminNav from "@/components/admin/AdminNav";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await currentOwner();
  if (!owner) redirect("/admin/login");
  return (
    <>
      <AdminNav email={owner.email} />
      <main className="wrap admin-main">{children}</main>
    </>
  );
}
