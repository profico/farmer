import type { Rewind } from "@farmer/api-client";
import { type ReactNode, useEffect, useState } from "react";
import {
	Animated,
	Easing,
	Text,
	type TextStyle,
	useWindowDimensions,
	View,
} from "react-native";

import { Rise, useCountUp, useEntrance, useSlideMotion } from "./motion";
import {
	busiestMonth,
	changeFromLastYear,
	formatNumber,
	groupLabel,
	longDay,
	monthName,
	personaFor,
	plural,
	sharePercent,
	shortDay,
	strongestWeekday,
	summaryTiles,
	tenthHours,
	weekdayName,
	wholeHours,
} from "./story";
import {
	GROUP_COLORS,
	MONO,
	type RewindTheme,
	SERIF,
	withAlpha,
} from "./theme";

// The slides of a Rewind. Each is one colour and one idea, in large type:
// the serif names the moment, and the monospace carries the number. The
// words are the words of the web Rewind.

type SlideProps = { rewind: Rewind; theme: RewindTheme };

const GAP = 20;

/** The size of the type that is the slide, from the width of the screen. */
const useScale = () => {
	const { width } = useWindowDimensions();
	return (factor: number, max: number) => Math.min(max, width * factor);
};

function Eyebrow({
	theme,
	children,
}: {
	theme: RewindTheme;
	children: string;
}) {
	return (
		<Text
			accessibilityRole="header"
			style={{
				color: theme.fg,
				opacity: 0.75,
				fontSize: 13,
				fontWeight: "600",
				letterSpacing: 2.4,
				textTransform: "uppercase",
			}}
		>
			{children}
		</Text>
	);
}

function Headline({
	theme,
	children,
}: {
	theme: RewindTheme;
	children: ReactNode;
}) {
	const scale = useScale();
	const size = scale(0.115, 64);
	return (
		<Text
			style={{
				color: theme.fg,
				fontFamily: SERIF,
				fontSize: size,
				lineHeight: size * 1.05,
			}}
		>
			{children}
		</Text>
	);
}

function Line({
	theme,
	children,
}: {
	theme: RewindTheme;
	children: ReactNode;
}) {
	return (
		<Text style={{ color: theme.fg, fontSize: 21, lineHeight: 28 }}>
			{children}
		</Text>
	);
}

function Note({
	theme,
	children,
}: {
	theme: RewindTheme;
	children: ReactNode;
}) {
	return (
		<Text
			style={{ color: theme.fg, opacity: 0.72, fontSize: 16, lineHeight: 22 }}
		>
			{children}
		</Text>
	);
}

function Mark({
	theme,
	children,
}: {
	theme: RewindTheme;
	children: ReactNode;
}) {
	return <Text style={{ color: theme.accent }}>{children}</Text>;
}

/** The number that is the slide, counted up from zero. A screen reader
 *  reads its final value, not the count. */
function Big({
	theme,
	value,
	format,
}: {
	theme: RewindTheme;
	value: number;
	format: (n: number) => string;
}) {
	const scale = useScale();
	const shown = useCountUp(value);
	const size = scale(0.26, 180);
	return (
		<Text
			accessibilityLabel={format(value)}
			adjustsFontSizeToFit
			numberOfLines={1}
			style={{
				color: theme.fg,
				fontFamily: MONO,
				fontSize: size,
				lineHeight: size * 1.05,
				letterSpacing: -size * 0.06,
				fontVariant: ["tabular-nums"],
			}}
		>
			{format(shown)}
		</Text>
	);
}

/** A bar that grows from nothing to its share when the slide comes on. */
function GrowBar({
	fraction,
	color,
	delay,
	height,
	vertical,
}: {
	fraction: number;
	color: string;
	delay: number;
	height: number;
	vertical?: boolean;
}) {
	const { active, reduce } = useSlideMotion();
	const [grow] = useState(() => new Animated.Value(0));
	useEffect(() => {
		if (!active) {
			grow.setValue(0);
			return;
		}
		const animation = Animated.timing(grow, {
			toValue: 1,
			delay: reduce ? 0 : delay,
			duration: reduce ? 0 : 900,
			easing: Easing.bezier(0.16, 1, 0.3, 1),
			// The bar has its size from the start and a scale grows it, so the
			// animation runs on the native thread.
			useNativeDriver: true,
		});
		animation.start();
		return () => animation.stop();
	}, [active, reduce, delay, grow]);
	const share = `${Math.max(0, Math.min(1, fraction)) * 100}%` as const;
	return (
		<Animated.View
			style={
				vertical
					? {
							width: "100%",
							height: share,
							backgroundColor: color,
							transformOrigin: "bottom",
							transform: [{ scaleY: grow }],
						}
					: {
							height,
							width: share,
							backgroundColor: color,
							transformOrigin: "left",
							transform: [{ scaleX: grow }],
						}
			}
		/>
	);
}

// ── Slides ──────────────────────────────────────────────────────────────

export function IntroSlide({
	rewind,
	theme,
	firstName,
}: SlideProps & { firstName: string }) {
	const scale = useScale();
	const size = scale(0.38, 260);
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>Farmer Rewind</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Text
					style={{
						color: theme.accent,
						fontFamily: SERIF,
						fontSize: size,
						lineHeight: size * 0.95,
					}}
				>
					{String(rewind.year)}
				</Text>
			</Rise>
			<Rise order={2}>
				<Line theme={theme}>{firstName}, this was your year in hours.</Line>
			</Rise>
			{rewind.complete ? null : (
				<Rise order={3}>
					<Note theme={theme}>
						The year is not over yet. The rest of it is projected from your pace
						so far.
					</Note>
				</Rise>
			)}
			<Rise order={4}>
				<Note theme={theme}>Swipe to continue.</Note>
			</Rise>
		</View>
	);
}

export function EmptySlide({
	rewind,
	theme,
	actions,
	otherYear,
}: SlideProps & {
	actions: ReactNode;
	/** The actions hold a pill for another year. Without it the slide does
	 *  not tell the person to try one. */
	otherYear: boolean;
}) {
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>{String(rewind.year)}</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Headline theme={theme}>Nothing logged in {rewind.year}.</Headline>
			</Rise>
			<Rise order={2}>
				<Line theme={theme}>
					{otherYear
						? "There is no year to rewind here. Try another one."
						: "There is no year to rewind here."}
				</Line>
			</Rise>
			<Rise order={3}>{actions}</Rise>
		</View>
	);
}

export function HoursSlide({ rewind, theme }: SlideProps) {
	const change = changeFromLastYear(rewind);
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>You logged</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Big
					theme={theme}
					value={rewind.workedSeconds}
					format={(n) => wholeHours(n)}
				/>
			</Rise>
			<Rise order={2}>
				<Headline theme={theme}>hours of work.</Headline>
			</Rise>
			<Rise order={3}>
				<Line theme={theme}>
					That is{" "}
					<Mark theme={theme}>
						{plural(Math.round(rewind.workedSeconds / 28_800), "working day")}
					</Mark>{" "}
					back to back.
					{change != null && change !== 0
						? ` ${change > 0 ? `${change}% more` : `${-change}% less`} than in ${rewind.year - 1}.`
						: ""}
				</Line>
			</Rise>
			{rewind.projectedWorkedSeconds != null ? (
				<Rise order={4}>
					<Note theme={theme}>
						At your pace, you finish {rewind.year} at about{" "}
						{wholeHours(rewind.projectedWorkedSeconds)} hours.
					</Note>
				</Rise>
			) : null}
		</View>
	);
}

export function DaysSlide({ rewind, theme }: SlideProps) {
	const streak = rewind.longestStreak;
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>You showed up on</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Big
					theme={theme}
					value={rewind.daysWorked}
					format={(n) => formatNumber(Math.round(n))}
				/>
			</Rise>
			<Rise order={2}>
				<Headline theme={theme}>days.</Headline>
			</Rise>
			{streak && streak.days > 1 ? (
				<Rise order={3}>
					<Line theme={theme}>
						Your longest run was{" "}
						<Mark theme={theme}>{plural(streak.days, "working day")}</Mark> in a
						row, from {shortDay(streak.from)} to {shortDay(streak.to)}.
					</Line>
				</Rise>
			) : null}
			{rewind.weekendDaysWorked > 0 ? (
				<Rise order={4}>
					<Note theme={theme}>
						And {plural(rewind.weekendDaysWorked, "weekend day")}. We noticed.
					</Note>
				</Rise>
			) : null}
		</View>
	);
}

const CHART_HEIGHT = 200;

export function MonthsSlide({ rewind, theme }: SlideProps) {
	const max = Math.max(
		1,
		...rewind.months.map((month) => month.seconds + month.projectedSeconds),
	);
	const busiest = busiestMonth(rewind);
	const projected = rewind.months.some((month) => month.projectedSeconds > 0);
	return (
		<View style={{ gap: GAP + 8 }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>Month by month</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Headline theme={theme}>
					<Mark theme={theme}>{monthName(busiest.month)}</Mark> was your biggest
					month.
				</Headline>
			</Rise>
			<Rise order={2}>
				<View
					accessible
					accessibilityLabel={rewind.months
						.map(
							(month) =>
								`${monthName(month.month)}: ${wholeHours(month.seconds)} hours`,
						)
						.join(", ")}
					style={{
						flexDirection: "row",
						alignItems: "flex-end",
						gap: 5,
						height: CHART_HEIGHT + 24,
					}}
				>
					{rewind.months.map((month, i) => {
						const top = month.month === busiest.month;
						return (
							<View
								key={month.month}
								style={{ flex: 1, alignItems: "center", gap: 6 }}
							>
								<View
									style={{
										width: "100%",
										height: CHART_HEIGHT,
										justifyContent: "flex-end",
									}}
								>
									{month.projectedSeconds > 0 ? (
										<View
											style={{
												height: (month.projectedSeconds / max) * CHART_HEIGHT,
												borderWidth: 1,
												borderBottomWidth: 0,
												borderStyle: "dashed",
												borderColor: theme.fg,
												borderTopLeftRadius: 3,
												borderTopRightRadius: 3,
												backgroundColor: withAlpha(theme.fg, 0.18),
											}}
										/>
									) : null}
									<View
										style={{
											height: Math.max(
												(month.seconds / max) * CHART_HEIGHT,
												month.seconds > 0 ? 3 : 1,
											),
											justifyContent: "flex-end",
											overflow: "hidden",
											borderTopLeftRadius: month.projectedSeconds > 0 ? 0 : 3,
											borderTopRightRadius: month.projectedSeconds > 0 ? 0 : 3,
										}}
									>
										<GrowBar
											vertical
											fraction={1}
											height={0}
											delay={450 + i * 50}
											color={top ? theme.accent : withAlpha(theme.fg, 0.55)}
										/>
									</View>
								</View>
								<Text
									style={{
										color: theme.fg,
										opacity: 0.7,
										fontFamily: MONO,
										fontSize: 12,
									}}
								>
									{monthName(month.month).slice(0, 1)}
								</Text>
							</View>
						);
					})}
				</View>
			</Rise>
			<Rise order={3}>
				<Line theme={theme}>
					{wholeHours(busiest.seconds)} hours in {monthName(busiest.month)}.
					{projected ? " The light part is still to come." : ""}
				</Line>
			</Rise>
		</View>
	);
}

export function BigDaySlide({ rewind, theme }: SlideProps) {
	const day = rewind.busiestDay;
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>Your biggest day</Eyebrow>
			</Rise>
			{day ? (
				<Rise order={1}>
					<Headline theme={theme}>{longDay(day.date)}</Headline>
				</Rise>
			) : null}
			{day ? (
				<Rise order={2}>
					<Line theme={theme}>
						<Mark theme={theme}>{tenthHours(day.seconds)} hours</Mark> in one
						day.
					</Line>
				</Rise>
			) : null}
			<Rise order={3}>
				<Line theme={theme}>
					{weekdayName(strongestWeekday(rewind))}s were your strongest day of
					the week.
				</Line>
			</Rise>
			{rewind.overtimeSeconds > 0 ? (
				<Rise order={4}>
					<Note theme={theme}>
						{wholeHours(rewind.overtimeSeconds)} hours of it was overtime.
					</Note>
				</Rise>
			) : null}
		</View>
	);
}

/** An emoji icon of a project, or its first letter. An uploaded image is
 *  a path on the Server, which the slide does not load. */
function ProjectMark({
	icon,
	name,
	theme,
}: {
	icon: string | null;
	name: string;
	theme: RewindTheme;
}) {
	const emoji = icon && !icon.includes("/") ? icon : null;
	return (
		<View
			style={{
				width: 40,
				height: 40,
				borderRadius: 10,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: withAlpha(theme.fg, 0.14),
			}}
		>
			<Text style={{ color: theme.fg, fontSize: emoji ? 22 : 18 }}>
				{emoji ?? name.slice(0, 1).toUpperCase()}
			</Text>
		</View>
	);
}

export function ProjectsSlide({ rewind, theme }: SlideProps) {
	const top = rewind.projects[0]?.seconds ?? 1;
	return (
		<View style={{ gap: GAP + 4 }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>Where your hours went</Eyebrow>
			</Rise>
			{rewind.projects.map((project, i) => (
				<Rise
					key={project.id}
					order={i + 1}
					style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
				>
					<Text
						style={{
							color: theme.fg,
							opacity: 0.6,
							fontFamily: SERIF,
							fontSize: 32,
							width: 24,
						}}
					>
						{String(i + 1)}
					</Text>
					<ProjectMark icon={project.icon} name={project.name} theme={theme} />
					<View style={{ flex: 1, gap: 2 }}>
						<Text
							numberOfLines={1}
							style={{ color: theme.fg, fontSize: 19, fontWeight: "600" }}
						>
							{project.name}
						</Text>
						{project.clientName && project.clientName !== project.name ? (
							<Text
								numberOfLines={1}
								style={{ color: theme.fg, opacity: 0.7, fontSize: 14 }}
							>
								{project.clientName}
							</Text>
						) : null}
						<View
							style={{
								marginTop: 6,
								height: 4,
								borderRadius: 2,
								overflow: "hidden",
								backgroundColor: withAlpha(theme.fg, 0.15),
							}}
						>
							<GrowBar
								fraction={project.seconds / top}
								color={theme.accent}
								height={4}
								delay={600 + i * 120}
							/>
						</View>
					</View>
					<Text style={{ color: theme.fg, fontFamily: MONO, fontSize: 17 }}>
						{wholeHours(project.seconds)}h
					</Text>
				</Rise>
			))}
			<Rise order={rewind.projects.length + 1}>
				<Note theme={theme}>
					{plural(rewind.projectCount, "project")} for{" "}
					{plural(rewind.clientCount, "client")} this year.
				</Note>
			</Rise>
		</View>
	);
}

export function TasksSlide({ rewind, theme }: SlideProps) {
	const total = Math.max(1, rewind.workedSeconds);
	return (
		<View style={{ gap: GAP + 4 }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>How you spent it</Eyebrow>
			</Rise>
			<Rise order={1} style={{ gap: 12 }}>
				<View
					style={{
						flexDirection: "row",
						height: 18,
						borderRadius: 9,
						overflow: "hidden",
					}}
				>
					{rewind.groups.map((group, i) => (
						<View key={group.group} style={{ flex: group.seconds }}>
							<GrowBar
								fraction={1}
								height={18}
								delay={400 + i * 100}
								color={GROUP_COLORS[i % GROUP_COLORS.length] ?? theme.accent}
							/>
						</View>
					))}
				</View>
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
					{rewind.groups.map((group, i) => (
						<View
							key={group.group}
							style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
						>
							<View
								style={{
									width: 10,
									height: 10,
									borderRadius: 5,
									backgroundColor:
										GROUP_COLORS[i % GROUP_COLORS.length] ?? theme.accent,
								}}
							/>
							<Text style={{ color: theme.fg, fontSize: 14 }}>
								{groupLabel(group.group)}
							</Text>
							<Text
								style={{
									color: theme.fg,
									opacity: 0.6,
									fontFamily: MONO,
									fontSize: 13,
								}}
							>
								{sharePercent(group.seconds, total)}
							</Text>
						</View>
					))}
				</View>
			</Rise>
			<View>
				{rewind.tasks.map((task, i) => (
					<Rise
						key={task.id}
						order={i + 2}
						style={{
							flexDirection: "row",
							alignItems: "baseline",
							justifyContent: "space-between",
							gap: 12,
							paddingVertical: 9,
							borderTopWidth: i > 0 ? 1 : 0,
							borderTopColor: withAlpha(theme.fg, 0.15),
						}}
					>
						<Text
							numberOfLines={1}
							style={{
								flex: 1,
								color: theme.fg,
								fontFamily: SERIF,
								fontSize: 26,
							}}
						>
							{task.name}
						</Text>
						<Text style={{ color: theme.fg, fontFamily: MONO, fontSize: 17 }}>
							{wholeHours(task.seconds)}h
						</Text>
					</Rise>
				))}
			</View>
			{rewind.meetingSeconds > 0 ? (
				<Rise order={rewind.tasks.length + 2}>
					<Note theme={theme}>
						{wholeHours(rewind.meetingSeconds)} hours of meetings
						{rewind.codeReviewSeconds > 0
							? `, and ${wholeHours(rewind.codeReviewSeconds)} hours on the code of other people`
							: ""}
						.
					</Note>
				</Rise>
			) : null}
		</View>
	);
}

export function WordsSlide({ rewind, theme }: SlideProps) {
	const scale = useScale();
	const most = rewind.words[0]?.count ?? 1;
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>
					{`Your year in ${rewind.words.length} words`}
				</Eyebrow>
			</Rise>
			<View>
				{rewind.words.map((word, i) => {
					const size = scale(0.08 + (word.count / most) * 0.08, 72);
					return (
						<Rise
							key={word.word}
							order={i + 1}
							style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}
						>
							<Text
								accessibilityLabel={`${word.word}, ${plural(word.count, "time")}`}
								numberOfLines={1}
								style={{
									flexShrink: 1,
									color: i === 0 ? theme.accent : theme.fg,
									fontFamily: SERIF,
									fontSize: size,
									lineHeight: size * 1.1,
								}}
							>
								{word.word}
							</Text>
							<Text
								style={{
									color: theme.fg,
									opacity: 0.6,
									fontFamily: MONO,
									fontSize: 13,
								}}
							>
								{plural(word.count, "time")}
							</Text>
						</Rise>
					);
				})}
			</View>
			<Rise order={rewind.words.length + 1}>
				<Note theme={theme}>The words you wrote most in your notes.</Note>
			</Rise>
		</View>
	);
}

function Figure({
	theme,
	value,
	label,
}: {
	theme: RewindTheme;
	value: number;
	label: string;
}) {
	const scale = useScale();
	const shown = useCountUp(value, 600);
	const size = scale(0.14, 88);
	return (
		<View
			accessible
			accessibilityLabel={`${formatNumber(value)} ${label}`}
			style={{ width: "50%", paddingRight: 12, gap: 4 }}
		>
			<Text
				numberOfLines={1}
				adjustsFontSizeToFit
				style={{
					color: theme.accent,
					fontFamily: MONO,
					fontSize: size,
					lineHeight: size * 1.05,
				}}
			>
				{formatNumber(Math.round(shown))}
			</Text>
			<Text style={{ color: theme.fg, opacity: 0.8, fontSize: 17 }}>
				{label}
			</Text>
		</View>
	);
}

export function GithubSlide({ rewind, theme }: SlideProps) {
	const figures = [
		{ label: "commits", value: rewind.commits },
		{ label: "pull requests opened", value: rewind.pullRequests.opened },
		{ label: "merged", value: rewind.pullRequests.merged },
		{ label: "reviews", value: rewind.pullRequests.reviewed },
	].filter((figure) => figure.value > 0);
	return (
		<View style={{ gap: GAP + 8 }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>From GitHub</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Headline theme={theme}>You shipped.</Headline>
			</Rise>
			<Rise
				order={2}
				style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 28 }}
			>
				{figures.map((figure) => (
					<Figure
						key={figure.label}
						theme={theme}
						value={figure.value}
						label={figure.label}
					/>
				))}
			</Rise>
		</View>
	);
}

export function TimeOffSlide({ rewind, theme }: SlideProps) {
	const { vacationDays, sickDays, otherDays, aheadDays } = rewind.timeOff;
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>Time away</Eyebrow>
			</Rise>
			{vacationDays > 0 ? (
				<Rise order={1}>
					<Headline theme={theme}>
						<Mark theme={theme}>{plural(vacationDays, "day")}</Mark> of
						vacation.
					</Headline>
				</Rise>
			) : null}
			{sickDays > 0 ? (
				<Rise order={2}>
					<Line theme={theme}>
						{plural(sickDays, "day")} of sick leave. We hope you are well.
					</Line>
				</Rise>
			) : null}
			{otherDays > 0 ? (
				<Rise order={3}>
					<Line theme={theme}>{plural(otherDays, "day")} of other leave.</Line>
				</Rise>
			) : null}
			<Rise order={4}>
				<Note theme={theme}>
					{aheadDays > 0
						? `Still to come: ${plural(aheadDays, "day")}. Enjoy them.`
						: "Rest is part of the work."}
				</Note>
			</Rise>
		</View>
	);
}

export function PersonaSlide({ rewind, theme }: SlideProps) {
	const scale = useScale();
	const persona = personaFor(rewind);
	const size = scale(0.17, 120);
	return (
		<View style={{ gap: GAP }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>{`Your ${rewind.year}, in one name`}</Eyebrow>
			</Rise>
			<Rise order={1}>
				<Text
					accessibilityRole="header"
					style={{
						color: theme.accent,
						fontFamily: SERIF,
						fontSize: size,
						lineHeight: size * 0.95,
					}}
				>
					{persona.title}
				</Text>
			</Rise>
			<Rise order={2}>
				<Line theme={theme}>{persona.line}</Line>
			</Rise>
		</View>
	);
}

/** The year in six figures, and the actions: share, watch again, another
 *  year and close. */
export function SummarySlide({
	rewind,
	theme,
	actions,
}: SlideProps & { actions: ReactNode }) {
	const tiles = summaryTiles(rewind);
	const fade = useEntrance(100, 1100);
	const line = withAlpha(theme.fg, 0.2);
	return (
		<View style={{ gap: GAP + 8 }}>
			<Rise order={0}>
				<Eyebrow theme={theme}>{`Farmer Rewind ${rewind.year}`}</Eyebrow>
			</Rise>
			{/* The card comes in as one part, a slow fade with no travel: after
			    many slides of movement, the last one stays still. */}
			<Animated.View
				style={{
					opacity: fade,
					flexDirection: "row",
					flexWrap: "wrap",
					borderRadius: 18,
					borderWidth: 1,
					borderColor: line,
					overflow: "hidden",
				}}
			>
				{tiles.map((tile, i) => (
					<View
						key={tile.label}
						accessible
						accessibilityLabel={`${tile.label}: ${tile.value}`}
						style={{
							width: "50%",
							paddingHorizontal: 16,
							paddingVertical: 16,
							borderColor: line,
							borderTopWidth: i >= 2 ? 1 : 0,
							borderLeftWidth: i % 2 === 1 ? 1 : 0,
							gap: 6,
						}}
					>
						<Text
							style={{
								color: theme.fg,
								opacity: 0.6,
								fontSize: 11,
								letterSpacing: 1.8,
								textTransform: "uppercase",
							}}
						>
							{tile.label}
						</Text>
						<Text
							numberOfLines={1}
							adjustsFontSizeToFit
							style={{ color: theme.fg, fontFamily: SERIF, fontSize: 26 }}
						>
							{tile.value}
						</Text>
					</View>
				))}
			</Animated.View>
			<Rise order={2}>{actions}</Rise>
		</View>
	);
}

export const pillText = (theme: RewindTheme, filled: boolean): TextStyle => ({
	color: filled ? theme.bg : theme.fg,
	fontSize: 16,
	fontWeight: "600",
});
