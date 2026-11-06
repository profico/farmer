import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import {
	type Survey,
	SurveyEventName,
	SurveyEventProperties,
	SurveyQuestionType,
	SurveyType,
} from "posthog-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";

/**
 * The launched PostHog survey of type `api`, or null. `getSurveys` is used and
 * not `getActiveMatchingSurveys`: the targeting of the second one hides a
 * survey from a person who already answered. An unstarted client calls back
 * with an empty list, so the entry points stay hidden.
 */
export function useFeedbackSurvey(): Survey | null {
	const posthog = usePostHog();
	const [survey, setSurvey] = useState<Survey | null>(null);

	useEffect(() => {
		posthog.getSurveys((surveys) => {
			setSurvey(
				surveys.find(
					(item) =>
						item.type === SurveyType.API &&
						item.start_date &&
						!item.end_date &&
						item.questions.length > 0 &&
						// The dialog cannot ask a question type that it does not render.
						item.questions.every(isSupported),
				) ?? null,
			);
		});
	}, [posthog]);

	return survey;
}

function isSupported(question: Survey["questions"][number]) {
	return (
		Boolean(question.id) &&
		(question.type === SurveyQuestionType.SingleChoice ||
			question.type === SurveyQuestionType.Open)
	);
}

/** The person property that marks a response, as the SDK writes it. */
function respondedKey(survey: Survey) {
	const iteration = survey.current_iteration;
	return iteration && iteration > 0
		? `$survey_responded/${survey.id}/${iteration}`
		: `$survey_responded/${survey.id}`;
}

/** The SDK keys the first answer `$survey_response` and the next by index. */
function indexKey(index: number) {
	return index === 0 ? "$survey_response" : `$survey_response_${index}`;
}

/**
 * A button that opens the feedback dialog, for a screen that has no account
 * menu, such as an error screen. It renders nothing when there is no survey.
 * `context` goes on the event, so a report keeps the error ref and message.
 */
export function FeedbackButton({
	label,
	context,
}: {
	label: string;
	context?: Record<string, string>;
}) {
	const survey = useFeedbackSurvey();
	const [open, setOpen] = useState(false);
	if (!survey) return null;
	return (
		<>
			<Button variant="outline" onClick={() => setOpen(true)}>
				<ChatCircleDotsIcon aria-hidden />
				{label}
			</Button>
			<FeedbackDialog
				survey={survey}
				open={open}
				onOpenChange={setOpen}
				context={context}
			/>
		</>
	);
}

export function FeedbackDialog({
	survey,
	open,
	onOpenChange,
	context,
}: {
	survey: Survey;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	context?: Record<string, string>;
}) {
	const posthog = usePostHog();
	const [answers, setAnswers] = useState<Record<string, string>>({});

	// The type marks `id` as optional; a question without one cannot be answered.
	const questions = survey.questions.flatMap((question) =>
		question.id &&
		(question.type === SurveyQuestionType.SingleChoice ||
			question.type === SurveyQuestionType.Open)
			? [{ ...question, id: question.id }]
			: [],
	);
	const complete = questions.every(
		(question) => question.optional || answers[question.id]?.trim(),
	);

	const submit = (event: React.SyntheticEvent) => {
		event.preventDefault();
		if (!complete) return;
		// An empty optional answer is left out, so the results show no blank answer.
		const responses = questions.map((question) => ({
			id: question.id,
			question: question.question,
			response: answers[question.id]?.trim() || undefined,
		}));
		posthog.capture(SurveyEventName.SENT, {
			// First, so a context key cannot replace a survey property.
			...context,
			[SurveyEventProperties.SURVEY_ID]: survey.id,
			[SurveyEventProperties.SURVEY_NAME]: survey.name,
			[SurveyEventProperties.SURVEY_QUESTIONS]: responses,
			[SurveyEventProperties.SURVEY_COMPLETED]: true,
			[SurveyEventProperties.SURVEY_SUBMISSION_ID]: crypto.randomUUID(),
			[SurveyEventProperties.SURVEY_ITERATION]: survey.current_iteration,
			[SurveyEventProperties.SURVEY_ITERATION_START_DATE]:
				survey.current_iteration_start_date,
			...Object.fromEntries(
				responses.flatMap((item, index) =>
					item.response
						? [
								[`$survey_response_${item.id}`, item.response],
								[indexKey(index), item.response],
							]
						: [],
				),
			),
			$set: { [respondedKey(survey)]: true },
			page: window.location.pathname,
		});
		setAnswers({});
		onOpenChange(false);
		toast.success("Thanks for your feedback");
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={submit} className="grid gap-4">
					<DialogHeader>
						<DialogTitle>Send feedback</DialogTitle>
						<DialogDescription>
							Report a bug or suggest an idea. The team reads every message.
						</DialogDescription>
					</DialogHeader>
					{questions.map((question) =>
						question.type === SurveyQuestionType.SingleChoice ? (
							// A fieldset names the group of choice buttons for a screen reader.
							<fieldset key={question.id} className="grid gap-2">
								<legend className="mb-2 text-sm font-medium">
									{question.question}
								</legend>
								<SegmentedControl>
									{question.choices.map((choice) => (
										<SegmentedControlItem
											key={choice}
											aria-pressed={answers[question.id] === choice}
											active={answers[question.id] === choice}
											onClick={() =>
												setAnswers((prev) => ({
													...prev,
													[question.id]: choice,
												}))
											}
										>
											{choice}
										</SegmentedControlItem>
									))}
								</SegmentedControl>
							</fieldset>
						) : (
							<div key={question.id} className="grid gap-2">
								<Label htmlFor={`feedback-${question.id}`}>
									{question.question}
								</Label>
								<Textarea
									id={`feedback-${question.id}`}
									value={answers[question.id] ?? ""}
									onChange={(event) =>
										setAnswers((prev) => ({
											...prev,
											[question.id]: event.target.value,
										}))
									}
								/>
							</div>
						),
					)}
					<DialogFooter>
						<DialogClose render={<Button type="button" variant="ghost" />}>
							Cancel
						</DialogClose>
						<Button type="submit" disabled={!complete}>
							Send
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
