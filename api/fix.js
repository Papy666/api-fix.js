import OpenAI from "openai";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function buildSystemPrompt(mode = "cor", tone = "default") {
  if (mode === "opt") {
    return [
      "You are Greenlight in OPT mode.",
      "Rewrite the text to improve clarity, fluency, professionalism, and impact.",
      "Preserve the original intent and core meaning.",
      "Fix spelling, grammar, punctuation, accents, apostrophes, and typography.",
      "Adapt tone according to the requested tone.",
      "Return ONLY the rewritten text."
    ].join(" ");
  }

  return [
    "You are Greenlight in FIX mode.",
    "Correct the text systematically.",
    "Fix spelling, grammar, punctuation, accents, apostrophes, capitalization, spacing, and typography.",
    "Do not paraphrase unnecessarily, but do not leave obvious mistakes uncorrected.",
    "Keep the same meaning and roughly the same register.",
    "Slang may remain informal, but spelling and punctuation errors must still be corrected.",
    "Return ONLY the corrected text."
  ].join(" ");
}

function buildUserPrompt({ text, lang, mode, tone }) {
  return [
    `Mode: ${mode || "cor"}`,
    `Tone: ${tone || "default"}`,
    `Language: ${lang || "auto"}`,
    "Task: Return only the final corrected or optimized text, with no explanation.",
    "Text:",
    String(text || "")
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const { text, lang, mode, tone } = req.body || {};

  const input = (text ?? "").toString();
  const language = (lang ?? "auto").toString();
  const currentMode = (mode ?? "cor").toString();
  const currentTone = (tone ?? "default").toString();

  if (!input.trim()) {
    res.status(200).json({ text: input, blocked: false });
    return;
  }

  const client = getClient();
  if (!client) {
    res.status(200).json({
      text: input,
      blocked: true,
      reason: "missing_api_key"
    });
    return;
  }

  try {
    const system = buildSystemPrompt(currentMode, currentTone);
    const user = buildUserPrompt({
      text: input,
      lang: language,
      mode: currentMode,
      tone: currentTone
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const out = (completion.choices?.[0]?.message?.content || "").trim();

    if (!out) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "empty_output"
      });
      return;
    }

    res.status(200).json({
      text: out,
      blocked: false
    });
  } catch (e) {
    res.status(200).json({
      text: input,
      blocked: true,
      reason: "exception"
    });
  }
}