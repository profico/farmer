import type { LucideIcon } from "lucide-react";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center px-6 py-10 text-center">
			<span className="flex size-13 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
				<Icon className="size-6" />
			</span>
			<p className="mt-4 text-[15px] font-semibold">{title}</p>
			{description && (
				<p className="mt-1.5 max-w-[230px] text-sm leading-relaxed text-muted-foreground">
					{description}
				</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}
