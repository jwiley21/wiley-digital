// supabase/functions/chat/index.ts

// ===== Env =====
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const LLM_PROVIDER   = Deno.env.get("LLM_PROVIDER")   ?? "groq";
const GROQ_API_KEY   = Deno.env.get("GROQ_API_KEY")   ?? "";
const KNOWLEDGE_URL  = Deno.env.get("KNOWLEDGE_URL")  ?? ""; // e.g. http://127.0.0.1:5500/public/knowledge.json

// ===== Types & utils =====
type Msg = { role: "system" | "user" | "assistant"; content: string };
type FAQ = { q: string; a: string };


function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
}

// Tiny in-memory rate limiter: 3 req / 15s / IP
type RateBucket = Map<string, number[]>;
declare global { var __rateBucket: RateBucket | undefined; }
const rateBucket: RateBucket = globalThis.__rateBucket ?? new Map<string, number[]>();
globalThis.__rateBucket = rateBucket;

// ===== Knowledge loader (with 60s cache) =====
let knowledgeCache = { text: "", ts: 0 };
async function loadKnowledge(): Promise<string> {
  const now = Date.now();
  if (knowledgeCache.text && now - knowledgeCache.ts < 60_000) return knowledgeCache.text;
  if (!KNOWLEDGE_URL) return "";

  try {
    const r = await fetch(KNOWLEDGE_URL, { headers: { "Accept": "application/json" } });
    if (!r.ok) return "";
    const data = await r.json();

    const lines: string[] = [];
    if (data.company)  lines.push(`Company: ${data.company}`);
    if (data.tagline)  lines.push(`Tagline: ${data.tagline}`);
    if (Array.isArray(data.services)) lines.push(`Services: ${data.services.join(", ")}`);
    if (data.pricing) {
      const p = data.pricing;
      lines.push(
        `Pricing: basic=${p.basic_site ?? "n/a"}, advanced=${p.advanced_site ?? "n/a"}, chatbot_addon=${p.chatbot_addon ?? "n/a"}`
      );
    }
    if (Array.isArray(data.faqs)) {
      const faqs = data.faqs as FAQ[];
      lines.push("Top FAQs:");
      lines.push(...faqs.slice(0, 8).map((f, i) => `${i + 1}. Q: ${f.q} A: ${f.a}`));
    }


    knowledgeCache = { text: lines.join("\n"), ts: now };
    return knowledgeCache.text;
  } catch {
    return "";
  }
}

// ===== LLM (Groq) =====
async function callLLM(messages: Msg[]) {
  if (LLM_PROVIDER !== "groq") {
    return { reply: `Unsupported provider '${LLM_PROVIDER}'. Set LLM_PROVIDER=groq.` };
  }
  if (!GROQ_API_KEY) {
    return { reply: "GROQ_API_KEY missing on server." };
  }

  const context = await loadKnowledge();

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    // System prompt + context + chat history
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      messages: [  
        { role: "system", content: "You are Wiley Digital's assistant. Use provided context faithfully; if missing, say you don't know, and ask clarifying questions before estimating." },
        ...(context ? [{ role: "system", content: `Context:\n${context}` } as Msg] : []),
        ...messages
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Groq error:", resp.status, errText);
    return { reply: `Groq error (${resp.status}): ${errText}` };
    // Example 400 if model name is wrong; example 429 if rate-limited.
  }

  const json = await resp.json();
  const reply = json?.choices?.[0]?.message?.content ?? "…";
  return { reply };
}

// ===== HTTP handler =====
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(), status: 204 });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...Object.fromEntries(corsHeaders()), "Content-Type": "application/json" },
    });
  }

  try {
    const { messages = [] } = (await req.json()) as { messages?: Msg[] };

    // Rate limit
    const ip = req.headers.get("x-forwarded-for") ?? "anon";
    const now = Date.now();
    const recent = (rateBucket.get(ip) ?? []).filter((t) => now - t < 15_000);
    if (recent.length >= 3) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { ...Object.fromEntries(corsHeaders()), "Content-Type": "application/json" },
      });
    }
    rateBucket.set(ip, [...recent, now]);

    const result = await callLLM(messages);
    return new Response(JSON.stringify(result), {
      headers: { ...Object.fromEntries(corsHeaders()), "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message ?? "Server error" }), {
      status: 500,
      headers: { ...Object.fromEntries(corsHeaders()), "Content-Type": "application/json" },
    });
  }
});
