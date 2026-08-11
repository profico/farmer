import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./schema/auth";
import * as closeSchema from "./schema/close";
import * as domainSchema from "./schema/domain";
import * as githubSchema from "./schema/github";
import * as notificationsSchema from "./schema/notifications";
import * as peopleSchema from "./schema/people";
import * as scheduleSchema from "./schema/schedule";
import * as settingsSchema from "./schema/settings";
import * as slackSchema from "./schema/slack";

const schema = {
	...authSchema,
	...domainSchema,
	...peopleSchema,
	...scheduleSchema,
	...closeSchema,
	...githubSchema,
	...settingsSchema,
	...notificationsSchema,
	...slackSchema,
};

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });
