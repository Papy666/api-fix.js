import OpenAI from "openai";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const { text, lang } = req.body || {};
  const input = (text ?? "").toString();
  const language = (lang ?? "auto").toString();

  if (!input.trim()) {
    res.status(200).json({ text: input, blocked: false });
    return;
  }

  const client = getClient();
  if (!client) {
    res.status(200).json({ text: input, blocked: true, reason: "missing_api_key" });
    return;
  }

  try {
    const system =
      "You are Greenlight in FIX mode. Correct spelling, grammar, punctuation, accents, " +
      "apostrophes, and typography. Do NOT change meaning. Do NOT rewrite or paraphrase. " +
      "Keep slang/abbreviations as-is. Return ONLY the corrected text.";

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

    res.status(200).json({ text: out, blocked: false });
  } catch (e) {
    res.status(200).json({ text: input, blocked: true, reason: "exception" });
  }
}
