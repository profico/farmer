import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./schema/auth";
import * as domainSchema from "./schema/domain";
import * as githubSchema from "./schema/github";
import * as scheduleSchema from "./schema/schedule";
import * as settingsSchema from "./schema/settings";

const schema = {
	...authSchema,
	...domainSchema,
	...scheduleSchema,
	...githubSchema,
	...settingsSchema,
};

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });
