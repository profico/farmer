import {
	boolean,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { session, user } from "./auth";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

export const mobilePlatform = pgEnum("mobile_platform", ["ios", "android"]);

// One phone of one person, for native push through the relay (ADR 0006,
// `docs/domains/mobile.md`).
//
// **No `organization_id`.** This is the third deliberate exception to the
// tenancy rule, after `push_subscription` and `running_timer`. A phone belongs
// to a person, and the timer whose Live Activity it shows is one for each
// person across workspaces (ADR 0003). `notify` still names an organization
// for each message, and checks the membership before it reads this table.
//
// The row belongs to the sign-in session that registered it. When that session
// ends (sign-out, a revoke on Preferences, an expiry that better-auth cleans
// up), the cascade removes the row, and the phone gets no more pushes.
export const mobileDevice = pgTable(
	"mobile_device",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// The app makes this id one time for each installation. It is not a
		// secret: it only tells two installations of one person apart.
		installationId: text("installation_id").notNull(),
		platform: mobilePlatform("platform").notNull(),
		// The relay's opaque id for the phone. Only this server knows it, which
		// is the relay's only check on who may push to the phone.
		relayId: text("relay_id").notNull(),
		// The phone's P-256 public key: the 65-byte uncompressed point, as
		// base64url. Each push is sealed with it (`@farmer/push-crypto`).
		publicKey: text("public_key").notNull(),
		appVersion: text("app_version").notNull(),
		sessionId: text("session_id")
			.notNull()
			.references(() => session.id, { onDelete: "cascade" }),
		// The push token of the Live Activity that is open now (iOS only). Null
		// when no activity is open: a timer start then uses push-to-start.
		liveActivityToken: text("live_activity_token"),
		// Whether the person let the app show notifications. A phone without
		// permission still gets the Live Activity, but no alerts.
		notificationsAllowed: boolean("notifications_allowed")
			.notNull()
			.default(false),
		createdAt: ts("created_at").notNull().defaultNow(),
		updatedAt: ts("updated_at").notNull().defaultNow(),
	},
	(t) => [
		unique("mobile_device_user_installation_unq").on(
			t.userId,
			t.installationId,
		),
		index("mobile_device_session_idx").on(t.sessionId),
		index("mobile_device_relay_idx").on(t.relayId),
	],
);
