import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { answerGuidance, coveredSignals, initialInterviewState, reduceInterview, signalLabel, type EvidenceSignal, type Stage } from "./interviewMachine";
import { integrityLabel, summarizeIntegrity, type IntegrityEvent } from "./integrityMonitor";
import { monitoringPolicy } from "./fairnessControls";
import { useLiveInterview, type PendingTranscript } from "./liveInterview";

const stages: { id: Stage; label: string; index: string }[] = [
  { id: "briefing", label: "Briefing", index: "00" }, { id: "introduction", label: "Your signal", index: "01" },
  { id: "experience", label: "Decision story", index: "02" }, { id: "debrief", label: "Evidence map", index: "03" }, { id: "ended", label: "Ended", index: "04" },
];
const ALL_SIGNALS: EvidenceSignal[] = ["identity", "strengths", "direction", "role-connection", "context", "ownership", "reasoning", "difficulty", "impact", "reflection"];

export function App() {
  const [localState, dispatch] = useReducer(reduceInterview, initialInterviewState);
  const [remoteState, setRemoteState] = useState<typeof localState | null>(null);
  const state = remoteState ?? localState;
  const [answer, setAnswer] = useState("");
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [originalTranscript, setOriginalTranscript] = useState("");
  const [reviewingTranscript, setReviewingTranscript] = useState(false);
  const [candidate, setCandidate] = useState("Candidate");
  const [role, setRole] = useState("AI Engineer");
  const [micOn, setMicOn] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [integrityEvents, setIntegrityEvents] = useState<IntegrityEvent[]>([]);
  const [repeatCount, setRepeatCount] = useState(0);
  const [captionStatus, setCaptionStatus] = useState("Subtitles on");
  const [focusAssist, setFocusAssist] = useState(false);
  const [lowMotion, setLowMotion] = useState(false);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [pendingLiveTranscript, setPendingLiveTranscript] = useState<PendingTranscript | null>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const receiveDirectorState = useCallback((next: typeof localState) => setRemoteState(next), []);
  const receiveFinalTranscript = useCallback((transcript: PendingTranscript) => { setPendingLiveTranscript(transcript); setOriginalTranscript(transcript.text); setTranscriptDraft(transcript.text); setReviewingTranscript(true); }, []);
  const live = useLiveInterview(videoHost, receiveDirectorState, receiveFinalTranscript);

  useEffect(() => {
    if (state.stage === "briefing" || state.stage === "debrief") return;
    const timer = window.setInterval(() => { const time = performance.now(); setNow(time); dispatch({ type: "TICK", now: time, timestamp: Date.now(), eventId: `ui-timer-${Math.floor(time / 1000)}`, stageEpoch: localState.stageEpoch }); }, 1000);
    return () => window.clearInterval(timer);
  }, [state.stage]);

  useEffect(() => {
    if ((state.stage !== "introduction" && state.stage !== "experience") || focusAssist) return;
    const record = (event: IntegrityEvent) => setIntegrityEvents((current) => [...current, event]);
    const onVisibility = () => { if (document.visibilityState === "hidden") record({ type: "tab-hidden", at: Date.now(), detail: "The interview page became hidden." }); };
    const onBlur = () => record({ type: "window-blur", at: Date.now(), detail: "The interview browser window lost focus." });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("blur", onBlur); };
  }, [state.stage, focusAssist]);

  useEffect(() => {
    setRepeatCount(0);
    setCaptionStatus("Subtitles on");
    window.speechSynthesis?.cancel();
  }, [state.currentPrompt]);

  const coverage = useMemo(() => new Set(coveredSignals(state, state.stage === "debrief" ? "experience" : state.stage)), [state]);
  const allCoverage = useMemo(() => new Set(state.evidence.flatMap((item) => item.signals)), [state.evidence]);
  const score = Math.round((allCoverage.size / ALL_SIGNALS.length) * 100);
  const guidance = answerGuidance(state.questionStartedAt, now);
  const integrity = summarizeIntegrity(integrityEvents);
  const monitoring = monitoringPolicy(focusAssist);
  const stageQuestions = state.stage === "introduction" ? 2 : 3;
  const startDemo = () => { setRemoteState(null); dispatch({type:"START",now:performance.now(),timestamp:Date.now(),eventId:"demo-start",stageEpoch:localState.stageEpoch}); };
  const startLive = async () => { await live.connect(candidate || "Candidate", role || "AI Engineer"); };
  const toggleMicrophone = async () => { if (live.isLive) await live.setMicrophoneEnabled(!live.micEnabled); else setMicOn(!micOn); };
  const endInterview = async () => { if (live.isLive) await live.disconnect(); else dispatch({type:"END",now:performance.now(),timestamp:Date.now(),eventId:`end-${Date.now()}`,stageEpoch:state.stageEpoch}); };

  const repeatQuestion = () => {
    setRepeatCount((count) => count + 1);
    if (live.isLive) { void live.requestRepeat(); return; }
    setCaptionStatus("Replaying question…");
    window.speechSynthesis?.cancel();
    const utterance = new SpeechSynthesisUtterance(state.currentPrompt);
    utterance.rate = 0.94;
    utterance.onend = () => setCaptionStatus("Subtitles on");
    utterance.onerror = () => setCaptionStatus("Subtitles on · audio unavailable");
    window.speechSynthesis?.speak(utterance);
  };

  const stageTranscript = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;
    setOriginalTranscript(answer.trim());
    setTranscriptDraft(answer.trim());
    setReviewingTranscript(true);
  };

  const confirmTranscript = () => {
    if (!transcriptDraft.trim()) return;
    if (live.isLive && pendingLiveTranscript) {
      void live.confirmTranscript(pendingLiveTranscript, transcriptDraft.trim());
      setPendingLiveTranscript(null); setTranscriptDraft(""); setOriginalTranscript(""); setReviewingTranscript(false);
      return;
    }
    const submittedAt = performance.now();
    dispatch({ type: "ANSWER", now: submittedAt, timestamp: Date.now(), eventId: `demo-answer-${Date.now()}`, stageEpoch: localState.stageEpoch, durationMs: submittedAt - state.questionStartedAt, text: transcriptDraft.trim(), transcriptEdited: transcriptDraft.trim() !== originalTranscript });
    setNow(submittedAt); setAnswer(""); setTranscriptDraft(""); setOriginalTranscript(""); setReviewingTranscript(false);
  };

  return <main className={lowMotion ? "low-motion" : ""}>
    <nav><div className="brand"><span>●</span> INTERVIEW DIRECTOR</div><div className="status"><i /> {live.isLive ? `LIVEKIT / ${live.status.toUpperCase()}` : "DEMO / READY"}</div></nav>
    {live.isLive && reviewingTranscript ? <div className="live-transcript-modal" role="dialog" aria-modal="true" aria-label="Confirm final transcript"><div className="transcript-review"><div className="review-head"><b>FINAL TRANSCRIPT · YOU CONTROL THE RECORD</b><span>Not evaluated yet</span></div><h3>Confirm what the interviewer heard.</h3><p>Interim words are ignored. Correct names or technical terms; edits are recorded for transparency and never count against you.</p><textarea aria-label="Final transcript awaiting confirmation" value={transcriptDraft} onChange={(event)=>setTranscriptDraft(event.target.value)} autoFocus/><div className="review-actions"><span/><button type="button" onClick={confirmTranscript}>Confirm transcript ↗</button></div></div></div> : null}
    <section className="hero"><div><p className="eyebrow">A CONVERSATION WITH MEMORY</p><h1>Your résumé lists outcomes.<br/><em>Tell us the decisions.</em></h1></div><p className="lede">A two-act interview that follows missing evidence, limits over-probing, and shows exactly why each question was asked.</p></section>
    <div className={`mode-banner ${remoteState ? "real" : "demo"}`}><b>{remoteState ? "REAL PROVIDER MODE" : "LOCAL DETERMINISTIC DEMO"}</b><span>{remoteState ? `LiveKit ${live.status} · Tavus ${live.avatarStatus}` : "No provider audio or avatar is active. Use Start live interview for the challenge demonstration."}</span></div>
    <section className="workspace">
      <aside className="rail">
        {stages.map((item) => <div className={`stage ${item.id === state.stage ? "active" : ""}`} key={item.id}><span>{item.index}</span><div><b>{item.label}</b><small>{item.id === state.stage ? "NOW" : ""}</small></div></div>)}
        <div className="principle"><span>DIRECTOR'S NOTE</span><p>No answer countdown. We use gentle guidance, a two-follow-up cap, and invisible stage fallbacks.</p></div>
      </aside>
      <div className="room">
        <div className="room-head"><div><small>CANDIDATE</small><input aria-label="Candidate name" value={candidate} onChange={(e)=>setCandidate(e.target.value)}/></div><div><small>ROLE</small><input aria-label="Target role" value={role} onChange={(e)=>setRole(e.target.value)}/></div></div>
        <div className="stage-view">
          <div className="avatar" aria-label="AI interviewer video"><div className={`avatar-badge ${live.avatarStatus}`}>TAVUS · {live.avatarStatus.toUpperCase()}</div><div ref={videoHost} className="avatar-media"/><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="face"><span>AI</span></div><div className="voice-bars">{[1,2,3,4,5,6,7].map((n)=><i key={n} style={{height:`${8+(n%4)*6}px`}}/>)}</div></div>
          {state.stage === "briefing" ? <div className="briefing"><span className="act">PRE-FLIGHT</span><h2>Two stages. Seven minutes.<br/>One story worth remembering.</h2><p className="brief-copy">Aim for one to two minutes per answer. I may ask a focused follow-up or gently move us forward so we can cover what employers need.</p><div className="fairness-controls"><b>ACCESSIBILITY & FAIRNESS</b><p>Choose what helps you participate. These settings are not evidence and never change your score.</p><label><input type="checkbox" checked={focusAssist} onChange={(e)=>setFocusAssist(e.target.checked)}/><span><strong>Focus Assist</strong> — permit assistive tools, notes, and context switching; pause attention monitoring.</span></label><label><input type="checkbox" checked={lowMotion} onChange={(e)=>setLowMotion(e.target.checked)}/><span><strong>Low motion</strong> — stop decorative animation.</span></label></div><div className="integrity-disclosure"><b>{monitoring.label.toUpperCase()}</b><p>{monitoring.explanation} We cannot see other tab URLs or identify which application you use.</p></div>{live.error?<p className="connection-error">{live.error}</p>:null}<div className="start-actions"><button onClick={()=>void startLive()} disabled={live.status==="connecting"}>{live.status==="connecting"?"Connecting…":"Start live interview"} <span>↗</span></button><button className="demo-start" onClick={startDemo}>Use credential-free demo</button></div></div>
          : state.stage === "debrief" ? <div className="debrief"><span className="act">EVIDENCE MAP</span><div className="score">{score}<sup>/100</sup></div><h2>{score >= 70 ? "Strong, well-supported signal" : "Useful signal—with clear gaps"}</h2><p>Captured {allCoverage.size} of {ALL_SIGNALS.length} employer-relevant signals across {state.evidence.length} confirmed answers. Missing evidence is reported, never invented.</p><div className="integrity-summary"><b>{monitoring.label.toUpperCase()} · {integrityEvents.length} SIGNALS</b><p>{focusAssist ? monitoring.explanation : integrity.statement}</p><span>Tab hidden {integrity.hidden} · Focus changes {integrity.blur} · Pastes {integrity.paste}</span></div><div className="signal-grid">{ALL_SIGNALS.map((item)=><span className={allCoverage.has(item)?"captured":"missing"} key={item}>{allCoverage.has(item)?"✓":"○"} {signalLabel(item)}</span>)}</div><div className="evidence-receipt"><b>CANDIDATE EVIDENCE RECEIPT</b>{state.evidence.map((item,index)=><details key={`${item.answeredAt}-${index}`}><summary>Answer {index+1} · {item.signals.length} signals {item.transcriptEdited?"· transcript corrected":""}</summary><p>{item.answer}</p><small>{item.signals.length ? item.signals.map(signalLabel).join(" · ") : "No employer signal inferred"}</small></details>)}</div><div className="recourse"><b>DISAGREE WITH THE MAP?</b><p>Automated evidence is decision support, not the final hiring decision. Request a human to review the confirmed answers and question-to-signal mapping.</p><button className={reviewRequested?"requested":""} onClick={()=>setReviewRequested(true)} disabled={reviewRequested}>{reviewRequested?"Human review requested ✓":"Request human review"}</button></div><button onClick={()=>void endInterview()}>End session</button></div>
          : state.stage === "ended" ? <div className="debrief"><span className="act">SESSION CLOSED</span><h2>Interview ended cleanly.</h2><p>Microphone, room, agent, and avatar resources have been released.</p><button onClick={()=>window.location.reload()}>Start a new interview</button></div>
          : <div className="conversation"><div className="question-meta"><span className="act">{state.stage === "introduction"?"ACT I — YOUR SIGNAL":"ACT II — DECISION STORY"}</span><span>QUESTION {state.primaryQuestion+1}/{stageQuestions} · FOLLOW-UP {state.followUpCount}/2</span></div><div className="subtitle" aria-live="polite"><span>CC · {captionStatus}</span><p>{state.currentPrompt}</p></div><div className="question-actions"><button type="button" className="repeat" onClick={repeatQuestion}>↻ Repeat question</button><small>{repeatCount ? `Repeated ${repeatCount} ${repeatCount===1?"time":"times"} · no score impact` : "Repeat anytime · no score impact"}</small></div><div className="why"><b>WHY THIS QUESTION</b><p>{state.promptReason}</p></div>{live.isLive?<div className="live-turn"><b>{live.telemetry.agent.toUpperCase()}</b><p>{live.micEnabled?"Your microphone is live. Speak naturally; the Director advances only on final transcripts.":"Microphone muted."}</p><button type="button" className={`mic ${live.micEnabled?"live":""}`} onClick={()=>void toggleMicrophone()}>{live.micEnabled?"Mute microphone":"Enable microphone"}</button></div>:reviewingTranscript ? <div className="transcript-review" role="region" aria-label="Transcript review"><div className="review-head"><b>YOU CONTROL THE RECORD</b><span>Not scored yet</span></div><h3>Review the transcript before it becomes evidence.</h3><p>Speech recognition can mishear accents, names, and technical terms. Correct anything below, or go back and answer again. The Director evaluates only what you confirm.</p><textarea aria-label="Transcript awaiting confirmation" value={transcriptDraft} onChange={(e)=>setTranscriptDraft(e.target.value)} autoFocus/><div className="review-actions"><button type="button" className="back" onClick={()=>{setAnswer(transcriptDraft);setReviewingTranscript(false)}}>← Revise answer</button><button type="button" onClick={confirmTranscript}>Confirm transcript ↗</button></div></div> : <form onSubmit={stageTranscript}><textarea aria-label="Interview answer" value={answer} onPaste={(event)=>setIntegrityEvents((current)=>[...current,{type:"paste",at:Date.now(),detail:`${event.clipboardData.getData("text").length} characters pasted.`}])} onChange={(e)=>setAnswer(e.target.value)} placeholder="Demo mode: type your spoken answer here…"/><p className={`guidance ${guidance.tone}`}>{guidance.text}</p><div className="controls"><button type="button" className={`mic ${micOn?"live":""}`} onClick={()=>void toggleMicrophone()}>{micOn?"Listening…":"Enable voice"}</button><button type="submit">Review transcript ↗</button></div></form>}<button className="end" onClick={()=>void endInterview()}>End interview</button></div>}
        </div>
      </div>
      <aside className="telemetry">
        <p className="eyebrow">LIVE TURN STATE</p><div className="metric"><span>CANDIDATE / INTERVIEWER</span><b className="mode-label">{live.telemetry.candidate.toUpperCase()} / {live.telemetry.agent.toUpperCase()}</b><small>microphone {live.micEnabled ? "enabled" : "muted"}</small></div><div className="metric"><span>END OF SPEECH → RECEIVED AUDIO</span><b>{live.telemetry.latency?.speechToAudibleMs === undefined ? "—" : `${live.telemetry.latency.speechToAudibleMs}ms`}</b><small>STT {live.telemetry.latency?.speechToTranscriptMs === undefined ? "not measured" : `${live.telemetry.latency.speechToTranscriptMs}ms`} · server speaking {live.telemetry.latency?.speechToAudioMs === undefined ? "not measured" : `${live.telemetry.latency.speechToAudioMs}ms`} · browser active-speaker signal · first-token unavailable</small></div><p className="eyebrow second">CONFIRMED TRANSCRIPTS</p>{state.evidence.slice(-3).map((record,index)=><div className="director-note" key={`${record.answeredAt}-${index}`}><span>{record.stage}{record.transcriptEdited ? " · corrected" : ""}</span>{record.answer}</div>)}{state.evidence.length===0?<p className="empty">Only candidate-confirmed final transcripts appear here.</p>:null}
        <p className="eyebrow">INTERRUPTIONS · {live.telemetry.interruptions}</p>{live.telemetry.interruptionEvents?.slice(-4).reverse().map((event,index)=><div className={`director-note ${event.kind}`} key={`${event.at}-${index}`}><span>{event.kind}</span>{event.detail}</div>)}{!live.telemetry.interruptionEvents?.length?<p className="empty">Confirmed interruptions and filtered noise appear here during a live session.</p>:null}
        <p className="eyebrow">EVIDENCE COVERAGE</p><div className="coverage-list">{(state.stage === "introduction" ? ALL_SIGNALS.slice(0,4) : ALL_SIGNALS.slice(4)).map((item)=><div className={coverage.has(item)?"hit":"gap"} key={item}><i/>{signalLabel(item)}</div>)}</div><div className={`integrity-live ${integrity.reviewRecommended?"review":""}`}><span>ATTENTION SIGNALS</span><b>{integrityEvents.length}</b><small>{integrity.reviewRecommended?"human review suggested":"monitoring disclosed"}</small></div>
        <div className="metric"><span>ACCESS MODE</span><b className="mode-label">{focusAssist?"FOCUS ASSIST":"STANDARD"}</b><small>never affects evidence score</small></div><div className="metric"><span>CONFIRMED RECORDS</span><b>{state.evidence.filter((item)=>item.candidateConfirmed).length}</b><small>{state.evidence.filter((item)=>item.transcriptEdited).length} transcript corrections</small></div><div className="metric"><span>FOLLOW-UP CAP</span><b>{state.followUpCount}/2</b><small>resets on new primary question</small></div><div className="metric"><span>HANDOFFS</span><b>{state.transitions.filter((t)=>t.from!=="briefing").length}</b><small>{state.transitions.at(-1)?.reason ?? "waiting"}</small></div>
        <p className="eyebrow second">SESSION LOG</p>{[...integrityEvents.slice(-3).map((event)=>({kind:"attention",at:event.at,message:integrityLabel(event.type)})),...state.directorNotes].sort((a,b)=>b.at-a.at).slice(0,5).map((note,index)=><div className={`director-note ${note.kind}`} key={`${note.at}-${index}`}><span>{note.kind}</span>{note.message}</div>)}{state.directorNotes.length===0&&integrityEvents.length===0?<p className="empty">Reasons for follow-ups, redirects, handoffs, and attention changes appear here.</p>:null}
      </aside>
    </section>
  </main>;
}
