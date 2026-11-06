// Netlify Edge Function: POST /api/ki
// Der Anthropic-Schlüssel liegt nur hier auf dem Server (ANTHROPIC_API_KEY), nie in der App.
// Edge Functions warten beliebig auf die KI-Antwort, ohne dass das Zeitlimit normaler Funktionen greift.
import { anfrage, auswerten, API_URL, API_HEADER } from "../../docs/ki.mjs";

const env = name => (globalThis.Netlify ? Netlify.env.get(name) : globalThis.process?.env?.[name]) || "";

function gleich(a, b){
  a = String(a); b = String(b || "");
  if(!a || a.length !== b.length) return false;
  let d = 0; for(let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default async (req) => {
  const origins = env("ALLOWED_ORIGINS").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") || "";
  const cors = origins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin" } : {};
  const antwort = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });

  if(req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if(req.method !== "POST") return antwort(405, { ok: false, fehler: "Nur POST erlaubt." });
  if(origin && !origins.includes(origin) && origin !== new URL(req.url).origin) return antwort(403, { ok: false, fehler: "Herkunft nicht erlaubt." });

  let body;
  try { body = await req.json(); } catch { return antwort(400, { ok: false, fehler: "Ungültige Anfrage." }); }
  if(!env("ANTHROPIC_API_KEY") || !env("APP_TOKEN")) return antwort(500, { ok: false, fehler: "KI ist auf dem Server noch nicht eingerichtet." });
  if(!gleich(env("APP_TOKEN"), body.token)) return antwort(401, { ok: false, fehler: "Zugangs-PIN ist falsch." });
  if(typeof body.diktat !== "string" || !body.diktat.trim()) return antwort(400, { ok: false, fehler: "Diktat fehlt." });
  if(!Array.isArray(body.katalog)) return antwort(400, { ok: false, fehler: "Leistungskatalog fehlt." });

  try {
    const res = await fetch(API_URL, { method: "POST", headers: { ...API_HEADER, "x-api-key": env("ANTHROPIC_API_KEY") },
      body: JSON.stringify(anfrage(body.firma, body.katalog, body.diktat)) });
    const data = await res.json().catch(() => ({}));
    return antwort(200, { ok: true, ergebnis: auswerten(res.status, data) });
  } catch(e) {
    return antwort(502, { ok: false, fehler: e.message || "KI nicht erreichbar." });
  }
};

export const config = { path: "/api/ki" };
