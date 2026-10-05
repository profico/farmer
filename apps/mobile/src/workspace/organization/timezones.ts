/**
 * The IANA timezones for the picker. The engine's own list is used when it
 * has one. Hermes may lack `Intl.supportedValuesOf`, so a static list of the
 * canonical zones is the fallback.
 */

const STATIC_ZONES = [
	"UTC",
	"Africa/Abidjan",
	"Africa/Accra",
	"Africa/Addis_Ababa",
	"Africa/Algiers",
	"Africa/Cairo",
	"Africa/Casablanca",
	"Africa/Dar_es_Salaam",
	"Africa/Johannesburg",
	"Africa/Khartoum",
	"Africa/Kinshasa",
	"Africa/Lagos",
	"Africa/Luanda",
	"Africa/Maputo",
	"Africa/Nairobi",
	"Africa/Tripoli",
	"Africa/Tunis",
	"Africa/Windhoek",
	"America/Adak",
	"America/Anchorage",
	"America/Argentina/Buenos_Aires",
	"America/Asuncion",
	"America/Bogota",
	"America/Caracas",
	"America/Chicago",
	"America/Costa_Rica",
	"America/Denver",
	"America/Edmonton",
	"America/Guatemala",
	"America/Halifax",
	"America/Havana",
	"America/Jamaica",
	"America/La_Paz",
	"America/Lima",
	"America/Los_Angeles",
	"America/Mexico_City",
	"America/Montevideo",
	"America/New_York",
	"America/Panama",
	"America/Phoenix",
	"America/Puerto_Rico",
	"America/Santiago",
	"America/Santo_Domingo",
	"America/Sao_Paulo",
	"America/St_Johns",
	"America/Toronto",
	"America/Vancouver",
	"America/Winnipeg",
	"Antarctica/McMurdo",
	"Asia/Almaty",
	"Asia/Amman",
	"Asia/Baghdad",
	"Asia/Baku",
	"Asia/Bangkok",
	"Asia/Beirut",
	"Asia/Colombo",
	"Asia/Dhaka",
	"Asia/Dubai",
	"Asia/Ho_Chi_Minh",
	"Asia/Hong_Kong",
	"Asia/Jakarta",
	"Asia/Jerusalem",
	"Asia/Kabul",
	"Asia/Karachi",
	"Asia/Kathmandu",
	"Asia/Kolkata",
	"Asia/Kuala_Lumpur",
	"Asia/Kuwait",
	"Asia/Manila",
	"Asia/Riyadh",
	"Asia/Seoul",
	"Asia/Shanghai",
	"Asia/Singapore",
	"Asia/Taipei",
	"Asia/Tashkent",
	"Asia/Tbilisi",
	"Asia/Tehran",
	"Asia/Tokyo",
	"Asia/Ulaanbaatar",
	"Asia/Vladivostok",
	"Asia/Yangon",
	"Asia/Yekaterinburg",
	"Asia/Yerevan",
	"Atlantic/Azores",
	"Atlantic/Canary",
	"Atlantic/Reykjavik",
	"Australia/Adelaide",
	"Australia/Brisbane",
	"Australia/Darwin",
	"Australia/Hobart",
	"Australia/Melbourne",
	"Australia/Perth",
	"Australia/Sydney",
	"Europe/Amsterdam",
	"Europe/Athens",
	"Europe/Belgrade",
	"Europe/Berlin",
	"Europe/Bratislava",
	"Europe/Brussels",
	"Europe/Bucharest",
	"Europe/Budapest",
	"Europe/Chisinau",
	"Europe/Copenhagen",
	"Europe/Dublin",
	"Europe/Helsinki",
	"Europe/Istanbul",
	"Europe/Kyiv",
	"Europe/Lisbon",
	"Europe/Ljubljana",
	"Europe/London",
	"Europe/Luxembourg",
	"Europe/Madrid",
	"Europe/Malta",
	"Europe/Minsk",
	"Europe/Moscow",
	"Europe/Oslo",
	"Europe/Paris",
	"Europe/Podgorica",
	"Europe/Prague",
	"Europe/Riga",
	"Europe/Rome",
	"Europe/Sarajevo",
	"Europe/Skopje",
	"Europe/Sofia",
	"Europe/Stockholm",
	"Europe/Tallinn",
	"Europe/Tirane",
	"Europe/Vienna",
	"Europe/Vilnius",
	"Europe/Warsaw",
	"Europe/Zagreb",
	"Europe/Zurich",
	"Indian/Maldives",
	"Indian/Mauritius",
	"Pacific/Auckland",
	"Pacific/Fiji",
	"Pacific/Guam",
	"Pacific/Honolulu",
	"Pacific/Port_Moresby",
	"Pacific/Tongatapu",
] as const;

/** The IANA zones of the engine, or the static list. The current zone is
 *  always in the list, so a zone that the list lacks still shows as chosen. */
export const timezoneList = (current: string): string[] => {
	let zones: readonly string[] = STATIC_ZONES;
	try {
		const listed = Intl.supportedValuesOf("timeZone");
		if (listed.length > 0) zones = listed;
	} catch {
		// The engine has no `supportedValuesOf`. The static list stays.
	}
	return [...new Set(["UTC", ...zones, current])];
};

/** The offset now, such as "GMT+02:00", or "" when the engine cannot
 *  tell. */
export const offsetOf = (timeZone: string, now: Date) => {
	try {
		return (
			new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
				.formatToParts(now)
				.find((part) => part.type === "timeZoneName")?.value ?? ""
		);
	} catch {
		return "";
	}
};
