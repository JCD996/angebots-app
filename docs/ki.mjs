// KI-Anfrage für das Angebot. Wird von der App (direkter Modus) und vom Server (/api/ki) gemeinsam genutzt.
export const MODELL = "claude-opus-5-5";
export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_HEADER = { "content-type": "application/json", "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" };

export const SCHEMA = {
  type:"object", additionalProperties:false,
  required:["kunde","bauvorhaben","einleitung","positionen","rueckfragen"],
  properties:{
    kunde:{type:"object",additionalProperties:false,required:["name","strasse","plz_ort","email","telefon"],
      properties:{name:{type:"string"},strasse:{type:"string"},plz_ort:{type:"string"},email:{type:"string"},telefon:{type:"string"}}},
    bauvorhaben:{type:"string"},
    einleitung:{type:"string"},
    positionen:{type:"array",items:{type:"object",additionalProperties:false,
      required:["gruppe","katalog_id","titel","beschreibung","menge","einheit","einzelpreis","pruefen"],
      properties:{gruppe:{type:"string"},katalog_id:{type:"string"},titel:{type:"string"},beschreibung:{type:"string"},
        menge:{type:"number"},einheit:{type:"string"},einzelpreis:{type:"number"},pruefen:{type:"boolean"}}}},
    rueckfragen:{type:"array",items:{type:"string"}}
  }
};

const zeile = s => String(s ?? "").replace(/[\r\n|]+/g, " ").slice(0, 300);

export function systemPrompt(firma, katalog){
  return `Du bist die Kalkulationshilfe eines Fliesenleger- und Ausbaubetriebs (${zeile(firma)}). Der Inhaber spricht auf der Baustelle frei ein, was er gesehen hat und anbieten will. Du machst daraus die Positionen eines Angebots.

Regeln:
- Nutze bevorzugt Positionen aus dem Leistungskatalog (katalog_id, titel, einheit und einzelpreis exakt aus dem Katalog übernehmen; beschreibung darf um Details aus dem Diktat ergänzt werden, z. B. Fliesenformat oder Raum).
- Mengen aus genannten Maßen berechnen. Bodenfläche = Länge × Breite. Wandfläche = Umfang × Höhe, abzüglich Türen/Fenster nur wenn genannt. Rechne auf zwei Nachkommastellen. Den Rechenweg kurz in die beschreibung schreiben (z. B. "(2,40 × 3,00 m)").
- Sinnvolle Begleitpositionen, die fachlich zwingend dazugehören (z. B. Abdichtung im Duschbereich, Silikonfugen, Material), darfst du ergänzen, aber setze dann pruefen=true.
- Leistungen, die nicht im Katalog stehen: katalog_id="" (leerer String), realistischer Netto-Marktpreis als Schätzung, pruefen=true.
- Fehlt eine Menge und lässt sie sich nicht ableiten: menge=0, pruefen=true und eine kurze Rückfrage in rueckfragen.
- gruppe = Raum oder Bauabschnitt (z. B. "Bad OG", "Küche", "Allgemein"). Positionen derselben Gruppe zusammenhängend auflisten.
- Kundendaten nur übernehmen, wenn sie gesagt wurden, sonst leere Strings. Erfinde keine Namen oder Adressen.
- bauvorhaben: kurze Bezeichnung, z. B. "Badsanierung Obergeschoss, Hauptstraße 5, Musterstadt".
- einleitung: ein bis zwei höfliche Sätze für das Angebot, Sie-Form, ohne Anrede.
- Diktierfehler der Spracherkennung sinnvoll interpretieren.

Leistungskatalog (Preise netto in Euro):
${(katalog || []).slice(0, 500).map(p => [p.id, p.titel, p.beschreibung, p.einheit, Number(p.preis) || 0].map(zeile).join(" | ")).join("\n")}`;
}

export function anfrage(firma, katalog, diktat){
  return {
    model: MODELL,
    max_tokens: 16000,
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: systemPrompt(firma, katalog),
    messages: [{ role: "user", content: "Diktat von der Baustelle:\n\n" + String(diktat).slice(0, 20000) }]
  };
}

// Übersetzt die API-Antwort in das Ergebnis oder einen verständlichen Fehler.
export function auswerten(status, data){
  if(status < 200 || status >= 300){
    const m = (data && data.error && data.error.message) || "";
    if(status === 401) throw new Error("KI-Schlüssel ist ungültig.");
    if(/credit|balance/i.test(m)) throw new Error("KI-Guthaben ist aufgebraucht. Bitte unter console.anthropic.com aufladen.");
    if(status === 404 || /model/i.test(m)) throw new Error("Das KI-Modell ist nicht mehr verfügbar. Bitte den App-Anbieter kontaktieren.");
    if(status === 429 || status === 529) throw new Error("Die KI ist gerade ausgelastet. Bitte in einer Minute erneut versuchen.");
    throw new Error(m || "KI-Fehler (" + status + ")");
  }
  if(data.stop_reason === "refusal") throw new Error("Die KI hat die Anfrage abgelehnt.");
  if(data.stop_reason === "max_tokens") throw new Error("Antwort wurde abgeschnitten – Diktat kürzer fassen.");
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(txt);
}
