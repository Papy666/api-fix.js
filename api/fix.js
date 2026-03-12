import OpenAI from "openai";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/* ---------------------------------- */
/*  Utilities */
/* ---------------------------------- */

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

function tooDifferent(a = "", b = "") {
  const la = a.length;
  const lb = b.length;

  if (!la || !lb) return false;

  const diff = Math.abs(lb - la) / la;

  return diff > 0.35;
}

/* ---------------------------------- */
/*  Token protection */
/* ---------------------------------- */

function protectTokens(text = "") {

  const map = {};
  let i = 0;

  const protectedText = text.replace(
    /\b([A-Z]{2,}|\d+[a-zA-Z]*|[A-Za-z]*\d+[A-Za-z0-9-]*)\b/g,
    (match) => {
      const key = `__GLTOK${i++}__`;
      map[key] = match;
      return key;
    }
  );

  return { protectedText, map };
}

function restoreTokens(text = "", map = {}) {

  let out = text;

  for (const key in map) {
    out = out.replaceAll(key, map[key]);
  }

  return out;
}

/* ---------------------------------- */
/*  Prompt builders */
/* ---------------------------------- */

function buildSystemPrompt(mode = "cor", tone = "default") {

  if (mode === "opt") {
    return [
      "You are Greenlight in OPT mode.",
      "Rewrite the text to improve clarity, fluency, professionalism, and impact.",
      "Preserve the original meaning and intent.",
      "Fix spelling, grammar, punctuation, accents, and typography.",
      "",
      "Rules:",
      "- Do not introduce new information.",
      "- Do not modify numbers, product names, or technical identifiers.",
      "- Maintain the same factual meaning.",
      "",
      "Return ONLY the rewritten text."
    ].join(" ");
  }

  return [
    "You are Greenlight in COR mode.",
    "You are a strict text correction engine.",
    "",
    "Your task is to correct:",
    "- spelling",
    "- grammar",
    "- punctuation",
    "- accents",
    "- apostrophes",
    "- capitalization",
    "- spacing and typography",
    "",
    "Rules:",
    "- Preserve the meaning.",
    "- Do not paraphrase unnecessarily.",
    "- Do not replace words with synonyms unless required for grammar.",
    "- Do not interpret unclear tokens.",
    "",
    "Important:",
    "- Never modify numbers.",
    "- Never modify model names or product identifiers.",
    "- Never modify technical tokens (API, USB-C, RTX4090, etc).",
    "",
    "If something is unclear, leave it unchanged.",
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
    "Return only the corrected or optimized text.",
    "Do not include explanations.",
    "",
    "Text:",
    String(text || "")
  ].join("\n");
}

/* ---------------------------------- */
/*  Handler */
/* ---------------------------------- */

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
    res.status(200).json({
      text: input,
      blocked: false
    });
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

    /* ------------------------------- */
    /* Protect sensitive tokens */
    /* ------------------------------- */

    const { protectedText, map } = protectTokens(input);

    const system = buildSystemPrompt(currentMode, currentTone);

    const user = buildUserPrompt({
      text: protectedText,
      lang: language,
      mode: currentMode,
      tone: currentTone
    });

    /* ------------------------------- */
    /* Call LLM */
    /* ------------------------------- */

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      top_p: 0.9,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    let out = (completion.choices?.[0]?.message?.content || "").trim();

    if (!out) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "empty_output"
      });
      return;
    }

    /* ------------------------------- */
    /* Restore tokens */
    /* ------------------------------- */

    out = restoreTokens(out, map);

    /* ------------------------------- */
    /* Safety checks */
    /* ------------------------------- */

    if (numbersChanged(input, out)) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "numbers_modified"
      });
      return;
    }

    if (tooDifferent(input, out)) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "excessive_change"
      });
      return;
    }

    /* ------------------------------- */
    /* Debug log (optional) */
    /* ------------------------------- */

    console.log("GL FIX", {
      input,
      output: out
    });

    res.status(200).json({
      text: out,
      blocked: false
    });

  } catch (e) {

    console.error("GL FIX ERROR", e);

    res.status(200).json({
      text: input,
      blocked: true,
      reason: "exception"
    });

  }
}