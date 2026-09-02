import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import type { InterviewState } from "./interviewMachine";

export type LiveStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";
export interface InterruptionDiagnostic { at: number; kind: "confirmed" | "noise-filtered"; detail: string }
export interface LatencyTelemetry { speechEndedAt?: number; finalTranscriptAt?: number; firstAgentTokenAt?: number; firstAudioAt?: number; firstAudibleAudioAt?: number; speechToTranscriptMs?: number; transcriptToAudioMs?: number; speechToAudioMs?: number; speechToAudibleMs?: number }
export interface LiveTelemetry { agent: "initializing" | "idle" | "listening" | "thinking" | "speaking"; candidate: "speaking" | "listening" | "away"; interruptions: number; interruptionEvents?: InterruptionDiagnostic[]; latency?: LatencyTelemetry; firstTokenMeasurement?: string; }
export interface PendingTranscript { id: string; text: string; stageEpoch: number }
export type AvatarStatus = "unavailable" | "loading" | "connected" | "reconnecting" | "error";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8787").replace(/\/$/, "");

export function useLiveInterview(videoHost: RefObject<HTMLDivElement | null>, onDirectorState: (state: InterviewState) => void, onFinalTranscript: (transcript: PendingTranscript) => void) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState("");
  const [micEnabled, setMicEnabledState] = useState(false);
  const [telemetry, setTelemetry] = useState<LiveTelemetry>({ agent: "initializing", candidate: "listening", interruptions: 0 });
  const telemetryRef = useRef<LiveTelemetry>(telemetry);
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("unavailable");

  const attachTrack = useCallback((track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    const host = videoHost.current;
    if (!host) return;
    const element = track.attach();
    element.dataset.participant = participant.identity;
    element.autoplay = true;
    if (track.kind === Track.Kind.Video) element.className = "avatar-video";
    else element.className = "remote-audio";
    host.appendChild(element);
    if (track.kind === Track.Kind.Video) setAvatarStatus("connected");
  }, [videoHost]);

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect(true);
    videoHost.current?.replaceChildren();
    setMicEnabledState(false);
    setStatus("idle");
    setAvatarStatus("unavailable");
  }, [videoHost]);

  const connect = useCallback(async (candidate: string, role: string) => {
    if (roomRef.current) return;
    setStatus("connecting"); setError("");
    try {
      const response = await fetch(`${API_URL}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate, role }) });
      const session = await response.json();
      if (!response.ok || session.mode !== "live") throw new Error(session.error || "LiveKit session could not be created.");
      setAvatarStatus(session.tavusConfigured ? "loading" : "unavailable");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, attachTrack);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (!speakers.some((participant) => participant.identity !== room.localParticipant.identity)) return;
        const current = telemetryRef.current;
        const marks = current.latency;
        if (!marks?.speechEndedAt || marks.firstAudibleAudioAt) return;
        const at = Date.now();
        const next = { ...current, latency: { ...marks, firstAudibleAudioAt: at, speechToAudibleMs: Math.max(0, at - marks.speechEndedAt) } };
        telemetryRef.current = next; setTelemetry(next);
      });
      room.on(RoomEvent.Reconnecting, () => { setStatus("reconnecting"); setAvatarStatus((current) => current === "unavailable" ? current : "reconnecting"); });
      room.on(RoomEvent.Reconnected, () => setStatus("connected"));
      room.on(RoomEvent.Disconnected, () => { setStatus("idle"); setMicEnabledState(false); });
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "interview.state") return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload));
          if (event.type === "director-state") onDirectorState(event.state);
          if (event.type === "telemetry") setTelemetry((current) => { const next = { ...current, ...event.telemetry, latency: { ...current.latency, ...event.telemetry.latency } }; telemetryRef.current = next; return next; });
          if (event.type === "transcript-final") onFinalTranscript({ id: event.id, text: event.text, stageEpoch: event.stageEpoch });
          if (event.type === "avatar-status") { setAvatarStatus(event.status); if (event.error) setError(event.error); }
          if (event.type === "agent-error") { setError(event.error || "The interview worker reported an error."); setAvatarStatus("error"); }
        } catch { /* Ignore malformed non-authoritative packets. */ }
      });
      await room.prepareConnection(session.livekitUrl, session.token);
      await room.connect(session.livekitUrl, session.token, { autoSubscribe: true });
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicEnabledState(true); setStatus("connected");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to connect.");
      await disconnect();
      setStatus("error");
      setAvatarStatus("error");
      throw caught;
    }
  }, [attachTrack, disconnect, onDirectorState, onFinalTranscript]);

  const setMicrophoneEnabled = useCallback(async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    setMicEnabledState(enabled);
  }, []);

  const requestRepeat = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "repeat-question" })), { reliable: true, topic: "interview.command" });
  }, []);

  const confirmTranscript = useCallback(async (transcript: PendingTranscript, text: string) => {
    const room = roomRef.current;
    if (!room) return;
    const command = { type: "confirm-transcript", id: transcript.id, stageEpoch: transcript.stageEpoch, text };
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(command)), { reliable: true, topic: "interview.command" });
  }, []);

  useEffect(() => () => { void disconnect(); }, [disconnect]);
  return { connect, disconnect, setMicrophoneEnabled, requestRepeat, confirmTranscript, status, error, micEnabled, telemetry, avatarStatus, isLive: status === "connected" || status === "reconnecting" };
}
