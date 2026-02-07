import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractProtected(text) {
  const urls = text.match(/\bhttps?:\/\/[^\s]+/gi) || [];
  const emails = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  const handles = text.match(/(^|[\s])@[a-zA-Z0-9_]{1,30}\b/g) || [];
  const numbers = text.match(/\b\d{2,}[\d\s.,:/-]*\b/g) || [];
  return { urls, emails, handles, numbers };
}

function norm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function includesAll(originalList, candidateText) {
  const c = norm(candidateText);
  return originalList.every(x => c.includes(norm(x)));
}

function isSafe(original, corrected) {
  if (!corrected || typeof corrected !== "string") return false;

  const ratio = corrected.length / Math.max(1, original.length);
  if (ratio < 0.60 || ratio > 1.40) return false;

  const p = extractProtected(original);
  if (!includesAll(p.urls, corrected)) return false;
  if (!includesAll(p.emails, corrected)) return false;
  if (!includesAll(p.numbers, corrected)) return false;

  const hs = p.handles.map(h => h.trim());
  if (!includesAll(hs, corrected)) return false;

  return true;
}

async function meaningAudit(original, corrected, lang) {
  const audit = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a strict semantic auditor. Answer ONLY 'YES' or 'NO'. " +
          "YES only if meaning is strictly identical. NO if any meaning changed."
      },
      {
        role: "user",
        content:
          `Language: ${lang || "auto"}\n` +
          `ORIGINAL:\n${original}\n\nCORRECTED:\n${corrected}\n`
      }
    ]
  });

  const out = (audit.choices?.[0]?.message?.content || "").trim().toUpperCase();
  return out.startsWith("YES");
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

    const system = `
You are Greenlight in FIX mode.
Correct spelling, grammar, punctuation, accents, apostrophes, and typography.

Rules:
- Do NOT change meaning.
- Do NOT rewrite or paraphrase.
- You MAY fix obvious typos even inside informal text.
- Keep slang/abbreviations as-is (e.g., "g pa", "tps", "stp"). Do NOT expand them.
- Keep names, numbers, emails, URLs, @handles unchanged.
Return ONLY the corrected text.
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Language: ${language}\nText:\n${input}` }
      ]
    });

    const out = (completion.choices?.[0]?.message?.content || "").trim();

    if (!out) {
      res.status(200).json({ text: input, blocked: true, reason: "empty_output" });
      return;
    }

    const okMeaning = await meaningAudit(input, out, language);
    if (!okMeaning) {
      res.status(200).json({ text: input, blocked: true, reason: "meaning_changed" });
      return;
    }

    if (!isSafe(input, out)) {
      res.status(200).json({ text: input, blocked: true, reason: "safety_filter" });
      return;
    }

    res.status(200).json({ text: out, blocked: false });
  } catch (e) {
    // On répond quand même en 200 pour éviter de casser le client
    res.status(200).json({
      text: (req.body && req.body.text) ? String(req.body.text) : "",
      blocked: true,
      reason: "exception"
    });
  }
}
