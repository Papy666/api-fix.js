import OpenAI from "openai";

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

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

  const diff = Math.abs(lb - la) / la;
  return diff > 0.35;
}

function optLooksSuspicious(a = "", b = "") {
  const input = String(a || "").trim();
  const output = String(b || "").trim();

  if (!input || !output) return true;

  const la = input.length;
  const lb = output.length;

  if (lb < Math.max(12, la * 0.35)) return true;
  if (lb > la * 2.2 + 80) return true;

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
        "Tone style: professional.",
        "Rewrite in a polished, structured, professional, and credible tone.",
        "Use clear, well-formed sentences and appropriate business wording.",
        "Prefer respectful and formal phrasing when relevant.",
        "If useful, organize the text into short paragraphs for readability.",
        "Make the message sound serious, composed, and ready to send in a professional context.",
        "Do not sound robotic, overly legalistic, or theatrical."
      ].join(" ");

    case "persuasive":
      return [
        "Tone style: persuasive.",
        "Rewrite to maximize the chance of getting a positive response or action.",
        "Make the message more compelling, purposeful, and action-oriented.",
        "Strengthen the request, clarify the desired outcome, and make the call to action more explicit.",
        "Use psychologically effective but natural phrasing: confident, engaging, and concrete.",
        "Highlight relevance, benefit, importance, or urgency only if already supported by the original message.",
        "Make the recipient more likely to respond, agree, or act.",
        "Do not invent facts, do not threaten, do not guilt-trip, and do not manipulate dishonestly."
      ].join(" ");

    case "concise":
      return [
        "Tone style: concise.",
        "Rewrite to make the message shorter, sharper, and more direct.",
        "Remove filler, repetition, hesitation, and soft phrasing.",
        "Keep only what is useful, clear, and necessary.",
        "Preserve basic politeness but avoid verbosity."
      ].join(" ");

    case "neutral":
    default:
      return [
        "Tone style: neutral.",
        "Rewrite in a natural, fluid, clear, and human way.",
        "Improve readability and correctness without making the text notably more formal.",
        "Keep the tone simple, balanced, and everyday-professional.",
        "Do not over-structure the message unless clearly needed.",
        "Avoid making it sound too polished, too corporate, or too ceremonial."
      ].join(" ");
  }
}

function buildSystemPrompt(mode = "cor", tone = "neutral") {
  if (mode === "opt") {
    return [
      "You are Greenlight in OPT mode.",
      "Your task is to rewrite the text so it is better written while preserving the original meaning, intent, and factual content.",
      "Fix spelling, grammar, punctuation, accents, typography, and phrasing when needed.",
      "",
      "Core rules:",
      "- Do not introduce new information.",
      "- Do not change facts.",
      "- Do not modify numbers, product names, model names, or technical identifiers.",
      "- Preserve the original intent.",
      "- Keep the output directly usable by the user.",
      "- Prefer strong wording differences only when they match the selected tone.",
      "",
      buildOptToneInstructions(tone),
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
    `Mode: ${mode}`,
    `Tone: ${tone}`,
    `Language: ${lang || "auto"}`,
    "",
    mode === "opt"
      ? "Task: rewrite the text according to the selected tone, while preserving meaning and facts."
      : "Task: correct the text strictly without changing meaning.",
    "Return only the final text.",
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

    console.log("GL FIX", {
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
    console.error("GL FIX ERROR", e);

    res.status(200).json({
      text: input,
      blocked: true,
      reason: "exception"
    });
  }
}