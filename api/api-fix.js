import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractProtected(text) {
  const urls = text.match(/\bhttps?:\/\/[^\s]+/gi) || [];
  const emails = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  const handles = text.match(/(^|[\s])@[a-zA-Z0-9_]{1,30}\b/g) || [];
  const numbers = text.match(/\b\d[\d\s.,:/-]*\b/g) || [];
  return { urls, emails, handles, numbers };
}

function includesAll(originalList, candidateText) {
  return originalList.every(x => candidateText.includes(x.trim()));
}

function isSafe(original, corrected) {
  if (!corrected || typeof corrected !== "string") return false;

  // budget de changement (évite les réécritures)
  const ratio = corrected.length / Math.max(1, original.length);
  if (ratio < 0.75 || ratio > 1.25) return false;

  // invariants
  const p = extractProtected(original);
  if (!includesAll(p.urls, corrected)) return false;
  if (!includesAll(p.emails, corrected)) return false;
  if (!includesAll(p.numbers, corrected)) return false;
  // handles: on compare sans l'espace capturé
  const hs = p.handles.map(h => h.trim());
  if (!includesAll(hs, corrected)) return false;

  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  try {
    const { text, lang } = req.body || {};
    const input = (text ?? "").toString();
    const language = (lang ?? "auto").toString();

    if (!input.trim()) {
      res.status(200).json({ text: input, blocked: false });
      return;
    }

    const system = [
      "You are Greenlight FIX mode.",
      "Correct spelling, grammar, punctuation, and typography.",
      "DO NOT change meaning, tone, or register.",
      "DO NOT rewrite sentences. Make the smallest possible edits.",
      "DO NOT change any numbers, dates, currencies, emails, URLs, @handles, or proper names.",
      "Return ONLY the corrected text, no quotes, no explanations."
    ].join(" ");

    const user = `Language: ${language}\nText:\n${input}`;

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0
    });

    const out = (resp.output_text || "").trim();

    if (!out) {
      res.status(200).json({ text: input, blocked: true, reason: "empty_output" });
      return;
    }

    if (!isSafe(input, out)) {
      res.status(200).json({ text: input, blocked: true, reason: "safety_filter" });
      return;
    }

    res.status(200).json({ text: out, blocked: false });
  } catch (e) {
    res.status(200).json({ text: (req.body && req.body.text) ? String(req.body.text) : "", blocked: true, reason: "exception" });
  }
}
