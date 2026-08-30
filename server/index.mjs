import "dotenv/config";
import cors from "cors";
import express from "express";
import { AccessToken } from "livekit-server-sdk";

const app = express();
const port = Number(process.env.PORT || 8787);
const origin = process.env.APP_ORIGIN || "http://localhost:5173";

app.use(cors({ origin }));
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    services: {
      livekit: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
      tavus: Boolean(process.env.TAVUS_API_KEY && process.env.TAVUS_PERSONA_ID && process.env.TAVUS_REPLICA_ID),
    },
  });
});

app.post("/api/session", async (request, response) => {
  const candidate = String(request.body?.candidate || "Candidate").slice(0, 80);
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
  });
  access.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

  response.json({
    mode: "live",
    livekitUrl: process.env.LIVEKIT_URL,
    room,
    token: await access.toJwt(),
  });
});

app.post("/api/avatar/conversation", async (request, response) => {
  if (!process.env.TAVUS_API_KEY || !process.env.TAVUS_PERSONA_ID || !process.env.TAVUS_REPLICA_ID) {
    return response.status(503).json({ mode: "demo", error: "Tavus credentials are not configured." });
  }

  const conversationResponse = await fetch("https://tavusapi.com/v2/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.TAVUS_API_KEY,
    },
    body: JSON.stringify({
      persona_id: process.env.TAVUS_PERSONA_ID,
      replica_id: process.env.TAVUS_REPLICA_ID,
      conversation_name: `Interview Director — ${String(request.body?.candidate || "Candidate").slice(0, 80)}`,
      properties: { enable_recording: false, max_call_duration: 900 },
    }),
  });

  const payload = await conversationResponse.json();
  response.status(conversationResponse.status).json(payload);
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "The session could not be created." });
});

app.listen(port, () => {
  console.log(`Interview Director API listening on http://localhost:${port}`);
});
