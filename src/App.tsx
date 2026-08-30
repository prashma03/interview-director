import { FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import {
  initialInterviewState,
  nextPrompt,
  reduceInterview,
  type Stage,
} from "./interviewMachine";

const stages: { id: Stage; label: string; index: string }[] = [
  { id: "briefing", label: "Briefing", index: "00" },
  { id: "introduction", label: "Your signal", index: "01" },
  { id: "experience", label: "Decision story", index: "02" },
  { id: "debrief", label: "Evidence map", index: "03" },
];

export function App() {
  const [state, dispatch] = useReducer(reduceInterview, initialInterviewState);
  const [answer, setAnswer] = useState("");
  const [candidate, setCandidate] = useState("Pronita");
  const [role, setRole] = useState("AI Algorithm Engineer");
  const [micOn, setMicOn] = useState(false);

  useEffect(() => {
    if (state.stage === "briefing" || state.stage === "debrief") return;
    const timer = window.setInterval(() => dispatch({ type: "TICK", now: Date.now() }), 1000);
    return () => window.clearInterval(timer);
  }, [state.stage]);

  const score = useMemo(() => {
    const words = state.evidence.join(" ").split(/\s+/).filter(Boolean).length;
    return Math.min(96, 58 + Math.floor(words / 5));
  }, [state.evidence]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;
    dispatch({ type: "ANSWER", now: Date.now(), text: answer.trim() });
    setAnswer("");
  };

  return (
    <main>
      <nav>
        <div className="brand"><span>●</span> INTERVIEW DIRECTOR</div>
        <div className="status"><i /> DEMO ROOM / STABLE</div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">A CONVERSATION WITH MEMORY</p>
          <h1>Your résumé lists outcomes.<br /><em>Tell us the decisions.</em></h1>
        </div>
        <p className="lede">A two-act interview that follows the strongest thread in your story, yields when you speak, and shows exactly why it moved forward.</p>
      </section>

      <section className="workspace">
        <aside className="rail">
          {stages.map((item) => (
            <div className={`stage ${item.id === state.stage ? "active" : ""}`} key={item.id}>
              <span>{item.index}</span><div><b>{item.label}</b><small>{item.id === state.stage ? "NOW" : ""}</small></div>
            </div>
          ))}
          <div className="principle"><span>DIRECTOR'S NOTE</span><p>We score concrete evidence, not accent, speed, or performance style.</p></div>
        </aside>

        <div className="room">
          <div className="room-head">
            <div><small>CANDIDATE</small><input value={candidate} onChange={(e) => setCandidate(e.target.value)} /></div>
            <div><small>ROLE</small><input value={role} onChange={(e) => setRole(e.target.value)} /></div>
          </div>

          <div className="stage-view">
            <div className="avatar" aria-label="AI interviewer portrait placeholder">
              <div className="orbit orbit-a" /><div className="orbit orbit-b" />
              <div className="face"><span>AI</span></div>
              <div className="voice-bars">{[1,2,3,4,5,6,7].map((n) => <i key={n} style={{height: `${8 + (n % 4) * 6}px`}} />)}</div>
            </div>

            {state.stage === "briefing" ? (
              <div className="briefing">
                <span className="act">PRE-FLIGHT</span>
                <h2>Two stages. Seven minutes.<br />One story worth remembering.</h2>
                <button onClick={() => dispatch({ type: "START", now: Date.now() })}>Enter interview <span>↗</span></button>
              </div>
            ) : state.stage === "debrief" ? (
              <div className="debrief">
                <span className="act">EVIDENCE MAP</span>
                <div className="score">{score}<sup>/100</sup></div>
                <h2>Your strongest signal: ownership</h2>
                <p>{state.evidence.length ? `We captured ${state.evidence.length} answers and ${state.transitions.length} auditable stage transitions.` : "Complete an interview to generate your map."}</p>
                <button onClick={() => window.location.reload()}>Run another interview</button>
              </div>
            ) : (
              <div className="conversation">
                <span className="act">{state.stage === "introduction" ? "ACT I — YOUR SIGNAL" : "ACT II — DECISION STORY"}</span>
                <h2>{nextPrompt(state)}</h2>
                <form onSubmit={submit}>
                  <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Demo mode: type your spoken answer here…" />
                  <div className="controls">
                    <button type="button" className={`mic ${micOn ? "live" : ""}`} onClick={() => setMicOn(!micOn)}>{micOn ? "Listening…" : "Enable voice"}</button>
                    <button type="submit">Send answer ↗</button>
                  </div>
                </form>
                <button className="end" onClick={() => dispatch({ type: "END", now: Date.now() })}>End interview</button>
              </div>
            )}
          </div>
        </div>

        <aside className="telemetry">
          <p className="eyebrow">LIVE DIRECTION</p>
          <div className="metric"><span>TURN LATENCY</span><b>—</b><small>connect LiveKit</small></div>
          <div className="metric"><span>INTERRUPTIONS</span><b>0</b><small>adaptive mode</small></div>
          <div className="metric"><span>HANDOFFS</span><b>{state.transitions.filter((t) => t.from !== "briefing").length}</b><small>{state.transitions.at(-1)?.reason ?? "waiting"}</small></div>
          <p className="eyebrow second">CAPTURED EVIDENCE</p>
          {state.evidence.length === 0 ? <p className="empty">Signals appear here as the conversation develops.</p> : state.evidence.map((item, index) => <div className="evidence" key={index}><span>0{index + 1}</span>{item.slice(0, 92)}{item.length > 92 ? "…" : ""}</div>)}
        </aside>
      </section>
    </main>
  );
}
