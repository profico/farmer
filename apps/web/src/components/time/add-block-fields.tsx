import { parseDuration, snapToQuarterHour } from "@farmer/core/lib/time";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CalendarDotIcon,
	CaretRightIcon,
	GitPullRequestIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import type { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
import { DateJump, stepperClass } from "#/components/time/time-toolbar.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import { DialogClose, DialogFooter } from "#/components/ui/dialog.tsx";
import {
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { formatClock } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import type { listMyProjects } from "#/server/projects.ts";

import {
	dialogDateLabel,
	type FormValues,
	NO_PROJECT_YET,
	QUICK_DURATIONS,
	TIME_OFF,
} from "./add-block-form.ts";

type Form = UseFormReturn<FormValues>;
type HeightTransition = React.ComponentProps<typeof motion.div>["transition"];

// The timesheet's ‹ date › stepper, so the day can change without closing the
// dialog: yesterday's work logged today, or an entry moved to the day it
// belongs to.
export function DateStepper({
	targetDate,
	dayLocked,
	onSetDate,
	onStep,
}: {
	targetDate: string;
	dayLocked: boolean;
	onSetDate: (next: string) => void;
	onStep: (days: number) => void;
}) {
	return (
		<>
			<div className="flex h-8 w-fit items-center rounded-lg border text-sm">
				<button
					type="button"
					className={cn(
						stepperClass,
						"disabled:pointer-events-none disabled:opacity-40",
					)}
					aria-label="Previous day"
					disabled={dayLocked}
					onClick={() => onStep(-1)}
				>
					<ArrowLeftIcon weight="regular" className="size-4" />
				</button>
				<span className="flex items-center gap-1.5 border-x px-3 font-medium whitespace-nowrap">
					{!dayLocked && <DateJump value={targetDate} onPick={onSetDate} />}
					{dialogDateLabel(targetDate)}
				</span>
				<button
					type="button"
					className={cn(
						stepperClass,
						"disabled:pointer-events-none disabled:opacity-40",
					)}
					aria-label="Next day"
					disabled={dayLocked}
					onClick={() => onStep(1)}
				>
					<ArrowRightIcon weight="regular" className="size-4" />
				</button>
			</div>
			{dayLocked && (
				<p className="text-xs text-muted-foreground">
					Its GitHub activity keeps this entry on this day.
				</p>
			)}
		</>
	);
}

// An unfiled entry's "no project" row is "not yet", and keeps it worked time;
// anywhere else it is Time-off. Same row, different answer.
function changeProject(
	form: Form,
	field: ControllerRenderProps<FormValues, "projectId">,
	next: string | null,
	unfiledEdit: boolean,
) {
	if (unfiledEdit) {
		field.onChange(next ?? NO_PROJECT_YET);
		return;
	}
	const wasTimeOff = field.value === TIME_OFF;
	field.onChange(next ?? TIME_OFF);
	// A day off is a whole day until told otherwise; leaving Time-off takes the
	// prefill back out.
	if (next === null) {
		form.setValue("duration", "8:00");
	} else if (wasTimeOff && form.getValues("duration") === "8:00") {
		form.setValue("duration", "");
	}
}

type ProjectTaskFieldsProps = {
	form: Form;
	projects: Awaited<ReturnType<typeof listMyProjects>>;
	unfiledEdit: boolean;
	isTimeOff: boolean;
	tasks: React.ComponentProps<typeof TaskPicker>["tasks"];
	pickableTasks: React.ComponentProps<typeof TaskPicker>["tasks"];
	recentIds: string[];
};

// Project then task, side by side from `sm`: the project decides the task
// list, so they read left to right as one choice made in two steps. Stacked
// under a single "Project / Task" label they read as one control that had been
// cut in half, and neither half carried a name of its own.
//
// The same two columns as the note and duration below, so Task is exactly as
// wide as Duration and the two rows share one edge. `minmax(0,1fr)`, not
// `1fr`: a column sized `1fr` is `minmax(auto,1fr)`, so its item's min-content
// width is a floor and one long project name pushes the column past the dialog
// and over the task picker beside it.
export function ProjectTaskFields({
	form,
	projects,
	unfiledEdit,
	isTimeOff,
	tasks,
	pickableTasks,
	recentIds,
}: ProjectTaskFieldsProps) {
	return (
		<div className="grid gap-1.5">
			<div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_10.75rem]">
				<FormField
					control={form.control}
					name="projectId"
					render={({ field }) => (
						// `grid-rows-[auto_1fr]` plus `h-full` on the trigger: the label
						// row stays its own height and the picker takes the rest, so the
						// two triggers are as tall as each other whatever is in them — a
						// project with no client, or a task whose group this build does
						// not know, no longer leaves one box shorter than the one beside
						// it. An error is drawn inside the box, so it never adds a row
						// under either of them.
						<FormItem className="grid-rows-[auto_1fr] gap-2">
							<FormLabel>Project</FormLabel>
							<FormControl>
								<ProjectPicker
									aria-label="Project"
									className="h-full"
									projects={projects}
									noProject={unfiledEdit ? "No project yet" : "Time-off"}
									value={
										field.value === TIME_OFF || field.value === NO_PROJECT_YET
											? null
											: field.value
									}
									onValueChange={(next) =>
										changeProject(form, field, next, unfiledEdit)
									}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="taskId"
					render={({ field }) => (
						<FormItem className="grid-rows-[auto_1fr] gap-2">
							<FormLabel>Task</FormLabel>
							<FormControl>
								<TaskPicker
									aria-label="Task"
									className="h-full"
									tasks={pickableTasks}
									recentIds={recentIds}
									grouped={!isTimeOff}
									value={field.value}
									onValueChange={field.onChange}
									placeholder={
										tasks.length === 0 ? "Loading tasks…" : "Pick a task"
									}
									message={<FormMessage aria-hidden />}
								/>
							</FormControl>
						</FormItem>
					)}
				/>
			</div>
		</div>
	);
}

// Normalise on blur, the way the week grid's cells already do — "1.5" becomes
// "1:30", so what is on screen is what will be saved rather than a form the
// reader has to snap in their own head.
function normaliseDuration(
	field: ControllerRenderProps<FormValues, "duration">,
	text: string,
) {
	field.onBlur();
	const parsed = parseDuration(text);
	if (parsed !== null && parsed > 0) {
		field.onChange(formatClock(snapToQuarterHour(parsed)));
	}
}

function DurationField({ form }: { form: Form }) {
	return (
		<FormField
			control={form.control}
			name="duration"
			render={({ field }) => (
				<FormItem className="grid-rows-[auto_1fr] gap-2">
					<FormLabel>Duration</FormLabel>
					<div className="relative h-full">
						<FormControl>
							<Input
								{...field}
								placeholder="0:00"
								inputMode="decimal"
								className="mono h-full min-h-22 text-right text-[30px] font-medium tabular-nums"
								onBlur={(e) => normaliseDuration(field, e.target.value)}
							/>
						</FormControl>
						<FormMessage className="pointer-events-none absolute right-2.5 bottom-2" />
					</div>
				</FormItem>
			)}
		/>
	);
}

// Labelled like the field it stands in for, so the row keeps both its names.
// Main's dashed `--input` outline, not a tinted one: the preset below is
// already lit, and a second highlight here would say the same thing twice in
// two different colors.
function RestOfDayDuration() {
	return (
		<div className="grid grid-rows-[auto_1fr] gap-2">
			<span className="text-sm leading-none font-medium">Duration</span>
			<div className="flex min-h-22 items-center justify-center rounded-lg border border-dashed border-input px-3 text-center text-sm text-muted-foreground">
				Rest of day
			</div>
		</div>
	);
}

// What you did, and how long: side by side, the time box big enough to be the
// thing you read back. The duration stays to the RIGHT of the note, where it
// has always been — this is the most used form in the product and the hand
// knows where the box is.
//
// Both fields are `grid-rows-[auto_1fr]`, like the pair above: the label keeps
// its own height and the box takes the rest, so a note dragged taller takes the
// Duration box with it and leaves both labels where they were. Each error sits
// in its box's bottom corner, so neither box grows when one appears.
export function NoteAndDuration({
	form,
	askForNote,
	fillsDay,
}: {
	form: Form;
	askForNote: boolean;
	fillsDay: boolean;
}) {
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_10.75rem] gap-2.5 max-sm:grid-cols-[minmax(0,1fr)]">
			<FormField
				control={form.control}
				name="description"
				render={({ field }) => (
					<FormItem className="grid-rows-[auto_1fr] gap-2">
						<FormLabel>{askForNote ? "What you did" : "Note"}</FormLabel>
						<div className="relative">
							<FormControl>
								<Textarea
									rows={3}
									className="min-h-22 resize-y"
									placeholder={
										askForNote ? "What did you work on?" : "Optional…"
									}
									{...field}
								/>
							</FormControl>
							<FormMessage className="pointer-events-none absolute right-2.5 bottom-2" />
						</div>
					</FormItem>
				)}
			/>
			{fillsDay ? <RestOfDayDuration /> : <DurationField form={form} />}
		</div>
	);
}

const PRESET_BASE =
	"rounded-lg border py-2 text-sm font-medium transition-[background-color,border-color,color] duration-(--dur-fast) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16";

function DurationPreset({
	value,
	on,
	onPick,
}: {
	value: string;
	on: boolean;
	onPick: (value: string) => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={() => onPick(value)}
			// The same `--input` hairline, hover and focus ring the pickers and the
			// boxes above wear. Unbordered they read as chips dropped under a row of
			// outlined controls — the one row on the form drawn to a rule of its own.
			className={cn(
				"tnum",
				PRESET_BASE,
				on
					? "border-primary/35 bg-primary/12 text-primary"
					: "border-input bg-transparent text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground",
			)}
		>
			{value}
		</button>
	);
}

function RestOfDayPreset({
	fillsDay,
	dayHasFill,
	onToggle,
}: {
	fillsDay: boolean;
	dayHasFill: boolean;
	onToggle: () => void;
}) {
	const blocked = dayHasFill && !fillsDay;
	return (
		<button
			type="button"
			aria-pressed={fillsDay}
			disabled={blocked}
			title={
				blocked
					? "This day already has a rest-of-day block — edit or delete that one instead."
					: "Fills the rest of your working hours, minus everything else logged that day."
			}
			onClick={onToggle}
			// Not highlighted at rest. It used to carry an accent tint while
			// switched OFF, which reads as selected — the one thing a control must
			// not do when it is not.
			className={cn(
				PRESET_BASE,
				"disabled:pointer-events-none disabled:opacity-40",
				fillsDay
					? "border-primary/35 bg-primary/12 font-semibold text-primary"
					: "border-input bg-transparent text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground",
			)}
		>
			Rest of day
		</button>
	);
}

// What Rest of day means, only while it is chosen. As permanent small print it
// explained a control most readers had not picked; the four numbers beside it
// need no gloss at all.
//
// On a height spring, the same one the Repeat and More options disclosures
// below ride: appearing and disappearing, this line is the only thing on the
// form that changes the dialog's height, and the popup is centred — so a snap
// moves every field under the pointer by half the line. It sits INSIDE the
// preset row's wrapper rather than beside it as another grid child, because a
// collapsed grid row still contributes the parent's gap: the caption would
// reach zero height and leave 12px of its own behind, which is the jump again,
// smaller.
function RestOfDayHint({
	fillsDay,
	heightTransition,
}: {
	fillsDay: boolean;
	heightTransition: HeightTransition;
}) {
	return (
		<AnimatePresence initial={false}>
			{fillsDay && (
				<motion.div
					key="fills-day-hint"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={heightTransition}
					className="overflow-hidden"
				>
					<p className="pt-3 text-sm text-muted-foreground">
						Fills the rest of your working hours, minus everything else logged
						that day.
					</p>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

// The lengths, across the width of the pair above. Four numbers and "Rest of
// day", which is a different kind of answer and is set apart as one by its
// words rather than by a treatment of its own. A preset writes the field
// instead of opening something, so the commonest case is one click and the box
// still takes anything typed.
//
// The lengths show whatever the project is. `isTimeOff` would have been the
// obvious gate and is the wrong one: it means "no project picked", which is
// the state every fresh dialog opens in, so the row would be missing exactly
// when it is most useful. Rest of day is the part that is conditional — an
// absence has no fill block, and Repeat hid its switch for the same reason.
export function DurationPresets({
	form,
	fillsDay,
	durationValue,
	showFillPreset,
	dayHasFill,
	heightTransition,
}: {
	form: Form;
	fillsDay: boolean;
	durationValue: string;
	showFillPreset: boolean;
	dayHasFill: boolean;
	heightTransition: HeightTransition;
}) {
	const pickLength = (value: string) => {
		form.setValue("fillsDay", false, { shouldDirty: true });
		form.setValue("duration", value, {
			shouldDirty: true,
			shouldValidate: true,
		});
	};
	return (
		<div>
			<div
				className={cn(
					"grid gap-1.5",
					showFillPreset ? "grid-cols-[repeat(4,1fr)_1.6fr]" : "grid-cols-4",
				)}
			>
				{QUICK_DURATIONS.map((value) => (
					<DurationPreset
						key={value}
						value={value}
						on={!fillsDay && durationValue === value}
						onPick={pickLength}
					/>
				))}
				{showFillPreset && (
					<RestOfDayPreset
						fillsDay={fillsDay}
						dayHasFill={dayHasFill}
						onToggle={() =>
							form.setValue("fillsDay", !fillsDay, { shouldDirty: true })
						}
					/>
				)}
			</div>
			<RestOfDayHint fillsDay={fillsDay} heightTransition={heightTransition} />
		</div>
	);
}

type RepeatOptionsProps = {
	form: Form;
	repeatEnabled: boolean;
	daysOfWeek: number[];
	daysError: string | undefined;
	weekdays: ReadonlyArray<{ day: number; initial: string }>;
	onToggleDay: (day: number) => void;
	heightTransition: HeightTransition;
};

function RepeatDays({
	daysOfWeek,
	daysError,
	weekdays,
	onToggleDay,
}: Pick<
	RepeatOptionsProps,
	"daysOfWeek" | "daysError" | "weekdays" | "onToggleDay"
>) {
	return (
		<div className="flex items-center gap-1">
			{weekdays.map(({ day, initial }) => (
				<button
					key={day}
					type="button"
					onClick={() => onToggleDay(day)}
					className={cn(
						"mono size-7 rounded-full border text-xs transition-colors duration-(--dur-fast)",
						daysOfWeek.includes(day)
							? "border-primary bg-primary text-primary-foreground"
							: "border-border bg-background text-muted-foreground",
					)}
				>
					{initial}
				</button>
			))}
			{daysError && (
				<span className="ms-auto text-xs text-destructive">{daysError}</span>
			)}
		</div>
	);
}

function RepeatOptions({
	form,
	repeatEnabled,
	daysOfWeek,
	daysError,
	weekdays,
	onToggleDay,
	heightTransition,
}: RepeatOptionsProps) {
	return (
		<div className="py-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<span className="text-base font-medium">Repeat</span>
					<p className="text-sm text-muted-foreground">
						Log this every week on the days you pick.
					</p>
				</div>
				<Switch
					checked={repeatEnabled}
					onCheckedChange={(checked) => form.setValue("repeatEnabled", checked)}
				/>
			</div>
			<AnimatePresence initial={false}>
				{repeatEnabled && (
					<motion.div
						key="repeat-options"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={heightTransition}
						className="overflow-hidden"
					>
						<div className="mt-3 flex flex-col gap-3">
							{/* The days have no box to hold an error, so it sits at the end
							    of their row — as it does at the end of an input's line — and
							    the row never grows. */}
							<RepeatDays
								daysOfWeek={daysOfWeek}
								daysError={daysError}
								weekdays={weekdays}
								onToggleDay={onToggleDay}
							/>
							<FormField
								control={form.control}
								name="repeatEndDate"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="text-xs">Ends (optional)</FormLabel>
										<FormControl>
											{/* Genuinely optional — a repeat with no end date runs
											    until it is removed. */}
											<DatePicker
												aria-label="Repeat ends"
												placeholder="No end date"
												clearable
												value={field.value || null}
												onValueChange={(next) => field.onChange(next ?? "")}
											/>
										</FormControl>
									</FormItem>
								)}
							/>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function OvertimeRow({ form }: { form: Form }) {
	return (
		<div className="flex items-center justify-between gap-3 py-3">
			<div className="min-w-0">
				<span className="text-base font-medium">Overtime</span>
				<p className="text-sm text-muted-foreground">
					Flag it yourself — nothing is counted as overtime automatically.
				</p>
			</div>
			<FormField
				control={form.control}
				name="overtime"
				render={({ field }) => (
					<Switch checked={field.value} onCheckedChange={field.onChange} />
				)}
			/>
		</div>
	);
}

type MoreOptionsProps = RepeatOptionsProps & {
	moreOpen: boolean;
	onToggleMore: () => void;
	activeOptions: string[];
	showRepeatSection: boolean;
};

// A disclosure, not a bare conditional render, for the same reason the Repeat
// block inside it is one: opening it must not jump the footer out from under
// the pointer.
export function MoreOptions({
	moreOpen,
	onToggleMore,
	activeOptions,
	showRepeatSection,
	...repeat
}: MoreOptionsProps) {
	const { form, heightTransition } = repeat;
	return (
		<div className="border-t border-line2 pt-2">
			<button
				type="button"
				onClick={onToggleMore}
				aria-expanded={moreOpen}
				className="flex items-center gap-1.5 rounded-md py-1 text-base text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/16"
			>
				<CaretRightIcon
					weight="regular"
					className={cn(
						"size-3.5 transition-transform duration-(--dur-base)",
						moreOpen && "rotate-90",
					)}
				/>
				More options
				{activeOptions.length > 0 && (
					<span className="ml-1 flex flex-wrap gap-1">
						{activeOptions.map((option) => (
							<Badge key={option} variant="secondary">
								{option}
							</Badge>
						))}
					</span>
				)}
			</button>
			<AnimatePresence initial={false}>
				{moreOpen && (
					<motion.div
						key="more-options"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={heightTransition}
						className="overflow-hidden"
					>
						<div className="grid divide-y divide-line2 pt-1">
							{/* Overtime and Repeat, and nothing else. "Fill rest of day" left
							    this disclosure to become the fifth preset under the duration
							    field, which is where somebody looking for it actually looks —
							    behind a fold, the one control that sizes a block from the
							    day's remainder was a feature nobody found. */}
							{showRepeatSection && <RepeatOptions {...repeat} />}
							<OvertimeRow form={form} />
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

// Wraps as a whole: when the row is too narrow the links take a line of their
// own, instead of the group squeezing and putting each link on its own line.
export function FooterActions({
	showCalendarPicker,
	showCommitPicker,
	onToggleCalendar,
	onToggleActivity,
	saveText,
	saving,
	modKey,
}: {
	showCalendarPicker: boolean;
	showCommitPicker: boolean;
	onToggleCalendar: () => void;
	onToggleActivity: () => void;
	saveText: string;
	saving: boolean;
	modKey: string;
}) {
	return (
		<DialogFooter className="sm:flex-wrap">
			{(showCalendarPicker || showCommitPicker) && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:mr-auto sm:flex-nowrap">
					{showCalendarPicker && (
						<Button
							type="button"
							variant="link"
							size="sm"
							className="px-0"
							onClick={onToggleCalendar}
						>
							<CalendarDotIcon className="size-4" />
							Pull in a calendar event
						</Button>
					)}
					{showCommitPicker && (
						<Button
							type="button"
							variant="link"
							size="sm"
							className="px-0"
							onClick={onToggleActivity}
						>
							<GitPullRequestIcon className="size-4" />
							Pull in GitHub activity
						</Button>
					)}
				</div>
			)}
			<DialogClose render={<Button type="button" variant="ghost" />}>
				Cancel
			</DialogClose>
			<Button type="submit" disabled={saving}>
				{saveText}
				<kbd className="mono rounded-sm bg-primary-foreground/22 px-1 text-2xs">
					{modKey}↩
				</kbd>
			</Button>
		</DialogFooter>
	);
}
