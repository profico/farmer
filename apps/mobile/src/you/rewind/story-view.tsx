import type { Rewind } from "@farmer/api-client";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useRef, useState } from "react";
import {
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Platform,
	Pressable,
	ScrollView,
	Share,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../ui/icon";
import type { IconName } from "../../ui/icons";
import { useMotionPreference } from "../../ui/motion";
import { SlideMotionProvider } from "./motion";
import {
	BigDaySlide,
	DaysSlide,
	EmptySlide,
	GithubSlide,
	HoursSlide,
	IntroSlide,
	MonthsSlide,
	PersonaSlide,
	pillText,
	ProjectsSlide,
	SummarySlide,
	TasksSlide,
	TimeOffSlide,
	WordsSlide,
} from "./slides";
import { shareText, type SlideKind, slidesOf } from "./story";
import { isLight, type RewindTheme, SLIDE_THEMES, withAlpha } from "./theme";

/** A round pill button of a slide, in the slide's own colours. */
export function Pill({
	theme,
	label,
	icon,
	filled,
	onPress,
	disabled,
}: {
	theme: RewindTheme;
	label: string;
	icon?: IconName;
	filled?: boolean;
	onPress: () => void;
	disabled?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			android_ripple={{ color: withAlpha(theme.fg, 0.2) }}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				minHeight: 48,
				paddingHorizontal: 20,
				borderRadius: 24,
				borderWidth: filled ? 0 : 1,
				borderColor: withAlpha(theme.fg, 0.4),
				backgroundColor: filled ? theme.fg : "transparent",
				opacity: disabled ? 0.5 : Platform.OS === "ios" && pressed ? 0.7 : 1,
				overflow: "hidden",
			})}
		>
			{icon ? (
				<Icon name={icon} size={18} color={filled ? theme.bg : theme.fg} />
			) : null}
			<Text style={pillText(theme, Boolean(filled))}>{label}</Text>
		</Pressable>
	);
}

/** The bars at the top: one for each slide, filled up to the current one.
 *  A screen reader can move between the slides with it. */
function Progress({
	count,
	index,
	theme,
	onGo,
}: {
	count: number;
	index: number;
	theme: RewindTheme;
	onGo: (index: number) => void;
}) {
	return (
		<View
			accessible
			accessibilityRole="adjustable"
			accessibilityLabel="Slide"
			accessibilityValue={{ text: `${index + 1} of ${count}` }}
			accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
			onAccessibilityAction={(event) => {
				if (event.nativeEvent.actionName === "increment") onGo(index + 1);
				if (event.nativeEvent.actionName === "decrement") onGo(index - 1);
			}}
			style={{ flex: 1, flexDirection: "row", gap: 4 }}
		>
			{Array.from({ length: count }, (_, i) => (
				<View
					key={i}
					style={{
						flex: 1,
						height: 3,
						borderRadius: 1.5,
						backgroundColor: withAlpha(theme.fg, i <= index ? 0.95 : 0.3),
					}}
				/>
			))}
		</View>
	);
}

/**
 * A Rewind as a story: one full screen for each slide. A swipe, or a tap
 * on the right or the left part of the screen, moves to the next or the
 * last slide. The last slide shares the year as text.
 */
export function RewindStoryView({
	rewind,
	firstName,
	onClose,
	extraAction,
}: {
	rewind: Rewind;
	firstName: string;
	onClose: () => void;
	/** Another year, beside "Watch again" on the last slide. */
	extraAction?: { label: string; onPress: () => void };
}) {
	const { width, height } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const { reduceMotion: reduce } = useMotionPreference();
	const scroller = useRef<ScrollView>(null);
	const [index, setIndex] = useState(0);
	const [sharing, setSharing] = useState(false);
	const slides = slidesOf(rewind);
	const last = slides.length - 1;
	const theme = SLIDE_THEMES[slides[index] ?? "intro"];

	const go = (next: number) => {
		const target = Math.max(0, Math.min(last, next));
		setIndex(target);
		scroller.current?.scrollTo({ x: target * width, animated: !reduce });
	};

	const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		const page = Math.round(event.nativeEvent.contentOffset.x / width);
		setIndex(Math.max(0, Math.min(last, page)));
	};

	const share = async () => {
		setSharing(true);
		try {
			await Share.share({ message: shareText(rewind) });
		} finally {
			setSharing(false);
		}
	};

	const actions = (slideTheme: RewindTheme) => (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
			{rewind.workedSeconds > 0 ? (
				<Pill
					theme={slideTheme}
					label="Share"
					filled
					disabled={sharing}
					onPress={() => void share()}
				/>
			) : null}
			{rewind.workedSeconds > 0 ? (
				<Pill theme={slideTheme} label="Watch again" onPress={() => go(0)} />
			) : null}
			{extraAction ? (
				<Pill
					theme={slideTheme}
					label={extraAction.label}
					onPress={extraAction.onPress}
				/>
			) : null}
			<Pill theme={slideTheme} label="Close" onPress={onClose} />
		</View>
	);

	const content = (kind: SlideKind): ReactNode => {
		const slideTheme = SLIDE_THEMES[kind];
		const props = { rewind, theme: slideTheme };
		switch (kind) {
			case "intro":
				return <IntroSlide {...props} firstName={firstName} />;
			case "empty":
				return <EmptySlide {...props} actions={actions(slideTheme)} />;
			case "hours":
				return <HoursSlide {...props} />;
			case "days":
				return <DaysSlide {...props} />;
			case "months":
				return <MonthsSlide {...props} />;
			case "bigDay":
				return <BigDaySlide {...props} />;
			case "projects":
				return <ProjectsSlide {...props} />;
			case "tasks":
				return <TasksSlide {...props} />;
			case "words":
				return <WordsSlide {...props} />;
			case "github":
				return <GithubSlide {...props} />;
			case "timeOff":
				return <TimeOffSlide {...props} />;
			case "persona":
				return <PersonaSlide {...props} />;
			case "summary":
				return <SummarySlide {...props} actions={actions(slideTheme)} />;
		}
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.bg }}>
			<StatusBar style={isLight(theme) ? "dark" : "light"} />
			<ScrollView
				ref={scroller}
				horizontal
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				onMomentumScrollEnd={onSettle}
				style={{ flex: 1 }}
			>
				{slides.map((kind, i) => {
					const slideTheme = SLIDE_THEMES[kind];
					return (
						// A slide scrolls up and down when its content is taller than
						// the screen, as with large system text on a small phone.
						<ScrollView
							key={kind}
							style={{ width, height, backgroundColor: slideTheme.bg }}
							contentContainerStyle={{ flexGrow: 1 }}
							showsVerticalScrollIndicator={false}
						>
							<Pressable
								// A tap on the left third goes back, anywhere else goes on.
								// The buttons of a slide take their own taps first.
								accessible={false}
								onPress={(event) =>
									go(event.nativeEvent.pageX < width / 3 ? i - 1 : i + 1)
								}
								style={{
									flexGrow: 1,
									paddingTop: insets.top + 72,
									paddingBottom: insets.bottom + 32,
									paddingHorizontal: 28,
									justifyContent: "center",
								}}
							>
								<SlideMotionProvider active={i === index} reduce={reduce}>
									{content(kind)}
								</SlideMotionProvider>
							</Pressable>
						</ScrollView>
					);
				})}
			</ScrollView>
			<View
				style={{
					position: "absolute",
					top: insets.top + 12,
					left: 20,
					right: 12,
					flexDirection: "row",
					alignItems: "center",
					gap: 12,
				}}
			>
				<Progress count={slides.length} index={index} theme={theme} onGo={go} />
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Close"
					onPress={onClose}
					hitSlop={8}
					style={{
						width: 40,
						height: 40,
						borderRadius: 20,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: withAlpha(theme.fg, 0.12),
					}}
				>
					<Icon name="close" size={22} color={theme.fg} />
				</Pressable>
			</View>
		</View>
	);
}

/** A full screen in the colours of a Rewind with one message, for a year
 *  that is not open yet, a read that runs, or a failed read. */
export function RewindMessage({
	title,
	line,
	children,
}: {
	title: string;
	line?: string;
	children?: ReactNode;
}) {
	const insets = useSafeAreaInsets();
	const theme = SLIDE_THEMES.intro;
	return (
		<View
			style={{
				flex: 1,
				backgroundColor: theme.bg,
				paddingTop: insets.top + 32,
				paddingBottom: insets.bottom + 32,
				paddingHorizontal: 28,
				justifyContent: "center",
				gap: 20,
			}}
		>
			<StatusBar style="light" />
			<Text
				accessibilityRole="header"
				style={{
					color: theme.fg,
					fontSize: 34,
					lineHeight: 40,
					fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
				}}
			>
				{title}
			</Text>
			{line ? (
				<Text
					style={{
						color: theme.fg,
						opacity: 0.75,
						fontSize: 18,
						lineHeight: 25,
					}}
				>
					{line}
				</Text>
			) : null}
			{children ? (
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
					{children}
				</View>
			) : null}
		</View>
	);
}
