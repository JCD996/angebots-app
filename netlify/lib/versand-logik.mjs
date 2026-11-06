// Versand-Logik, getrennt von Netlify, damit sie lokal testbar ist.
//   modus "mich":    PDF per SMTP an die eigene Adresse (MAIL_TO) senden
//   modus "entwurf": E-Mail an den Kunden mit PDF als Entwurf ins Postfach legen (IMAP)
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ImapFlow } from "imapflow";
import { timingSafeEqual } from "node:crypto";

const MAX_PDF_BASE64 = 4 * 1024 * 1024; // ca. 3 MB PDF

export class VersandFehler extends Error {
  constructor(status, meldung) { super(meldung); this.status = status; }
}

export function config(env) {
  const user = env.SMTP_USER;
  return {
    token: env.APP_TOKEN || "",
    smtpHost: env.SMTP_HOST || "smtp.ionos.de",
    smtpPort: Number(env.SMTP_PORT || 587),
    imapHost: env.IMAP_HOST || "imap.ionos.de",
    imapPort: Number(env.IMAP_PORT || 993),
    user, pass: env.SMTP_PASS,
    to: env.MAIL_TO || user,
    fromName: env.MAIL_FROM_NAME || "",
    origins: (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
    entwurfOrdner: env.DRAFTS_FOLDER || ""
  };
}

function tokenOk(erwartet, erhalten) {
  const a = Buffer.from(String(erwartet)), b = Buffer.from(String(erhalten || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function pruefen(cfg, body) {
  if (!cfg.user || !cfg.pass || !cfg.token) throw new VersandFehler(500, "Versand ist auf dem Server nicht vollständig eingerichtet.");
  if (!tokenOk(cfg.token, body.token)) throw new VersandFehler(401, "Zugangs-PIN ist falsch.");
  if (!["mich", "entwurf"].includes(body.modus)) throw new VersandFehler(400, "Unbekannter Versandmodus.");
  if (typeof body.pdf !== "string" || !body.pdf.length) throw new VersandFehler(400, "PDF fehlt.");
  if (body.pdf.length > MAX_PDF_BASE64) throw new VersandFehler(413, "PDF ist zu groß.");
  if (!Buffer.from(body.pdf.slice(0, 8), "base64").toString("latin1").startsWith("%PDF")) throw new VersandFehler(400, "Datei ist kein PDF.");
  if (body.modus === "entwurf" && body.kundeEmail && !/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(body.kundeEmail))
    throw new VersandFehler(400, "E-Mail-Adresse des Kunden ist ungültig.");
}

function nachricht(cfg, body) {
  const from = cfg.fromName ? { name: cfg.fromName, address: cfg.user } : cfg.user;
  const text = String(body.text || "").slice(0, 20000);
  const betreff = String(body.betreff || "Angebot").replace(/[\r\n]+/g, " ").slice(0, 200);
  const dateiname = String(body.dateiname || "Angebot.pdf").replace(/[^\w.\-äöüÄÖÜß]+/g, "_").slice(0, 120);
  const anhang = { filename: dateiname.endsWith(".pdf") ? dateiname : dateiname + ".pdf", content: Buffer.from(body.pdf, "base64"), contentType: "application/pdf" };
  // Im Modus "mich" geht die Mail immer an die fest hinterlegte Adresse – nie an eine Adresse aus der Anfrage.
  const to = body.modus === "mich" ? cfg.to : (body.kundeEmail || undefined);
  return { from, to, subject: betreff, text, attachments: [anhang] };
}

export function entwurfOrdnerWaehlen(ordner, wunsch) {
  if (wunsch) return ordner.find(o => o.path === wunsch)?.path || null;
  const special = ordner.find(o => o.specialUse === "\\Drafts");
  if (special) return special.path;
  const namen = ["Entwürfe", "Drafts", "INBOX.Drafts", "INBOX/Drafts", "Entwurf"];
  for (const n of namen) { const f = ordner.find(o => o.path === n || o.name === n); if (f) return f.path; }
  return null;
}

export async function senden(cfg, body, deps = {}) {
  pruefen(cfg, body);
  const mail = nachricht(cfg, body);

  if (body.modus === "mich") {
    const transport = (deps.createTransport || nodemailer.createTransport)({
      host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpPort === 465,
      auth: { user: cfg.user, pass: cfg.pass }, ...(deps.transportExtra || {})
    });
    try { await transport.sendMail(mail); }
    catch (e) { throw new VersandFehler(502, e.responseCode === 535 ? "Anmeldung am Mailserver fehlgeschlagen (Benutzer/Passwort prüfen)." : "Mailserver hat abgelehnt: " + e.message); }
    finally { transport.close?.(); }
    return { ok: true, meldung: "Angebot wurde an " + cfg.to + " gesendet." };
  }

  const roh = await new MailComposer(mail).compile().build();
  const client = new (deps.ImapFlow || ImapFlow)({ host: cfg.imapHost, port: cfg.imapPort, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  try {
    try { await client.connect(); }
    catch (e) { throw new VersandFehler(502, e.authenticationFailed ? "Anmeldung am Postfach fehlgeschlagen (Benutzer/Passwort prüfen)." : "Postfach nicht erreichbar: " + e.message); }
    const ordner = entwurfOrdnerWaehlen(await client.list(), cfg.entwurfOrdner);
    if (!ordner) throw new VersandFehler(502, "Entwürfe-Ordner im Postfach nicht gefunden.");
    await client.append(ordner, roh, ["\\Draft", "\\Seen"]);
  } finally { try { await client.logout(); } catch (_) {} }
  return { ok: true, meldung: "Angebot liegt als Entwurf in Ihrem Postfach." };
}
