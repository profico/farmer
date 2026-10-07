// The models under test. Every id is pinned, except the last one,
// `~deepseek/deepseek-flash-latest`. It is an alias on purpose, because it is
// the production model and the comparison needs it. Each id supports tools on
// OpenRouter as of 7 Oct 2026. The runner checks the list again before a paid
// run and drops a model that has expired or lost tool support.

export const MODELS = [
	"z-ai/glm-5.3-flash",
	"deepseek/deepseek-v4.1-flash",
	"deepseek/deepseek-v4-flash-0731",
	"qwen/qwen3.8-flash",
	"qwen/qwen3.7-flash",
	"inception/mercury-2.5",
	"google/gemini-3.5-flash-lite",
	"google/gemini-3.8-flash",
	"openai/gpt-6-luna",
	"openai/gpt-5.4-nano",
	"openai/gpt-5.4-mini",
	"mistralai/mistral-small-2603",
	"meta-llama/llama-4-maverick",
	"anthropic/claude-haiku-4.5",
	// The production model today. The alias moves to new versions, so the
	// served model in the results says which version answered.
	"~deepseek/deepseek-flash-latest",
];
