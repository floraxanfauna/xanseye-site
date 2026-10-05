import { getDb } from "../src/lib/db";
const db = await getDb();
const r = await db.query(`select name from _migrations order by name`);
console.log("Applied migrations:", r.rows.map((x) => x.name).join(", "));
process.exit(0);
