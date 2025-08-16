import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, sourceLang, targetLang } = req.body;

  // --- Gemini API check ---
  async function isDoctorPatientConvo(text) {
    const prompt = `Analyze the following text to determine if it is related to health, medicine, or a doctor-patient consultation.

- If the text contains any symptom, illness, treatment, medical term, or general health discussion, mark is_convo: true.
- If not, mark is_convo: false.
- Always correct spelling mistakes but do not change grammar or meaning.

Return JSON with: is_convo, reason, corrected_text.

Text:
"${text}"`;

    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            is_convo: { type: "BOOLEAN" },
            reason: { type: "STRING" },
            corrected_text: { type: "STRING" }
          },
          propertyOrdering: ["is_convo", "reason", "corrected_text"]
        }
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
        const parsedJson = JSON.parse(jsonText);
        return parsedJson.is_convo !== false; // loose fallback
      } else {
        return true; // fallback
      }
    } catch (err) {
      console.error("Gemini error:", err.message);
      return true; // fallback
    }
  }

  // --- Hugging Face translation ---
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

  // --- Main handler ---
  try {
    const isConvo = await isDoctorPatientConvo(text);

    if (!isConvo) {
      return res.status(400).json({
        error: "Text is not a valid doctor-patient conversation."
      });
    }

    const translatedText = await translateText(text, sourceLang, targetLang);
    res.status(200).json({ translatedText });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
