# Assistant model benchmark

This benchmark compares the models that can run the Farmer assistant. It
runs the real assistant loop. It does not copy the loop.

## What the benchmark uses

- The real `assistantService.run`, with the stall watchdog and the one retry.
- The real tool registry and the real `systemPrompt`.
- The real step ceiling (`MAX_STEPS`).
- A synthetic organization in an in-process PGLite database. No other
  database is used, and no real data leaves the machine.

## What the benchmark does not use

- A production key or a production database.
- The fallback model. The fallback is set to the model under test, so each
  model is measured alone. A stall still counts, and the retry asks the same
  model once.

## How to run

1. Get an OpenRouter key. Put it in the environment. Do not write it in a file.
2. Run the benchmark:

```
OPENROUTER_API_KEY=... bun run bench:assistant
```

3. To prove that the harness works without a paid call, use the stub:

```
bun run bench:assistant -- --stub
```

The stub replaces only the network client. All other parts are real.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--models a,b` | the list in `models.ts` | Models to run. |
| `--questions id,id` | all | Question ids to run. |
| `--repeats N` | 3 | Runs of each question for each model. |
| `--concurrency N` | 3 | Models that run at the same time. Use 1 for a clean latency figure. |
| `--cap USD` | 8 | The runner stops all children when the spend passes this value. |
| `--out DIR` | `results/<date>` | Where the results go. A relative DIR is under `results/`, which git ignores. A path in the repository outside `results/` is refused. |
| `--stub` | off | Use the scripted model. No key and no cost. |

A stopped run can continue. Start it again with the same `--out`. The runner
keeps the finished runs and does only the missing ones.

## How it works

1. `run.ts` checks each model against the public OpenRouter catalog. It drops
   a model that is missing, expired, or without tool support.
2. `run.ts` starts one child process for each model (`child.ts`). A child
   needs its own process, because the fallback setting and the telemetry
   sink are global.
3. The child seeds the organization (`seed.ts`). It has 40 people and about
   13,000 entries. The dates follow the run date, so "last week" always has
   an answer.
4. For each question and each repeat, the child puts the two caller users back
   as seeded. Then it asks the question through `assistantService.run`.
5. The child reads the telemetry sink. It records each model call and each
   tool run. It prints one record for each run.
6. `report.ts` builds `summary.json` and `summary.md` from `runs.jsonl`. It
   makes no model call.

## Questions

The questions are in `questions.ts`. Each one has a check.

| Id | Kind | What the check reads |
|---|---|---|
| `own-last-week` | report | The figure in the answer. |
| `own-vs-company` | report | The figure in the answer. The company total fails. |
| `team-project` | report | The figure in the answer. |
| `overtime` | report | The name in the answer. |
| `absence` | report | Days or hours in the answer. |
| `create-entry` | write | One entry with the right date, project, task and duration. |
| `update-entry` | write | The right entry and the new description. |
| `book-vacation` | approval | The `log_absence` card: task and day. |
| `unlink-commits` | approval | The `unlink_commits` card: the exact set of ids. |
| `fill-day` | read | `suggest_day` for yesterday, then an answer or an approval. |

A tool that needs approval stops the turn at the approval card. The benchmark
scores the tool and the arguments on the card. It never approves the card.

The `own-vs-company` question is the trap from the 16 Sep 2026 run. A report
tool that has no user filter returns every person. A model that does not set
the filter answers with the total of the company.

The unlink question does not use the words of the tool description. A copy of
those words would test string matching and not the model.

## What a record holds

- Pass or fail, and the reason.
- Steps, tool calls, and the wall time.
- Time to first progress for each model call. This is the time from the
  request start to the first content, reasoning, or tool-call delta.
- Stalls and retries, with the retry reasons.
- Errors, cost, tokens, the served model, and the provider.

The cost comes from OpenRouter. When a call has tokens but no cost, the runner
uses the price from the catalog and marks the figure as an estimate.

## How the summary ranks

The summary compares models in this order. A step applies only when the
earlier steps are equal.

1. Pass rate: the number of passing runs.
2. Pass^N (N is the repeat count): the number of questions where all repeats pass.
3. Latency: the p50 wall time, in whole seconds.
4. Cost: the cost for each run, to 0.0001 USD.

The p95 time to first progress, the stall count, and the error count are in
the table. They are not in the rank key. Read them before you choose a model.

## Safety

- The key is read from `OPENROUTER_API_KEY`. The runner and the child never
  print it. The database stores it sealed, as in production.
- The write tools change only the synthetic database. The benchmark puts the
  two caller users back before each run.
- The benchmark does not approve a card. No unlink or absence write runs.
- The raw results are in `results/`. Git ignores this directory.

## Files

| File | Use |
|---|---|
| `run.ts` | The runner. It starts the children and stops at the cap. |
| `child.ts` | One model, all questions. |
| `seed.ts` | The synthetic organization and the ground truth. |
| `questions.ts` | The questions and the checks. |
| `questions.test.ts` | Tests for the checks. |
| `stub.ts` | The scripted model for `--stub`. |
| `models.ts` | The pinned model ids, and the production alias for comparison. |
| `out-dir.ts` | The results directory. It refuses a path in the repository outside `results/`. |
| `out-dir.test.ts` | Tests for the results directory. |
| `report.ts` | The summary. Run it alone: `bun scripts/assistant-benchmark/report.ts <dir>`. |
| `types.ts` | The record of one run. |
