// Edge Function: chat — Wiley Digital
// Deno runtime, no third-party deps

// ── ENV ────────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const GROQ_API_KEY   = Deno.env.get("GROQ_API_KEY")   ?? "";
const GROQ_MODEL     = Deno.env.get("GROQ_MODEL")     ?? "llama-3.1-8b-instant";
const KNOWLEDGE_URL  = Deno.env.get("KNOWLEDGE_URL")  ?? "";

// ── TYPES ─────────────────────────────────────────────────────────────────────
type Role = "system" | "user" | "assistant";
interface ChatMessage { role: Role; content: string; }

// ── CORS ──────────────────────────────────────────────────────────────────────
function corsHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": ALLOWED_ORIGIN, // "*" while testing; tighten later
    "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function normalizeRole(r: unknown): Role {
  return r === "assistant" || r === "system" ? r : "user";
}
function coerceMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map((v): ChatMessage => {
    if (isRecord(v)) {
      const role = normalizeRole(v.role);
      const content = typeof v.content === "string" ? v.content : String(v.content ?? "");
      return { role, content };
    }
    return { role: "user", content: String(v) };
  });
}

async function fetchKnowledge(): Promise<string> {
  if (!KNOWLEDGE_URL) return "";
  try {
    const r = await fetch(KNOWLEDGE_URL, { cache: "no-store" });
    if (!r.ok) return "";
    const json = await r.json();
    // keep prompt small
    return JSON.stringify(json).slice(0, 20_000);
  } catch {
    return "";
  }
}

async function callGroq(messages: ChatMessage[]): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.3,
      messages, // OpenAI-compatible format
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GROQ ${res.status}: ${text}`);
  }
  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content ?? "";
  return reply;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const headers = corsHeaders();
  headers.set("content-type", "application/json");

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers,
    });
  }

  try {
    // Body: { messages: ChatMessage[] (user/assistant history) }
    const bodyUnknown = await req.json().catch(() => ({}));
    const msgs = isRecord(bodyUnknown) ? coerceMessages(bodyUnknown["messages"]) : [];

    const kb = await fetchKnowledge();
    const system: ChatMessage = {
      role: "system",
      content: [
        "You are Jackson's Wiley Digital assistant.",
        "Be concise and helpful about websites, web apps, AI solutions, and the portfolio.",
        kb ? `Knowledge (may be partial): ${kb}` : "",
      ].filter(Boolean).join("\n\n"),
    };

    const groqMessages: ChatMessage[] = [system, ...msgs];
    const reply = await callGroq(groqMessages);

    return new Response(JSON.stringify({ reply }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
  }
});
