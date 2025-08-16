import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// --- Translation logic ---
async function translateText(text, sourceLang, targetLang) {
  const model = `Helsinki-NLP/opus-mt-${sourceLang}-${targetLang}`;
  const url = `https://api-inference.huggingface.co/models/${model}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.HF_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ inputs: text })
  });

  const result = await response.json();

  if (response.status !== 200) {
    throw new Error(result.error || "Translation failed");
  }

  return result[0]?.translation_text || "";
}

// --- Gemini API check for doctor-patient conversation & spelling ---
async function isDoctorPatientConvo(text) {
  const prompt = `Analyze the following text to determine if it is relevant to a medical or health-related context. 

Additionally, correct any spelling mistakes in the text. Do not change the grammar, sentence structure, or meaning—only fix misspelled words. The corrected text should then be returned for translation.

Your response must be a JSON object with the following properties:
- "is_convo": true if the text is a valid doctor-patient conversation or contains health-related concepts, false otherwise.
- "reason": a short explanation for your determination.
- "corrected_text": the text after fixing spelling mistakes (grammar unchanged).

Example JSON for a valid health-related text:
{
  "is_convo": true,
  "reason": "The text mentions a specific illness or symptom, making it health-related.",
  "corrected_text": "Patient reports mild headache and nausea."
}

Example JSON for an invalid text:
{
  "is_convo": false,
  "reason": "The text has no relevance to healthcare.",
  "corrected_text": "Milk, bread, eggs"
}

Text to analyze:
"${text}"`;

  const apiKey = process.env.GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.candidates && result.candidates.length > 0) {
      const jsonText = result.candidates[0].content.parts[0].text;
      return JSON.parse(jsonText);
    } else {
      return { is_convo: false, reason: "Unexpected Gemini response.", corrected_text: "" };
    }
  } catch (err) {
    return { is_convo: false, reason: "Gemini API error.", corrected_text: "" };
  }
}

// --- Main API handler ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, sourceLang, targetLang } = req.body;

  try {
    const convoCheck = await isDoctorPatientConvo(text);

    if (!convoCheck.is_convo) {
      return res.status(400).json({ error: convoCheck.reason });
    }

    const translatedText = await translateText(
      convoCheck.corrected_text,
      sourceLang,
      targetLang
    );

    return res.status(200).json({ translatedText });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
