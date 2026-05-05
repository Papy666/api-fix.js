/* ---------------------------------- */
/*  Gemini REST config */
/* ---------------------------------- */

function getApiKey() {
  return process.env.GEMINI_API_KEY || null;
}

const GEMINI_MODEL_COR =
  process.env.GEMINI_MODEL_COR || "gemini-2.5-flash-lite";

const GEMINI_MODEL_OPT =
  process.env.GEMINI_MODEL_OPT || "gemini-3-flash-preview";

/* ---------------------------------- */
/*  Constants */
/* ---------------------------------- */

const ALLOWED_MODES = new Set(["cor", "opt"]);
const ALLOWED_TONES = new Set(["neutral", "professional", "persuasive", "concise"]);

/* ---------------------------------- */
/*  Utilities */
/* ---------------------------------- */

function sanitizeMode(mode) {
  const value = String(mode || "").toLowerCase().trim();
  return ALLOWED_MODES.has(value) ? value : "cor";
}

function sanitizeTone(tone) {
  const value = String(tone || "").toLowerCase().trim();
  return ALLOWED_TONES.has(value) ? value : "neutral";
}

function getModelForMode(mode) {
  return mode === "opt" ? GEMINI_MODEL_OPT : GEMINI_MODEL_COR;
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
  const la = a.length;
  const lb = b.length;

  if (!la || !lb) return false;

  return Math.abs(lb - la) / la > 0.35;
}

function optLooksSuspicious(a = "", b = "") {
  const input = String(a || "").trim();
  const output = String(b || "").trim();

  if (!input || !output) return true;

  const la = input.length;
  const lb = output.length;

  if (lb < Math.max(10, la * 0.30)) return true;
  if (lb > la * 2.0 + 100) return true;

  return false;
}

/* ---------------------------------- */
/*  Token protection */
/* ---------------------------------- */

function protectTokens(text = "") {
  const map = {};
  let i = 0;

  const protectedText = String(text).replace(
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
        "Tone: professional.",
        "Make the text clearer, cleaner, more structured, and professionally usable.",
        "Use serious and credible wording.",
        "Do not make it pompous, theatrical, legalistic, or excessively corporate."
      ].join(" ");

    case "persuasive":
      return [
        "Tone: persuasive.",
        "Make the text more convincing and action-oriented.",
        "Clarify the request and strengthen the call to action.",
        "Only highlight benefits, urgency, or importance if already implied by the original text.",
        "Do not invent facts. Do not manipulate dishonestly."
      ].join(" ");

    case "concise":
      return [
        "Tone: concise.",
        "Make the text shorter, sharper, and more direct.",
        "Remove filler, repetition, hesitation, and unnecessary softness.",
        "Preserve politeness when useful."
      ].join(" ");

    case "neutral":
    default:
      return [
        "Tone: neutral.",
        "Make the text natural, clear, fluid, and easy to read.",
        "Do not make it much more formal.",
        "Do not over-polish it."
      ].join(" ");
  }
}

function buildSystemPrompt(mode = "cor", tone = "neutral") {
  if (mode === "opt") {
    return [
      "You are Flexo in OPT mode.",
      "You rewrite user text for clarity and style.",
      "",
      "Absolute rules:",
      "- Preserve the original meaning.",
      "- Preserve the original intent.",
      "- Preserve the original tone direction unless the selected tone explicitly changes it.",
      "- Preserve all facts.",
      "- Preserve all numbers.",
      "- Preserve all names, products, models, brands, technical terms, IDs, URLs, emails, commands, and code-like tokens.",
      "- Do not add information.",
      "- Do not remove important information.",
      "- Do not moralize.",
      "- Do not explain.",
      "- Do not answer the message.",
      "- Do not continue the conversation.",
      "- Return only the rewritten text.",
      "",
      "Length rule:",
      "- Output must normally be close to the input length.",
      "- Concise mode may be shorter.",
      "- Do not return a summary unless the input itself asks for one.",
      "- Never truncate.",
      "- Always return the full rewritten text.",
      "",
      buildOptToneInstructions(tone)
    ].join("\n");
  }

  return [
    "You are Flexo in COR mode.",
    "You are a strict correction engine.",
    "",
    "Task:",
    "Correct only spelling, grammar, punctuation, accents, apostrophes, capitalization, spacing, and typography.",
    "",
    "Absolute rules:",
    "- Preserve the exact meaning.",
    "- Do not rewrite for style.",
    "- Do not improve the text beyond correction.",
    "- Do not paraphrase unless grammatically necessary.",
    "- Do not replace words with synonyms unless required for grammar.",
    "- Do not add information.",
    "- Do not remove information.",
    "- Do not interpret unclear text.",
    "- If something is unclear, leave it unchanged.",
    "- Preserve all numbers.",
    "- Preserve all names, products, models, brands, technical terms, IDs, URLs, emails, commands, and code-like tokens.",
    "- Return only the corrected text.",
    "- Never explain."
  ].join("\n");
}

function buildUserPrompt({ text, lang, mode, tone }) {
  return [
    `Mode: ${mode}`,
    `Tone: ${tone}`,
    `Language: ${lang || "auto"}`,
    "",
    mode === "opt"
      ? "Rewrite the following text according to the selected tone. Preserve meaning, facts, and intent."
      : "Correct the following text strictly. Do not change meaning or style.",
    "",
    "Return only the final text.",
    "",
    "Text:",
    String(text || "")
  ].join("\n");
}

/* ---------------------------------- */
/*  Gemini REST call */
/* ---------------------------------- */

async function callGemini({ system, user, mode }) {
  const key = getApiKey();

  if (!key) {
    return { error: "missing_api_key" };
  }

  const model = getModelForMode(mode);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const generationConfig = {
    temperature: mode === "cor" ? 0 : 0.15,
    topP: mode === "cor" ? 0.1 : 0.7,
    maxOutputTokens: 768
  };

  if (model.startsWith("gemini-3")) {
    generationConfig.thinkingConfig = {
      thinkingLevel: "minimal"
    };
  } else if (model.startsWith("gemini-2.5-flash")) {
    generationConfig.thinkingConfig = {
      thinkingBudget: 0
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: user }]
        }
      ],
      generationConfig
    })
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error("GEMINI API ERROR", {
      status: response.status,
      statusText: response.statusText,
      model,
      data
    });

    return {
      error: data?.error?.message || `gemini_http_${response.status}`
    };
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      ?.map((part) => part.text || "")
      ?.join("")
      ?.trim() || "";

  return { text, model };
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
  const currentMode = sanitizeMode(mode);
  const currentTone = sanitizeTone(tone);

  if (!input.trim()) {
    res.status(200).json({
      text: input,
      blocked: false
    });
    return;
  }

  if (!getApiKey()) {
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

    const response = await callGemini({
      system,
      user,
      mode: currentMode
    });

    console.log("GL GEMINI RAW RESPONSE", response);

    if (response.error) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: response.error
      });
      return;
    }

    let out = String(response.text || "").trim();

    if (!out) {
      res.status(200).json({
        text: input,
        blocked: true,
        reason: "empty_output"
      });
      return;
    }

    out = restoreTokens(out, map).trim();

    console.log("GL COMPARE", {
      model: response.model,
      mode: currentMode,
      tone: currentTone,
      inputLength: input.length,
      outputLength: out.length,
      same: input.trim() === out.trim()
    });

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

    console.log("GL FIX", {
      provider: "gemini_rest",
      model: response.model,
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
    console.error("GL FIX ERROR MESSAGE", e?.message);
    console.error("GL FIX ERROR NAME", e?.name);
    console.error("GL FIX ERROR STACK", e?.stack);

    res.status(200).json({
      text: input,
      blocked: true,
      reason: "exception",
      detail: e?.message || "unknown_error"
    });
  }
}