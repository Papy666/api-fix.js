import OpenAI from "openai";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function extractNumbers(text = "") {
  return (text.match(/\b\d+[a-zA-Z]*\b/g) || []).sort();
}

function numbersChanged(a, b) {
  const na = extractNumbers(a);
  const nb = extractNumbers(b);
  if (na.length !== nb.length) return true;
  for (let i = 0; i < na.length; i++) {
    if (na[i] !== nb[i]) return true;
  }
  return false;
}

function buildSystemPrompt(mode = "cor", tone = "default") {

  if (mode === "opt") {
    return [
      "You are Greenlight in OPT mode.",
      "Rewrite the text to improve clarity, fluency, professionalism, and impact.",
      "Preserve the original intent and core meaning.",
      "Fix spelling, grammar, punctuation, accents, apostrophes, and typography.",
      "Adapt tone according to the requested tone.",
      "",
      "Rules:",
      "- Do not introduce new information.",
      "- Do not change factual elements such as numbers, codes, model names, or product names.",
      "- Keep the same meaning.",
      "",
      "Return ONLY the rewritten text."
    ].join(" ");
  }

  return [
    "You are Greenlight in COR mode.",
    "You are a STRICT text correction engine.",
    "",
    "Your task is ONLY to correct:",
    "- spelling",
    "- grammar",
    "- punctuation",
    "- accents",
    "- apostrophes",
    "- capitalization",
    "- spacing and typography",
    "",
    "ABSOLUTE RULES:",
    "",
    "1. NEVER change the meaning.",
    "2. NEVER paraphrase or rewrite the sentence.",
    "3. NEVER replace words with synonyms.",
    "4. NEVER interpret unclear tokens.",
    "",
    "IMPORTANT:",
    "",
    "Do NOT modify:",
    "- numbers (530, 2024, 3.5)",
    "- model names (BMW 530, RTX4090)",
    "- technical tokens (USB-C, API, SQL)",
    "- product names",
    "- unknown identifiers",
    "",
    "If something is unclear, leave it unchanged.",
    "",
    "You must preserve:",
    "- the same structure",
    "- the same words whenever possible",
    "- the same sentence order",
    "",
    "Only fix objective mistakes.",
    "",
    "Return ONLY the corrected text."
  ].join(" ");
}

function buildUserPrompt({ text, lang, mode, tone }) {
  return [
    `Mode: ${mode || "cor"}`,
    `Tone: ${tone || "default"}`,
    `Language: ${lang || "auto"}`,
    "",
    "Task:",
    "Return only the final corrected or optimized text.",
    "Do not add explanations.",
    "",
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
      top_p: 0.9,
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

    // garde-fou critique : nombres modifiés
    if (numbersChanged(input, out)) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "numbers_modified"
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