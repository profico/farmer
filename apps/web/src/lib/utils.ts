import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// "Northwind Studio" -> "NS", "Mara Reyes" -> "MR", "solo" -> "SO".
export function getInitials(name: string): string {
	const [first, second] = name.trim().split(/\s+/).filter(Boolean);
	if (!first) return "";
	if (!second) return first.slice(0, 2).toUpperCase();
	return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}
