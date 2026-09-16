import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The mark at the head of an entry line — the project's own icon, so a
 * timesheet reads as a list of projects rather than a column of dots.
 *
 * It used to be the task's color dot on every line, which is the same argument
 * `ProjectIcon` already settled on the projects page: five dots in five shades
 * of the same muted palette tell five projects apart about as well as no dots
 * at all, while a logo is recognised before the name is read.
 *
 * An entry with no project — time off, a break, a meeting nobody has filed yet
 * — keeps the color dot, because there is no project to draw. It is drawn
 * inside the icon's own footprint rather than on its own, so a mixed list still
 * has one text edge.
 */
export function EntryMark({
	project,
	taskColor,
	className,
}: {
	project: { name: string; icon?: string | null } | null;
	taskColor: string | null;
	className?: string;
}) {
	if (project) {
		return (
			<ProjectIcon
				icon={project.icon}
				name={project.name}
				size="sm"
				className={className}
			/>
		);
	}
	return (
		<span
			aria-hidden
			className={cn(
				"inline-grid size-7 shrink-0 place-items-center rounded-md border border-line2 bg-secondary",
				className,
			)}
		>
			<span
				className="size-2 rounded-full"
				style={{ backgroundColor: taskColor ?? "var(--muted-foreground)" }}
			/>
		</span>
	);
}
