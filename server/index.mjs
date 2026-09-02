import "dotenv/config";
import cors from "cors";
import express from "express";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedOrigins = (process.env.APP_ORIGIN || "http://localhost:5173").split(",").map((value) => value.trim()).filter(Boolean);
const sessionSchema = z.object({ candidate: z.string().trim().min(1).max(80).optional(), role: z.string().trim().min(1).max(120).optional() }).strict();
const tavusSchema = z.object({ candidate: z.string().trim().min(1).max(80).optional() }).strict();
const endedConversations = new Set();
const activeConversations = new Map();

app.disable("x-powered-by");
app.use(cors({ origin: (requestOrigin, callback) => callback(null, !requestOrigin || allowedOrigins.includes(requestOrigin)), methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    services: {
      livekit: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
      tavus: Boolean(process.env.TAVUS_API_KEY),
      agentModels: Boolean(process.env.LIVEKIT_STT_MODEL || process.env.LIVEKIT_LLM_MODEL || process.env.LIVEKIT_TTS_MODEL),
    },
  });
});

app.post("/api/session", async (request, response) => {
  const parsed = sessionSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Candidate must be 1–80 characters and role must be 1–120 characters." });
  const candidate = parsed.data.candidate || "Candidate";
  const role = parsed.data.role || "AI Engineer";
  const room = `interview-${crypto.randomUUID()}`;

  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return response.status(503).json({
      mode: "demo",
      error: "LiveKit credentials are not configured.",
    });
  }

  const access = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `candidate-${crypto.randomUUID()}`,
    name: candidate,
    ttl: "15m",
    metadata: JSON.stringify({ role }),
  });
  access.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

  response.json({
    mode: "live",
    livekitUrl: process.env.LIVEKIT_URL,
    room,
    token: await access.toJwt(),
    tavusConfigured: Boolean(process.env.TAVUS_API_KEY && (process.env.TAVUS_PERSONA_ID || process.env.TAVUS_PAL_ID) && (process.env.TAVUS_REPLICA_ID || process.env.TAVUS_FACE_ID)),
  });
});

app.post("/api/tavus/conversations", async (request, response) => {
  if (!process.env.TAVUS_API_KEY || !process.env.TAVUS_PERSONA_ID || !process.env.TAVUS_REPLICA_ID) return response.status(503).json({ error: "Tavus Persona/Replica credentials are not configured." });
  const parsed = tavusSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Candidate must be between 1 and 80 characters." });
  const candidate = parsed.data.candidate || "Candidate";
  const upstream = await fetch("https://tavusapi.com/v2/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.TAVUS_API_KEY },
    body: JSON.stringify({
      persona_id: process.env.TAVUS_PERSONA_ID,
      replica_id: process.env.TAVUS_REPLICA_ID,
      conversation_name: `Interview Director — ${candidate}`,
      require_auth: true,
      max_participants: 2,
      properties: { enable_recording: false },
    }),
  });
  const payload = await upstream.json().catch(() => ({ error: "Tavus returned an unreadable response." }));
  if (upstream.ok && payload.conversation_id) {
    const conversationId = payload.conversation_id;
    const timer = setTimeout(async () => {
      if (!activeConversations.has(conversationId) || endedConversations.has(conversationId)) return;
      try { await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(conversationId)}/end`, { method: "POST", headers: { "x-api-key": process.env.TAVUS_API_KEY } }); }
      finally { activeConversations.delete(conversationId); endedConversations.add(conversationId); }
    }, 15 * 60 * 1000);
    timer.unref();
    activeConversations.set(conversationId, timer);
  }
  response.status(upstream.status).json(payload);
});

app.post("/api/tavus/conversations/:conversationId/end", async (request, response) => {
  if (!process.env.TAVUS_API_KEY) return response.status(503).json({ error: "Tavus is not configured." });
  const conversationId = String(request.params.conversationId || "");
  if (!/^c[a-zA-Z0-9_-]{5,80}$/.test(conversationId)) return response.status(400).json({ error: "Invalid Tavus conversation ID." });
  if (endedConversations.has(conversationId)) return response.status(200).json({ ended: true, conversationId, idempotent: true });
  const upstream = await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(conversationId)}/end`, { method: "POST", headers: { "x-api-key": process.env.TAVUS_API_KEY } });
  if (upstream.status === 200 || upstream.status === 204) {
    clearTimeout(activeConversations.get(conversationId)); activeConversations.delete(conversationId); endedConversations.add(conversationId);
    return response.status(200).json({ ended: true, conversationId, idempotent: false });
  }
  const payload = await upstream.json().catch(() => ({ error: "Tavus conversation could not be ended." }));
  response.status(upstream.status).json(payload);
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "The session could not be created." });
});

app.listen(port, () => {
  console.log(`Interview Director API listening on http://localhost:${port}`);
});
