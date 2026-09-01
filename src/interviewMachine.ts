export type Stage = "briefing" | "introduction" | "experience" | "debrief";
export type IntroSignal = "identity" | "strengths" | "direction" | "role-connection";
export type ExperienceSignal = "context" | "ownership" | "reasoning" | "difficulty" | "impact" | "reflection";
export type EvidenceSignal = IntroSignal | ExperienceSignal;

export interface EvidenceRecord { answer: string; stage: Stage; signals: EvidenceSignal[]; answeredAt: number; durationMs: number; candidateConfirmed: boolean; transcriptEdited: boolean; }
export interface DirectorNote { kind: "follow-up" | "redirect" | "transition" | "support"; at: number; message: string; }
export type Signal = { type: "START"; now: number } | { type: "ANSWER"; now: number; text: string; durationMs?: number; transcriptEdited?: boolean } | { type: "TICK"; now: number } | { type: "END"; now: number };
export interface Transition { from: Stage; to: Stage; reason: "evidence-complete" | "question-limit" | "time-fallback" | "manual"; at: number; }

export interface InterviewState {
  stage: Stage; stageStartedAt: number; questionStartedAt: number; primaryQuestion: number;
  followUpCount: number; turnsInStage: number; currentPrompt: string; promptReason: string;
  transitions: Transition[]; evidence: EvidenceRecord[]; directorNotes: DirectorNote[];
}

export const INTRO_LIMIT_MS = 150_000;
export const EXPERIENCE_LIMIT_MS = 300_000;
export const SOFT_REDIRECT_MS = 150_000;
export const MAX_FOLLOW_UPS = 2;

const INTRO_QUESTIONS = ["Give me the version of your story that cannot be read from your résumé.", "What kind of problem do you want your next role to let you own, and why this role?"];
const EXPERIENCE_QUESTIONS = ["Choose one project you care about. What problem existed, and what was uncertain when you began?", "What decision was specifically yours, and what alternative did you reject?", "What evidence tells you the work succeeded, and what would you change now?"];
const FOLLOW_UPS: Record<EvidenceSignal, string> = {
  identity: "How would you describe your professional identity in one clear sentence?",
  strengths: "Which strength would your teammates rely on you for, and where have you demonstrated it?",
  direction: "What responsibility or problem do you want to own next?",
  "role-connection": "What specifically makes this role a meaningful next step for you?",
  context: "What was happening before the project, and why did the problem matter?",
  ownership: "Which part was personally yours—not the team's work in general?",
  reasoning: "Why did you choose that approach, and what alternative did you consider?",
  difficulty: "What constraint, failure, or uncertainty made the work genuinely difficult?",
  impact: "What measurable or observable evidence shows that the work succeeded?",
  reflection: "With what you know now, what would you redesign or do differently?",
};
const LABELS: Record<EvidenceSignal, string> = { identity: "professional identity", strengths: "demonstrated strengths", direction: "career direction", "role-connection": "connection to the role", context: "problem context", ownership: "personal ownership", reasoning: "decision reasoning", difficulty: "constraints or difficulty", impact: "measurable impact", reflection: "reflection and learning" };

export const initialInterviewState: InterviewState = { stage: "briefing", stageStartedAt: 0, questionStartedAt: 0, primaryQuestion: 0, followUpCount: 0, turnsInStage: 0, currentPrompt: "Ready when you are.", promptReason: "Interview has not started.", transitions: [], evidence: [], directorNotes: [] };

const has = (pattern: RegExp, text: string) => pattern.test(text);
export function extractSignals(stage: Stage, text: string): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  if (stage === "introduction") {
    if (has(/\b(i am|i'm|my background|currently|student|engineer|developer|designer|analyst|researcher|manager)\b/i, text)) signals.push("identity");
    if (has(/\b(strength|skilled|speciali[sz]e|good at|experience with|expertise|build|built|lead|led)\b/i, text)) signals.push("strengths");
    if (has(/\b(next|want|looking|seeking|goal|hope|grow|own|responsibility)\b/i, text)) signals.push("direction");
    if (has(/\b(this role|this position|company|opportunity|mission|team|because|interested|excited)\b/i, text)) signals.push("role-connection");
  }
  if (stage === "experience") {
    if (has(/\b(problem|needed|before|customer|user|business|goal|challenge|situation|context)\b/i, text)) signals.push("context");
    if (has(/\b(i designed|i built|i implemented|i owned|i led|my responsibility|personally|my role|i created)\b/i, text)) signals.push("ownership");
    if (has(/\b(because|decided|chose|tradeoff|alternative|instead|reason|compared)\b/i, text)) signals.push("reasoning");
    if (has(/\b(constraint|failed|failure|difficult|uncertain|limited|risk|issue|blocker|challenge)\b/i, text)) signals.push("difficulty");
    if (has(/\b(impact|result|improved|reduced|increased|grew|saved|measured|percent|%|users|revenue|latency)\b/i, text)) signals.push("impact");
    if (has(/\b(learned|differently|next time|in hindsight|redesign|improve now|would change)\b/i, text)) signals.push("reflection");
  }
  return [...new Set(signals)];
}

export function coveredSignals(state: InterviewState, stage = state.stage): EvidenceSignal[] { return [...new Set(state.evidence.filter((item) => item.stage === stage).flatMap((item) => item.signals))]; }
function nextGap(state: InterviewState): EvidenceSignal | undefined {
  const covered = new Set(coveredSignals(state));
  const priority: EvidenceSignal[] = state.stage === "introduction" ? ["identity", "strengths", "direction", "role-connection"] : ["ownership", "reasoning", "impact", "context", "difficulty", "reflection"];
  return priority.find((item) => !covered.has(item));
}
function evidenceComplete(state: InterviewState): boolean {
  const covered = new Set(coveredSignals(state));
  const required: EvidenceSignal[] = state.stage === "introduction" ? ["identity", "strengths", "direction", "role-connection"] : ["context", "ownership", "reasoning", "impact"];
  return required.every((item) => covered.has(item));
}
function transition(state: InterviewState, to: Stage, reason: Transition["reason"], at: number): InterviewState {
  return { ...state, stage: to, stageStartedAt: at, questionStartedAt: at, primaryQuestion: 0, followUpCount: 0, turnsInStage: 0,
    currentPrompt: to === "experience" ? EXPERIENCE_QUESTIONS[0] : to === "debrief" ? "The interview is complete. Your evidence map is ready." : state.currentPrompt,
    promptReason: to === "introduction" ? state.promptReason : to === "experience" ? "Beginning the past-experience stage." : "Interview evidence collection is complete.",
    transitions: [...state.transitions, { from: state.stage, to, reason, at }],
    directorNotes: [...state.directorNotes, { kind: "transition", at, message: `Moved from ${state.stage} to ${to}: ${reason}.` }] };
}

export function reduceInterview(state: InterviewState, signal: Signal): InterviewState {
  if (signal.type === "START" && state.stage === "briefing") return transition({ ...state, currentPrompt: INTRO_QUESTIONS[0], promptReason: "Opening question establishes identity, strengths, and direction." }, "introduction", "manual", signal.now);
  if (signal.type === "ANSWER" && (state.stage === "introduction" || state.stage === "experience")) {
    const durationMs = signal.durationMs ?? Math.max(0, signal.now - state.questionStartedAt);
    const record: EvidenceRecord = { answer: signal.text, stage: state.stage, signals: extractSignals(state.stage, signal.text), answeredAt: signal.now, durationMs, candidateConfirmed: true, transcriptEdited: signal.transcriptEdited ?? false };
    let next: InterviewState = { ...state, evidence: [...state.evidence, record], turnsInStage: state.turnsInStage + 1 };
    if (durationMs >= SOFT_REDIRECT_MS) next = { ...next, directorNotes: [...next.directorNotes, { kind: "redirect", at: signal.now, message: "Answer passed the soft 2½-minute guide; the next prompt narrows focus without penalizing the candidate." }] };
    const questions = state.stage === "introduction" ? INTRO_QUESTIONS : EXPERIENCE_QUESTIONS;
    const finalPrimary = state.primaryQuestion >= questions.length - 1;
    if (evidenceComplete(next) && (state.stage === "introduction" ? state.primaryQuestion >= 1 : state.primaryQuestion >= 2)) return transition(next, state.stage === "introduction" ? "experience" : "debrief", "evidence-complete", signal.now);
    const gap = nextGap(next);
    if (gap && state.followUpCount < MAX_FOLLOW_UPS) return { ...next, followUpCount: state.followUpCount + 1, questionStartedAt: signal.now, currentPrompt: FOLLOW_UPS[gap], promptReason: `Follow-up ${state.followUpCount + 1}/${MAX_FOLLOW_UPS}: ${LABELS[gap]} was not yet demonstrated.`, directorNotes: [...next.directorNotes, { kind: "follow-up", at: signal.now, message: `Asked a follow-up because ${LABELS[gap]} was unclear.` }] };
    if (!finalPrimary) return { ...next, primaryQuestion: state.primaryQuestion + 1, followUpCount: 0, questionStartedAt: signal.now, currentPrompt: questions[state.primaryQuestion + 1], promptReason: gap ? `Follow-up cap reached; recording the ${LABELS[gap]} gap and moving forward.` : "Advancing to collect a different hiring signal." };
    return transition(next, state.stage === "introduction" ? "experience" : "debrief", "question-limit", signal.now);
  }
  if (signal.type === "TICK") {
    const elapsed = signal.now - state.stageStartedAt;
    if (state.stage === "introduction" && elapsed >= INTRO_LIMIT_MS) return transition(state, "experience", "time-fallback", signal.now);
    if (state.stage === "experience" && elapsed >= EXPERIENCE_LIMIT_MS) return transition(state, "debrief", "time-fallback", signal.now);
  }
  if (signal.type === "END" && state.stage !== "debrief") return transition(state, "debrief", "manual", signal.now);
  return state;
}

export function answerGuidance(questionStartedAt: number, now: number): { tone: "quiet" | "healthy" | "guide"; text: string } {
  const elapsed = now - questionStartedAt;
  if (elapsed < 15_000) return { tone: "quiet", text: "Take your time—specific examples are welcome." };
  if (elapsed <= 120_000) return { tone: "healthy", text: "Listening for context, ownership, reasoning, and impact." };
  return { tone: "guide", text: "When you reach a natural stopping point, land on the result or learning." };
}
export const signalLabel = (signal: EvidenceSignal) => LABELS[signal];
