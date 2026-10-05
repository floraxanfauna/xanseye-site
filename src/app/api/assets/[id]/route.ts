import { type NextRequest } from "next/server";
import { getAsset } from "@/lib/assets";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await getAsset(id);
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(a.bytes as unknown as BodyInit, {
    headers: { "Content-Type": a.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
  });
}
