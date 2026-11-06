// Lokaler Testlauf: liefert die App aus docs/ und /api/senden gegen einen Test-Mailserver.
// Start: node test/dev-server.mjs  →  http://localhost:8081  (Versand-Schlüssel: test)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { SMTPServer } from "smtp-server";

const smtp = new SMTPServer({
  secure: false, disabledCommands: ["STARTTLS"], onAuth: (_a, _s, cb) => cb(null, { user: 1 }),
  onData(stream, session, cb) {
    let d = ""; stream.on("data", c => d += c);
    stream.on("end", () => { console.log(`MAIL an ${session.envelope.rcptTo.map(r => r.address)} | ${(d.match(/^Subject: (.*)$/m) || [])[1]} | ${(d.match(/filename="?([^";\r\n]+)/) || [])[1]} | ${d.length} Bytes`); cb(); });
  }
});
smtp.listen(2526, "127.0.0.1");

Object.assign(process.env, { APP_TOKEN: "test", ANTHROPIC_API_KEY: "sk-lokal", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2526", SMTP_USER: "info@beispiel.de", SMTP_PASS: "x", IMAP_HOST: "127.0.0.1", IMAP_PORT: "1", MAIL_TO: "info@jcd-consulting.de" });
const { default: handler } = await import("../netlify/functions/senden.mjs");
const { default: kiHandler } = await import("../netlify/edge-functions/ki.js");
// Anthropic wird lokal simuliert: feste Beispielantwort, kein echter Aufruf
const echtesFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (!String(url).startsWith("https://api.anthropic.com")) return echtesFetch(url, opt);
  const diktat = JSON.parse(opt.body).messages[0].content;
  console.log("KI (simuliert) für Diktat:", diktat.slice(28, 90));
  const p = (gruppe, katalog_id, titel, menge, einheit, einzelpreis, beschreibung = "") => ({ gruppe, katalog_id, titel, beschreibung, menge, einheit, einzelpreis, pruefen: false });
  const ergebnis = { kunde: { name: "Familie Schmidt", strasse: "Gartenweg 3", plz_ort: "50667 Köln", email: "schmidt@example.com", telefon: "" },
    bauvorhaben: "Badsanierung OG, Gartenweg 3, Köln", einleitung: "vielen Dank für den Ortstermin. Gerne bieten wir an:",
    positionen: [p("Bad OG", "A01", "Bodenfliesen entfernen", 7.5, "m²", 28, "(2,50 × 3,00 m)"), p("Bad OG", "F01", "Bodenfliesen verlegen bis 60x60 cm", 7.5, "m²", 48), p("Bad OG", "F07", "Bodengleiche Dusche mit Duschrinne", 1, "Stk", 450)],
    rueckfragen: ["Welches Format haben die Wandfliesen?"] };
  return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(ergebnis) }] }), { status: 200 });
};
// lokaler Test-Mailserver hat kein TLS
const nm = (await import("nodemailer")).default; const orig = nm.createTransport;
nm.createTransport = o => orig({ ...o, ignoreTLS: true });

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "../docs"), types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png" };
http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/senden") || req.url.startsWith("/api/ki")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await (req.url.startsWith("/api/ki") ? kiHandler : handler)(new Request("http://localhost:8081" + req.url, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const f = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8081, () => console.log("bereit auf http://localhost:8081"));
