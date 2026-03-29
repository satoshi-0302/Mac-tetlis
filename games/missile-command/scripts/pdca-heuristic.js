import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { DEFAULT_HEURISTIC_CONFIG, normalizeHeuristicConfig } from "../rl/demo-agent.js";
import {
  buildHeuristicModel,
  evaluateHeuristicConfigAcrossSeeds,
  trainHeuristicWithCem,
} from "../server/rl/heuristic-trainer.js";

const TRAIN_SEEDS = Object.freeze([
  0x3d93fa2a,
  0x27d4eb2d,
  0x91e10dab,
  0x11111111,
  0x22222222,
  0x33333333,
]);

const HOLDOUT_SEEDS = Object.freeze([
  0x44444444,
  0x55555555,
  0x66666666,
  0x77777777,
  0x88888888,
  0x99999999,
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampTag(date = new Date()) {
  return date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\..+$/, "");
}

function toRepoPath(filePath) {
  if (!filePath) {
    return null;
  }

  const relativePath = relative(process.cwd(), filePath);
  return relativePath || ".";
}

function writeJson(filePath, value) {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendLine(filePath, line) {
  const previous = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileSync(filePath, `${previous}${line}\n`, "utf8");
}

function toMdPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function rankEvaluation(evaluation) {
  return (
    evaluation.clearRate * 1_000_000_000 +
    evaluation.meanAliveCities * 1_000_000 +
    evaluation.meanScore * 10_000 +
    evaluation.bestScore * 100 +
    evaluation.objective
  );
}

function chooseCandidate(cycle, bestEvaluation, stagnation) {
  const bootstrap = [
    {
      label: "bootstrap-wide",
      iterations: 20,
      populationSize: 28,
      eliteFraction: 0.25,
      initialStd: [0.08, 0.05, 0.7, 10, 10, 0.12, 0.08, 0.12, 0.12, 0.14],
      minStdScale: 0.15,
    },
    {
      label: "bootstrap-explore",
      iterations: 18,
      populationSize: 34,
      eliteFraction: 0.2,
      initialStd: [0.11, 0.07, 1.0, 18, 18, 0.18, 0.12, 0.18, 0.18, 0.22],
      minStdScale: 0.18,
    },
  ];

  const stabilizers = [
    {
      label: "stability-tight",
      iterations: 22,
      populationSize: 24,
      eliteFraction: 0.28,
      initialStd: [0.04, 0.03, 0.45, 6, 6, 0.08, 0.05, 0.08, 0.08, 0.1],
      minStdScale: 0.08,
    },
    {
      label: "score-tight",
      iterations: 26,
      populationSize: 26,
      eliteFraction: 0.25,
      initialStd: [0.05, 0.03, 0.5, 7, 7, 0.09, 0.06, 0.09, 0.09, 0.11],
      minStdScale: 0.06,
    },
  ];

  const explorers = [
    {
      label: "explore-reset",
      iterations: 16,
      populationSize: 36,
      eliteFraction: 0.18,
      initialStd: [0.13, 0.09, 1.2, 20, 20, 0.22, 0.15, 0.22, 0.22, 0.26],
      minStdScale: 0.2,
    },
    {
      label: "explore-alive",
      iterations: 18,
      populationSize: 30,
      eliteFraction: 0.22,
      initialStd: [0.09, 0.06, 0.9, 14, 14, 0.14, 0.1, 0.14, 0.14, 0.18],
      minStdScale: 0.14,
    },
  ];

  if (!bestEvaluation || bestEvaluation.clearRate < 0.7) {
    return stagnation >= 2 ? explorers[cycle % explorers.length] : bootstrap[cycle % bootstrap.length];
  }

  if (bestEvaluation.meanAliveCities < 2.5) {
    return stagnation >= 2 ? explorers[(cycle + 1) % explorers.length] : stabilizers[cycle % stabilizers.length];
  }

  return stagnation >= 2 ? stabilizers[(cycle + 1) % stabilizers.length] : stabilizers[1];
}

function loadHeuristicModel(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    if (raw?.config?.type !== "heuristic-weights") {
      return null;
    }
    return raw;
  } catch (error) {
    return null;
  }
}

function writeSummaryMarkdown(filePath, state) {
  const lines = [
    "# Heuristic PDCA Summary",
    "",
    `- Started: ${state.startedAt}`,
    `- Updated: ${new Date().toISOString()}`,
    `- Time Budget Hours: ${state.timeBudgetHours.toFixed(2)}`,
    `- Cycle: ${state.cycle}`,
    `- Stagnation: ${state.stagnation}`,
    "",
    "## Baseline",
    `- Clear rate: ${toMdPercent(state.baseline.clearRate)}`,
    `- Mean score: ${state.baseline.meanScore.toFixed(1)}`,
    `- Best score: ${state.baseline.bestScore.toFixed(1)}`,
    `- Mean alive cities: ${state.baseline.meanAliveCities.toFixed(2)}`,
    "",
    "## Best",
    `- Clear rate: ${toMdPercent(state.bestEvaluation?.clearRate ?? 0)}`,
    `- Mean score: ${(state.bestEvaluation?.meanScore ?? 0).toFixed(1)}`,
    `- Best score: ${(state.bestEvaluation?.bestScore ?? 0).toFixed(1)}`,
    `- Mean alive cities: ${(state.bestEvaluation?.meanAliveCities ?? 0).toFixed(2)}`,
    `- Objective: ${(state.bestEvaluation?.objective ?? 0).toFixed(2)}`,
    "",
    "## Last Check",
    `- Candidate: ${state.lastCandidate?.label ?? "-"}`,
    `- Improved: ${state.lastImproved ? "yes" : "no"}`,
    `- Candidate clear rate: ${toMdPercent(state.lastEvaluation?.clearRate ?? 0)}`,
    `- Candidate mean score: ${(state.lastEvaluation?.meanScore ?? 0).toFixed(1)}`,
    `- Candidate mean alive cities: ${(state.lastEvaluation?.meanAliveCities ?? 0).toFixed(2)}`,
    "",
    "## Act",
    state.actLine,
    "",
    "## Artifacts",
    `- Run Dir: ${state.runDir}`,
    `- Best Model: ${state.bestModelPath ?? "-"}`,
    `- Demo Policy: ${state.demoPolicyPath}`,
    `- History: ${state.historyPath}`,
  ];

  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2));
  const requestedHours = toNumber(args.hours, 8);
  const minutes = toNumber(args.minutes, requestedHours * 60);
  const timeBudgetHours = minutes / 60;
  const maxCycles = Math.max(1, Math.round(toNumber(args["max-cycles"], 9999)));
  const baseSeed = Math.round(toNumber(args.seed, 0x4c9d1021));
  const rootDir = resolve(process.cwd(), "./output/rl/heuristic-pdca");
  const runDir = resolve(rootDir, timestampTag());
  const historyPath = resolve(runDir, "history.jsonl");
  const summaryJsonPath = resolve(runDir, "latest-summary.json");
  const summaryMdPath = resolve(runDir, "latest-summary.md");
  const bestPolicyPath = resolve(runDir, "best-policy.json");
  const demoPolicyPath = resolve(process.cwd(), "./public/rl/demo-policy.json");
  const timeBudgetMs = minutes * 60 * 1000;
  const deadline = Date.now() + timeBudgetMs;
  const runStartedAt = new Date().toISOString();

  mkdirSync(runDir, { recursive: true });

  const baselineEvaluation = evaluateHeuristicConfigAcrossSeeds({
    config: DEFAULT_HEURISTIC_CONFIG,
    seeds: HOLDOUT_SEEDS,
  });
  const baselineModel = buildHeuristicModel({
    config: DEFAULT_HEURISTIC_CONFIG,
    evaluation: baselineEvaluation,
    seeds: HOLDOUT_SEEDS,
    trainer: "heuristic-baseline",
    name: "Orbital Shield Heuristic Baseline",
  });
  const baselineModelPath = resolve(runDir, "baseline-heuristic.json");
  writeJson(baselineModelPath, baselineModel);

  const existingDemoModel = loadHeuristicModel(demoPolicyPath);
  let bestConfig = normalizeHeuristicConfig(DEFAULT_HEURISTIC_CONFIG);
  let bestEvaluation = baselineEvaluation;
  let bestModelPath = baselineModelPath;
  let bestRank = rankEvaluation(bestEvaluation);
  let stagnation = 0;
  let cycle = 0;
  let lastCandidate = null;
  let lastEvaluation = null;
  let lastImproved = false;

  if (existingDemoModel) {
    const existingEvaluation = evaluateHeuristicConfigAcrossSeeds({
      config: existingDemoModel.heuristic?.params ?? DEFAULT_HEURISTIC_CONFIG,
      seeds: HOLDOUT_SEEDS,
    });
    const existingRank = rankEvaluation(existingEvaluation);
    if (existingRank > bestRank) {
      bestConfig = normalizeHeuristicConfig(existingDemoModel.heuristic?.params ?? DEFAULT_HEURISTIC_CONFIG);
      bestEvaluation = existingEvaluation;
      bestModelPath = demoPolicyPath;
      bestRank = existingRank;
    }
  }

  copyFileSync(bestModelPath, bestPolicyPath);
  copyFileSync(bestModelPath, demoPolicyPath);
  bestModelPath = bestPolicyPath;

  console.log("");
  console.log("=== Heuristic PDCA Run ===");
  console.log(`Run dir      : ${toRepoPath(runDir)}`);
  console.log(`Time budget  : ${timeBudgetHours.toFixed(2)}h`);
  console.log(
    `Baseline     : clear ${toMdPercent(baselineEvaluation.clearRate)}, mean score ${baselineEvaluation.meanScore.toFixed(1)}, alive ${baselineEvaluation.meanAliveCities.toFixed(2)}`,
  );
  console.log(
    `Current best : clear ${toMdPercent(bestEvaluation.clearRate)}, mean score ${bestEvaluation.meanScore.toFixed(1)}, alive ${bestEvaluation.meanAliveCities.toFixed(2)}`,
  );

  while (Date.now() < deadline && cycle < maxCycles) {
    const candidate = chooseCandidate(cycle, bestEvaluation, stagnation);
    const outFilePath = resolve(runDir, `cycle-${String(cycle + 1).padStart(3, "0")}-${candidate.label}.json`);
    const timeLeftMinutes = Math.max(0, (deadline - Date.now()) / 60000);

    console.log("");
    console.log(`[Cycle ${cycle + 1}] plan=${candidate.label} timeLeft=${timeLeftMinutes.toFixed(1)}m`);

    const training = await trainHeuristicWithCem({
      seed: (baseSeed + cycle * 131) >>> 0,
      iterations: candidate.iterations,
      populationSize: candidate.populationSize,
      eliteFraction: candidate.eliteFraction,
      initialConfig: bestConfig,
      initialStd: candidate.initialStd,
      minStdScale: candidate.minStdScale,
      seeds: TRAIN_SEEDS,
      warmStartPath: bestModelPath,
      outFilePath,
    });

    const evaluation = evaluateHeuristicConfigAcrossSeeds({
      config: training.config,
      seeds: HOLDOUT_SEEDS,
    });
    const candidateRank = rankEvaluation(evaluation);
    const improved = candidateRank > bestRank;

    if (improved) {
      bestConfig = training.config;
      bestEvaluation = evaluation;
      bestRank = candidateRank;
      bestModelPath = outFilePath;
      stagnation = 0;
      copyFileSync(outFilePath, bestPolicyPath);
      copyFileSync(outFilePath, demoPolicyPath);
    } else {
      stagnation += 1;
    }

    cycle += 1;
    lastCandidate = candidate;
    lastEvaluation = evaluation;
    lastImproved = improved;

    appendLine(
      historyPath,
      JSON.stringify({
        cycle,
        timestamp: new Date().toISOString(),
        improved,
        stagnation,
        candidate,
        trainingSummary: training.summary,
        evaluation,
        bestEvaluation,
        bestConfig,
        outFilePath: toRepoPath(outFilePath),
      }),
    );

    const state = {
      startedAt: runStartedAt,
      timeBudgetHours,
      cycle,
      stagnation,
      baseline: baselineEvaluation,
      bestEvaluation,
      bestModelPath: toRepoPath(bestModelPath),
      lastCandidate,
      lastEvaluation,
      lastImproved,
      runDir: toRepoPath(runDir),
      demoPolicyPath: toRepoPath(demoPolicyPath),
      historyPath: toRepoPath(historyPath),
      actLine: improved
        ? `改善が出たので ${candidate.label} を採用し、デモAIも更新しました。`
        : `改善が弱かったため現行ベストを維持し、次サイクルでは探索幅を調整します。`,
    };

    writeJson(summaryJsonPath, state);
    writeSummaryMarkdown(summaryMdPath, state);

    console.log(
      `[Cycle ${cycle}] check clear=${toMdPercent(evaluation.clearRate)} mean=${evaluation.meanScore.toFixed(1)} alive=${evaluation.meanAliveCities.toFixed(2)} improved=${improved ? "yes" : "no"}`,
    );
  }

  console.log("");
  console.log("=== Heuristic PDCA Finished ===");
  console.log(`Cycles       : ${cycle}`);
  console.log(`Best clear   : ${toMdPercent(bestEvaluation.clearRate)}`);
  console.log(`Best mean    : ${bestEvaluation.meanScore.toFixed(1)}`);
  console.log(`Best alive   : ${bestEvaluation.meanAliveCities.toFixed(2)}`);
  console.log(`Summary JSON : ${toRepoPath(summaryJsonPath)}`);
  console.log(`Summary MD   : ${toRepoPath(summaryMdPath)}`);
}
