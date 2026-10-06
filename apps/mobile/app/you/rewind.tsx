import { useRouter } from "expo-router";
import { useState } from "react";

import { useWhoami } from "../../src/api/queries";
import { useRewind } from "../../src/api/you";
import { LoadingIndicator } from "../../src/ui/loading";
import { defaultRewindYear, isRewindOpen } from "../../src/you/rewind/story";
import {
	Pill,
	RewindMessage,
	RewindStoryView,
} from "../../src/you/rewind/story-view";
import { THEMES } from "../../src/you/rewind/theme";

/**
 * Rewind: the person's year in review, as a story of full-screen slides.
 * The current year opens on 1 December. Before that, the screen says when
 * it opens and offers last year's.
 */
export default function RewindScreen() {
	const router = useRouter();
	const whoami = useWhoami();
	const today = whoami.data?.today ?? "";
	const [chosen, setChosen] = useState<number | null>(null);
	const year = chosen ?? (today ? defaultRewindYear(today) : 0);
	const open = today !== "" && isRewindOpen(year, today);
	const rewind = useRewind(year, open);
	const theme = THEMES.violet;

	const close = () => {
		if (router.canGoBack()) router.back();
		else router.replace("/");
	};

	if (whoami.isError) {
		return (
			<RewindMessage
				title="This Rewind did not load."
				line={whoami.error.message}
			>
				<Pill
					theme={theme}
					label="Try again"
					filled
					onPress={() => void whoami.refetch()}
				/>
				<Pill theme={theme} label="Close" onPress={close} />
			</RewindMessage>
		);
	}
	const waiting = (
		<RewindMessage title="Rewinding your year.">
			<LoadingIndicator
				size={32}
				color={theme.fg}
				accessibilityLabel="Loading"
			/>
		</RewindMessage>
	);
	if (!today) return waiting;

	if (!open) {
		const lastYear = Number(today.slice(0, 4)) - 1;
		return (
			<RewindMessage
				title={`Your ${year} Rewind opens on 1 December.`}
				line="Until then, keep logging. Every hour goes into it."
			>
				<Pill
					theme={theme}
					label={`Rewind ${lastYear}`}
					filled
					onPress={() => setChosen(lastYear)}
				/>
				<Pill theme={theme} label="Close" onPress={close} />
			</RewindMessage>
		);
	}
	if (rewind.isPending) return waiting;
	if (rewind.isError) {
		return (
			<RewindMessage
				title="This Rewind did not load."
				line={rewind.error.message}
			>
				<Pill
					theme={theme}
					label="Try again"
					filled
					onPress={() => void rewind.refetch()}
				/>
				<Pill theme={theme} label="Close" onPress={close} />
			</RewindMessage>
		);
	}

	const name = whoami.data?.name ?? "";
	return (
		<RewindStoryView
			// A new year starts the story again from its first slide.
			key={year}
			rewind={rewind.data}
			firstName={name.split(" ")[0] || "Hello"}
			onClose={close}
			extraAction={
				rewind.data.previousYearWorkedSeconds != null
					? {
							label: `Rewind ${year - 1}`,
							onPress: () => setChosen(year - 1),
						}
					: undefined
			}
		/>
	);
}
