export type Stage = "briefing" | "introduction" | "experience" | "debrief";

export type Signal =
  | { type: "START"; now: number }
  | { type: "ANSWER"; now: number; text: string }
  | { type: "TICK"; now: number }
  | { type: "END"; now: number };

export interface Transition {
  from: Stage;
  to: Stage;
  reason: "candidate-ready" | "turn-limit" | "time-fallback" | "manual";
  at: number;
}

export interface InterviewState {
  stage: Stage;
  stageStartedAt: number;
  answers: string[];
  introTurns: number;
  experienceTurns: number;
  transitions: Transition[];
  evidence: string[];
}

export const INTRO_LIMIT_MS = 150_000;
export const EXPERIENCE_LIMIT_MS = 240_000;

export const initialInterviewState: InterviewState = {
  stage: "briefing",
  stageStartedAt: 0,
  answers: [],
  introTurns: 0,
  experienceTurns: 0,
  transitions: [],
  evidence: [],
};

const meaningfulIntro = (text: string) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const hasRole = /engineer|developer|designer|analyst|student|researcher|manager/i.test(text);
  const hasIntent = /looking|want|interested|excited|seeking|hope/i.test(text);
  return words.length >= 28 && hasRole && hasIntent;
};

const transition = (
  state: InterviewState,
  to: Stage,
  reason: Transition["reason"],
  at: number,
): InterviewState => ({
  ...state,
  stage: to,
  stageStartedAt: at,
  transitions: [...state.transitions, { from: state.stage, to, reason, at }],
});

export function reduceInterview(state: InterviewState, signal: Signal): InterviewState {
  if (signal.type === "START" && state.stage === "briefing") {
    return transition(state, "introduction", "manual", signal.now);
  }

  if (signal.type === "ANSWER") {
    const next = {
      ...state,
      answers: [...state.answers, signal.text],
      evidence: [...state.evidence, signal.text],
      introTurns: state.introTurns + (state.stage === "introduction" ? 1 : 0),
      experienceTurns: state.experienceTurns + (state.stage === "experience" ? 1 : 0),
    };

    if (state.stage === "introduction") {
      if (meaningfulIntro(signal.text)) {
        return transition(next, "experience", "candidate-ready", signal.now);
      }
      if (next.introTurns >= 2) {
        return transition(next, "experience", "turn-limit", signal.now);
      }
    }

    if (state.stage === "experience" && next.experienceTurns >= 3) {
      return transition(next, "debrief", "turn-limit", signal.now);
    }
    return next;
  }

  if (signal.type === "TICK") {
    const elapsed = signal.now - state.stageStartedAt;
    if (state.stage === "introduction" && elapsed >= INTRO_LIMIT_MS) {
      return transition(state, "experience", "time-fallback", signal.now);
    }
    if (state.stage === "experience" && elapsed >= EXPERIENCE_LIMIT_MS) {
      return transition(state, "debrief", "time-fallback", signal.now);
    }
  }

  if (signal.type === "END" && state.stage !== "debrief") {
    return transition(state, "debrief", "manual", signal.now);
  }

  return state;
}

export function nextPrompt(state: InterviewState): string {
  if (state.stage === "briefing") return "Ready when you are.";
  if (state.stage === "introduction" && state.introTurns === 0) {
    return "Give me the version of your story that cannot be read from your résumé.";
  }
  if (state.stage === "introduction") {
    return "What kind of problem do you want your next role to let you own?";
  }
  if (state.stage === "experience" && state.experienceTurns === 0) {
    return "Choose one project you care about. What was uncertain when you began?";
  }
  if (state.stage === "experience" && state.experienceTurns === 1) {
    return "What decision was specifically yours, and what alternative did you reject?";
  }
  if (state.stage === "experience") {
    return "What evidence tells you the work succeeded, and what would you change now?";
  }
  return "The interview is complete. Your evidence map is ready.";
}
