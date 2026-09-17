import { sql } from "drizzle-orm";

import { db } from "./index";

const result = await db.execute(sql`select 1 as ok`);

console.log("db:check ->", result[0]);

process.exit(0);
