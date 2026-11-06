import { parseArgs } from "node:util";

import { newServerKey } from "./server-keys";
import type { DeviceStore } from "./store";

const USAGE = `Usage: admin keys <command>

  create --label <text> --contact <email> --monthly-limit <number>
  list
  revoke <id>
  set-limit <id> <number>`;

const parseLimit = (text: string | undefined): number => {
	const limit = Number(text);
	if (!Number.isInteger(limit) || limit < 0) {
		throw new Error("The monthly limit must be a whole number, 0 or more.");
	}
	return limit;
};

const create = (store: DeviceStore, args: string[], now: number): string[] => {
	const { values } = parseArgs({
		args,
		options: {
			label: { type: "string" },
			contact: { type: "string" },
			"monthly-limit": { type: "string" },
		},
	});
	if (!values.label || !values.contact) {
		throw new Error("Give --label and --contact.");
	}
	const limit = parseLimit(values["monthly-limit"]);
	const minted = newServerKey();
	store.insertServerKey({
		id: minted.id,
		secretHash: minted.hash,
		label: values.label,
		contact: values.contact,
		monthlyLimit: limit,
		createdAt: now,
		revokedAt: null,
	});
	return [
		`id: ${minted.id}`,
		`key: ${minted.key}`,
		"The relay keeps only a hash. Copy the key now: it is not shown again.",
	];
};

const list = (store: DeviceStore, now: number): string[] =>
	store
		.listServerKeys()
		.map(
			(key) =>
				`${key.id}  ${key.revokedAt === null ? "active " : "revoked"}  ` +
				`${store.usage(key.id, now)}/${key.monthlyLimit} this month  ` +
				`${key.label} <${key.contact}>`,
		);

const known = (found: boolean, id: string): string[] => {
	if (!found) throw new Error(`No server key has the id ${id}.`);
	return ["done"];
};

/**
 * Run one admin command. Returns the lines to print. Throws an `Error` with
 * a message for the operator when the input is wrong.
 */
export const runAdmin = (
	argv: string[],
	store: DeviceStore,
	now: number,
): string[] => {
	const [group, command, ...rest] = argv;
	if (group !== "keys") throw new Error(USAGE);
	switch (command) {
		case "create":
			return create(store, rest, now);
		case "list":
			return list(store, now);
		case "revoke":
			return known(store.revokeServerKey(rest[0] ?? "", now), rest[0] ?? "");
		case "set-limit":
			return known(
				store.setServerKeyLimit(rest[0] ?? "", parseLimit(rest[1])),
				rest[0] ?? "",
			);
		default:
			throw new Error(USAGE);
	}
};
