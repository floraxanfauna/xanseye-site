import sharp, { type Sharp, type Metadata } from "sharp";
import { getDb } from "./db";
import { AppError } from "./core";

/**
 * Photos live in the database (bytea) so they survive redeploys and are backed up with everything else.
 * Uploads are verified by their real file signature (not the filename or the browser's claimed type),
 * re-encoded (which strips metadata/EXIF GPS and any embedded payload) and capped in size.
 */
const MAX_BYTES = 12 * 1024 * 1024;

export async function saveAsset(input: Buffer, o: { alt?: string; isDemo?: boolean; keepPng?: boolean } = {}) {
  if (input.length > MAX_BYTES) throw new AppError("too_big", "That photo is too large (12 MB max).", 413);
  let img: Sharp;
  let meta: Metadata;
  try {
    img = sharp(input, { failOn: "error", limitInputPixels: 80_000_000 });
    meta = await img.metadata();
  } catch {
    throw new AppError("bad_image", "That file doesn't look like a photo. Use a JPG, PNG or WebP.", 415);
  }
  if (!["jpeg", "png", "webp"].includes(meta.format ?? "")) throw new AppError("bad_image", "Please use a JPG, PNG or WebP photo.", 415);

  const resized = img.rotate().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true });
  const png = o.keepPng || meta.format === "png" && meta.hasAlpha;
  const { data, info } = png
    ? await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const db = await getDb();
  const r = await db.query(
    `insert into assets(mime, bytes, width, height, alt, is_demo) values ($1,$2,$3,$4,$5,$6) returning id`,
    [png ? "image/png" : "image/jpeg", data, info.width, info.height, o.alt ?? "", o.isDemo ?? false],
  );
  return { id: r.rows[0].id as string, width: info.width, height: info.height };
}

export async function getAsset(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const r = await db.query(`select mime, bytes, is_demo from assets where id=$1`, [id]);
  return r.rows[0] ? { mime: r.rows[0].mime as string, bytes: r.rows[0].bytes as Uint8Array, isDemo: r.rows[0].is_demo as boolean } : null;
}

export async function listAssets() {
  const db = await getDb();
  return (await db.query(`select id, alt, is_demo, width, height, created_at from assets order by created_at desc limit 200`)).rows;
}
export async function deleteAsset(id: string) {
  const db = await getDb();
  await db.query(`delete from assets where id=$1`, [id]);
}
