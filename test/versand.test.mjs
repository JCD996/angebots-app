// Prüft die Versand-Logik gegen einen lokalen Test-Mailserver (SMTP) und ein simuliertes Postfach (IMAP).
import assert from "node:assert/strict";
import { SMTPServer } from "smtp-server";
import { config, senden, entwurfOrdnerWaehlen, VersandFehler } from "../netlify/lib/versand-logik.mjs";
import handler from "../netlify/functions/senden.mjs";

const PDF = Buffer.from("%PDF-1.3\n%Test\n").toString("base64");
const env = { APP_TOKEN: "geheim123", SMTP_USER: "info@beispiel.de", SMTP_PASS: "pw", MAIL_TO: "chef@beispiel.de", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525", ALLOWED_ORIGINS: "https://jcd996.github.io" };
const cfg = config(env);
let ok = 0; const t = async (name, fn) => { await fn(); ok++; console.log("✓", name); };

// --- SMTP-Testserver ---
const empfangen = [];
const smtp = new SMTPServer({
  authOptional: false, secure: false, disabledCommands: ["STARTTLS"],
  onAuth(auth, _s, cb) { auth.username === "info@beispiel.de" && auth.password === "pw" ? cb(null, { user: 1 }) : cb(Object.assign(new Error("Auth"), { responseCode: 535 })); },
  onData(stream, session, cb) { let d = ""; stream.on("data", c => d += c); stream.on("end", () => { empfangen.push({ to: session.envelope.rcptTo.map(r => r.address), data: d }); cb(); }); }
});
await new Promise(r => smtp.listen(2525, "127.0.0.1", r));
const extra = { transportExtra: { ignoreTLS: true } };

await t("Modus 'mich' sendet an MAIL_TO mit PDF-Anhang", async () => {
  const r = await senden(cfg, { token: "geheim123", modus: "mich", pdf: PDF, betreff: "Angebot 2026-001", text: "Hallo", dateiname: "Angebot_2026-001.pdf", kundeEmail: "fremd@spam.de" }, extra);
  assert.equal(r.ok, true);
  assert.deepEqual(empfangen.at(-1).to, ["chef@beispiel.de"]); // nie an Adresse aus der Anfrage
  assert.match(empfangen.at(-1).data, /Angebot_2026-001\.pdf/);
  assert.match(empfangen.at(-1).data, /application\/pdf/);
});
await t("Falsches SMTP-Passwort gibt verständliche Meldung", async () => {
  await assert.rejects(senden(config({ ...env, SMTP_PASS: "falsch" }), { token: "geheim123", modus: "mich", pdf: PDF }, extra), e => e.status === 502 && /Anmeldung/.test(e.message));
});
await t("Falscher Versand-Schlüssel wird abgelehnt", async () => {
  await assert.rejects(senden(cfg, { token: "nein", modus: "mich", pdf: PDF }, extra), e => e instanceof VersandFehler && e.status === 401);
});
await t("Kein PDF wird abgelehnt", async () => {
  await assert.rejects(senden(cfg, { token: "geheim123", modus: "mich", pdf: Buffer.from("hallo").toString("base64") }, extra), e => e.status === 400);
});

// --- IMAP simuliert ---
class FakeImap {
  static letzte; constructor(o) { this.o = o; FakeImap.letzte = this; }
  async connect() { if (this.o.auth.pass !== "pw") throw Object.assign(new Error("x"), { authenticationFailed: true }); }
  async list() { return [{ path: "INBOX", name: "INBOX" }, { path: "Entwürfe", name: "Entwürfe", specialUse: "\\Drafts" }, { path: "Gesendete Objekte", name: "Gesendete Objekte" }]; }
  async append(path, roh, flags) { this.appended = { path, roh: roh.toString(), flags }; }
  async logout() { this.closed = true; }
}
await t("Modus 'entwurf' legt Mail an Kunden in Entwürfe ab", async () => {
  const r = await senden(cfg, { token: "geheim123", modus: "entwurf", pdf: PDF, kundeEmail: "kunde@web.de", betreff: "Ihr Angebot", text: "Sehr geehrte…", dateiname: "Angebot.pdf" }, { ImapFlow: FakeImap });
  assert.equal(r.ok, true);
  const a = FakeImap.letzte.appended;
  assert.equal(a.path, "Entwürfe");
  assert.deepEqual(a.flags, ["\\Draft", "\\Seen"]);
  assert.match(a.roh, /^To: kunde@web\.de/m);
  assert.match(a.roh, /^From: info@beispiel\.de/m);
  assert.match(a.roh, /Angebot\.pdf/);
  assert.equal(FakeImap.letzte.closed, true);
});
await t("Ungültige Kunden-Mail wird abgelehnt", async () => {
  await assert.rejects(senden(cfg, { token: "geheim123", modus: "entwurf", pdf: PDF, kundeEmail: "a@b.de, c@d.de" }, { ImapFlow: FakeImap }), e => e.status === 400);
});
await t("Entwurfsordner wird auch ohne Kennzeichnung gefunden", async () => {
  assert.equal(entwurfOrdnerWaehlen([{ path: "INBOX" }, { path: "INBOX.Drafts", name: "Drafts" }]), "INBOX.Drafts");
  assert.equal(entwurfOrdnerWaehlen([{ path: "INBOX" }]), null);
});

// --- HTTP-Handler (Netlify) ---
Object.assign(process.env, env);
const req = (body, origin) => new Request("https://x.netlify.app/api/senden", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
await t("Fremde Webseite wird blockiert", async () => {
  const r = await handler(req({ token: "geheim123", modus: "mich", pdf: PDF }, "https://boese.example"));
  assert.equal(r.status, 403);
});
await t("Erlaubte Herkunft bekommt CORS-Header, Fehler als deutscher Text", async () => {
  const r = await handler(req({ token: "falsch", modus: "mich", pdf: PDF }, "https://jcd996.github.io"));
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://jcd996.github.io");
  assert.match((await r.json()).fehler, /Zugangs-PIN/);
});

smtp.close();
console.log(`\n${ok} Tests bestanden`);
