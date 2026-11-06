// Netlify-Funktion: POST /api/senden
import { config as ladeConfig, senden, VersandFehler } from "../lib/versand-logik.mjs";

export default async (req) => {
  const cfg = ladeConfig(process.env);
  const origin = req.headers.get("origin") || "";
  const cors = cfg.origins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin" }
    : {};
  const antwort = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return antwort(405, { ok: false, fehler: "Nur POST erlaubt." });
  // Fremde Webseiten dürfen die Funktion nicht nutzen; gleiche Herkunft (App auf derselben Netlify-Seite) ist immer erlaubt.
  if (origin && !cfg.origins.includes(origin) && origin !== new URL(req.url).origin) return antwort(403, { ok: false, fehler: "Herkunft nicht erlaubt." });

  let body;
  try { body = await req.json(); } catch { return antwort(400, { ok: false, fehler: "Ungültige Anfrage." }); }
  try {
    return antwort(200, await senden(cfg, body));
  } catch (e) {
    const status = e instanceof VersandFehler ? e.status : 500;
    return antwort(status, { ok: false, fehler: e instanceof VersandFehler ? e.message : "Interner Fehler beim Versand." });
  }
};

export const config = { path: "/api/senden" };
