gpt-4o-miniimport OpenAI from "openai";

/* ---------------------------------- */
/*  OpenAI config */
/* ---------------------------------- */

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  return new OpenAI({
    apiKey: key,
    timeout: 12000
  });
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ---------------------------------- */
/*  Constants */
/* ---------------------------------- */

const ALLOWED_TONES = new Set([
  "neutral",
  "professional",
  "persuasive",
  "concise"
]);

/* ---------------------------------- */
/*  Utilities */
/* ---------------------------------- */

function sanitizeMode(mode) {
  const value = String(mode || "").toLowerCase().trim();

  if (["opt", "optimise", "optimize", "optimization", "ameliorer", "améliorer"].includes(value)) {
    return "opt";
  }

  if (["cor", "correct", "correction", "fix"].includes(value)) {
    return "cor";
  }

  return "cor";
}

function sanitizeTone(tone) {
  const value = String(tone || "").toLowerCase().trim();
  return ALLOWED_TONES.has(value) ? value : "neutral";
}

function resolveMode({ mode, tone }) {
  const rawMode = sanitizeMode(mode);
  const currentTone = sanitizeTone(tone);

  // Compat extension actuelle :
  // si elle envoie mode=cor mais tone=concise/professional/persuasive,
  // on considère que c'est une optimisation.
  if (rawMode === "cor" && currentTone !== "neutral") {
    return "opt";
  }

  return rawMode;
}

function extractNumbers(text = "") {
  return (String(text).match(/\b\d+[a-zA-Z]*\b/g) || []).sort();
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
  const input = String(a || "").trim();
  const output = String(b || "").trim();

  if (!input || !output) return false;

  const diff = Math.abs(output.length - input.length) / input.length;
  return diff > 0.45;
}

function optLooksSuspicious(a = "", b = "") {
  const input = String(a || "").trim();
  const output = String(b || "").trim();

  if (!input || !output) return true;

  const la = input.length;
  const lb = output.length;

  if (lb < Math.max(10, la * 0.25)) return true;
  if (lb > la * 2.3 + 100) return true;

  return false;
}

function cleanModelOutput(text = "") {
  return String(text || "")
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

/* ---------------------------------- */
/*  Token protection */
/* ---------------------------------- */

function protectTokens(text = "") {
  const map = {};
  let i = 0;

  const protectedText = String(text).replace(
    /\b([A-Z]{2,}|\d+[a-zA-Z]*|[A-Za-z]*\d+[A-Za-z0-9-]*|https?:\/\/\S+|\S+@\S+\.\S+)\b/g,
    (match) => {
      const key = `__GLTOK${i++}__`;
      map[key] = match;
      return key;
    }
  );

  return { protectedText, map };
}

function restoreTokens(text = "", map = {}) {
  let out = String(text || "");

  for (const key in map) {
    out = out.replaceAll(key, map[key]);
  }

  return out;
}

/* ---------------------------------- */
/*  Prompt builders */
/* ---------------------------------- */

function buildOptToneInstructions(tone = "neutral") {
  switch (tone) {
    case "professional":
      return [
        "Tone instruction:",
        "Make the text more professional, clear, and credible.",
        "Stay natural. Do not make it pompous, legalistic, or overly corporate.",
        "Do not remove the user's intent or emotional nuance."
      ].join(" ");

    case "persuasive":
      return [
        "Tone instruction:",
        "Make the text slightly more convincing and action-oriented.",
        "Clarify the request or desired outcome if already present.",
        "Do not invent arguments, facts, urgency, promises, or benefits.",
        "Do not manipulate dishonestly."
      ].join(" ");

    case "concise":
      return [
        "Tone instruction:",
        "Make the text a bit shorter and clearer only when safe.",
        "Remove useless filler and repetition.",
        "Do not summarize aggressively.",
        "Do not remove emotion, slang, anger, humor, intent, or important nuance.",
        "Preserve the user's style as much as possible."
      ].join(" ");

    case "neutral":
    default:
      return [
        "Tone instruction:",
        "Make the text natural, fluid, and clear.",
        "Do not make it notably more formal.",
        "Do not over-polish it."
      ].join(" ");
  }
}

function buildSystemPrompt(mode = "cor", tone = "neutral") {
  if (mode === "opt") {
    return [
      "You are Flexo in OPT mode.",
      "You correct and lightly improve user text.",
      "",
      "Priority order:",
      "1. Correct spelling, grammar, punctuation, accents, apostrophes, spacing, and typography.",
      "2. Preserve the original meaning exactly.",
      "3. Preserve the original intent exactly.",
      "4. Preserve facts, numbers, names, product names, model names, technical identifiers, URLs, emails, and code-like tokens.",
      "5. Improve clarity only when it does not change the meaning.",
      "6. Apply the selected tone conservatively.",
      "",
      "Absolute rules:",
      "- Do not guess creatively.",
      "- Do not reinterpret broken text.",
      "- Do not invent missing ideas.",
      "- Do not add new information.",
      "- Do not remove important information.",
      "- Do not answer the message.",
      "- Do not continue the conversation.",
      "- Do not moralize.",
      "- Do not explain.",
      "- Keep the user's roughness, intensity, slang, anger, humor, or informality when present.",
      "- If a word is unclear, correct only obvious typos.",
      "- If uncertain, leave the word close to the original.",
      "",
      buildOptToneInstructions(tone),
      "",
      "Return ONLY the final corrected and lightly improved text."
    ].join("\n");
  }

  return [
    "You are Flexo in COR mode.",
    "You are a strict text correction engine.",
    "",
    "Task:",
    "Correct only spelling, grammar, punctuation, accents, apostrophes, capitalization, spacing, and typography.",
    "",
    "Absolute rules:",
    "- Preserve the exact meaning.",
    "- Preserve the user's style.",
    "- Preserve roughness, slang, anger, humor, and informality.",
    "- Do not rewrite for style.",
    "- Do not optimize.",
    "- Do not paraphrase unless grammatically necessary.",
    "- Do not replace words with synonyms unless required for grammar.",
    "- Do not add information.",
    "- Do not remove information.",
    "- Do not interpret unclear text.",
    "- If something is unclear, leave it unchanged or close to original.",
    "- Preserve all numbers.",
    "- Preserve all names, products, models, brands, technical terms, IDs, URLs, emails, commands, and code-like tokens.",
    "",
    "Return ONLY the corrected text.",
    "Never explain."
  ].join("\n");
}

function buildUserPrompt({ text, lang, mode, tone }) {
  return [
    `Mode: ${mode}`,
    `Tone: ${tone}`,
    `Language: ${lang || "auto"}`,
    "",
    mode === "opt"
      ? "Task: correct and lightly improve the text according to the selected tone. Preserve meaning, intent, and facts."
      : "Task: correct the text strictly. Do not change meaning, style, or intent.",
    "",
    "Return only the final text.",
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
  const language = (lang ?? "auto").toString().trim() || "auto";
  const currentTone = sanitizeTone(tone);
  const currentMode = resolveMode({ mode, tone });

  console.log("OPENAI REQ", {
    receivedMode: mode,
    receivedTone: tone,
    resolvedMode: currentMode,
    resolvedTone: currentTone,
    textLength: input.length
  });

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
    const { protectedText, map } = protectTokens(input);

    const system = buildSystemPrompt(currentMode, currentTone);
    const user = buildUserPrompt({
      text: protectedText,
      lang: language,
      mode: currentMode,
      tone: currentTone
    });

    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      top_p: 0.7,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    let out = cleanModelOutput(completion.choices?.[0]?.message?.content || "");

    if (!out) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "empty_output"
      });
      return;
    }

    out = restoreTokens(out, map).trim();

    if (numbersChanged(input, out)) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "numbers_modified"
      });
      return;
    }

    if (currentMode === "cor" && tooDifferent(input, out)) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "excessive_change"
      });
      return;
    }

    if (currentMode === "opt" && optLooksSuspicious(input, out)) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "suspicious_opt_output"
      });
      return;
    }

    console.log("OPENAI FIX", {
      model: OPENAI_MODEL,
      mode: currentMode,
      tone: currentTone,
      inputLength: input.length,
      outputLength: out.length
    });

    res.status(200).json({
      text: out,
      blocked: false
    });
  } catch (e) {
    console.error("OPENAI FIX ERROR", {
      name: e?.name,
      message: e?.message,
      status: e?.status
    });

    res.status(200).json({
      text: input,
      blocked: true,
      reason: "exception",
      detail: e?.message || "unknown_error"
    });
  }
}