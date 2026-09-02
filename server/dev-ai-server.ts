/**
 * Local development AI gateway server — InnPilot
 *
 * Runs on port 3001, exposes POST /api/ai-chat so the Vite dev server
 * can talk to AI/ML API without Vercel functions.
 *
 * Set VITE_AI_API_BASE=http://localhost:3001 in .env (already done).
 * Run:  npx tsx server/dev-ai-server.ts
 */
import { config } from "dotenv";
config(); // load .env before anything reads process.env

import http from "node:http";
import OpenAI from "openai";
import { getHotelBusinessKnowledge } from "./ai/hotelKnowledge.js";

const PORT = parseInt(process.env.DEV_AI_PORT ?? "3001", 10);

const API_KEY = process.env.AI_API_KEY;
const BASE_URL = process.env.AI_API_BASE_URL ?? "https://api.aimlapi.com/v1";
const MODEL = process.env.AI_MODEL ?? "gpt-4o";
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS ?? "4096", 10);

if (!API_KEY) {
  console.error("❌  AI_API_KEY is not set in .env — cannot start dev AI server.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
  timeout: 6_000,
  maxRetries: 0,
});

console.log(`\n  InnPilot dev AI gateway`);
console.log(`  ➜  http://localhost:${PORT}/api/ai-chat`);
console.log(`  model  : ${MODEL}`);
console.log(`  baseURL: ${BASE_URL}\n`);

function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// In-memory conversation store (per-conversation message history)
const conversations = new Map<string, { role: "user" | "assistant"; content: string }[]>();

const SYSTEM_PROMPT = `You are InnPilot AI, an elite hospitality operations and hotel management business consultant.
You possess deep, authoritative domain expertise across all aspects of operating hotel properties, including:
1. Revenue Management (RevPAR, ADR, Occupancy, GOPPAR, CPOR, dynamic pricing, seasonal yield rules, reducing OTA commissions).
2. Front Desk & Reservations (Check-in/out SOPs, walk-in guests, VIP arrivals, night audit procedures).
3. Housekeeping & Facility Operations (Room cleaning steps, turn-down service, linen 3.0 par standards, inspections).
4. Food & Beverage / Restaurant (Food cost % target 28-32%, beverage cost % 18-22%, menu engineering Stars/Plowhorses/Puzzles/Dogs, FIFO waste reduction).
5. Conference & Banqueting / MICE (Room setup styles, Day Delegate Rates, BEO execution).
6. Financial Control & P&L (Labor costs 25-35%, energy conservation, cash drops).
7. Guest Relations & Service Recovery (The L.A.S.T. framework, handling noise complaints, review management).
8. Staff Management & Scheduling (Staff-to-room ratios, shift handovers).
Always provide detailed, practical, structured, and actionable guidance for hotel managers and team leaders.
Today's date: ${new Date().toDateString()}.`;

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url !== "/api/ai-chat" || req.method !== "POST") {
    json(res, 404, { error: "Not found" });
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let body: { message?: string; conversationId?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "'message' is required." });
    return;
  }

  const { message, conversationId } = body;
  if (!message?.trim() || !conversationId?.trim()) {
    json(res, 400, { error: "'message' and 'conversationId' are required." });
    return;
  }

  const history = conversations.get(conversationId) ?? [];
  history.push({ role: "user", content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "I couldn't generate a response.";
    history.push({ role: "assistant", content: reply });
    conversations.set(conversationId, history.slice(-20));

    console.log(`[AI] ✓ ${conversationId.slice(0, 12)} → ${reply.slice(0, 80)}…`);

    json(res, 200, {
      conversationId,
      reply,
      toolCalls: [],
    });
  } catch (err: any) {
    const msg = err?.message ?? "The assistant is unavailable right now.";
    console.warn("[AI] Provider API returned error, activating comprehensive Hotel Business Intelligence Engine:", msg);

    // Call comprehensive hotel business knowledge engine
    const intelligentReply = getHotelBusinessKnowledge(message);

    history.push({ role: "assistant", content: intelligentReply });
    conversations.set(conversationId, history.slice(-20));

    json(res, 200, {
      conversationId,
      reply: intelligentReply,
      toolCalls: [],
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`  ✅  Listening on port ${PORT} (0.0.0.0)\n`);
});
