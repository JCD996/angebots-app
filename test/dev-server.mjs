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

Object.assign(process.env, { APP_TOKEN: "test", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2526", SMTP_USER: "info@beispiel.de", SMTP_PASS: "x", MAIL_TO: "info@jcd-consulting.de" });
const { default: handler } = await import("../netlify/functions/senden.mjs");
// lokaler Test-Mailserver hat kein TLS
const nm = (await import("nodemailer")).default; const orig = nm.createTransport;
nm.createTransport = o => orig({ ...o, ignoreTLS: true });

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "../docs"), types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/senden")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handler(new Request("http://localhost:8081" + req.url, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const f = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8081, () => console.log("bereit auf http://localhost:8081"));
