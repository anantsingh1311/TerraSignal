import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-2.5-flash";

const safeParseJson = (text) => {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
};

const normalizeList = (value, fallback = []) => (Array.isArray(value) ? value.map(String).filter(Boolean) : fallback);

const normalizeClientReviews = (value = {}) => ({
  builder: normalizeList(value.builder),
  engineer: normalizeList(value.engineer),
  purchaser: normalizeList(value.purchaser),
});

export const hasGeminiAiConfig = () => Boolean(String(process.env.GEMINI_API_KEY || "").trim());

export const getGeminiModelName = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;

export const generateGeminiSiteAnalysis = async ({ activeSite, siteScreening, providerSnapshot }) => {
  if (!hasGeminiAiConfig()) {
    const error = new Error("Gemini site analysis is not configured. Set GEMINI_API_KEY.");
    error.status = 503;
    throw error;
  }

  const model = getGeminiModelName();
  const timeoutMs = Math.max(3000, Number(process.env.GEMINI_TIMEOUT_MS || 12000));
  const client = new GoogleGenAI({ apiKey: String(process.env.GEMINI_API_KEY).trim() });
  const prompt = JSON.stringify({
    system:
      "You are TerraSignal's geotechnical decision-support narrative engine. Return concise JSON only. Do not claim certification, safety, approval, guaranteed buildability, or final foundation design. Use only provided data.",
    task:
      "Generate a professional preliminary site intelligence narrative for construction and land-purchase due diligence. Use careful, legally safe wording.",
    requiredSchema: {
      executiveSummary: "string",
      siteContext: "string",
      landBuyerInterpretation: "string",
      engineeringInterpretation: "string",
      constructionSuitabilityOpinion: "string",
      seismicCaution: "string",
      soilAndFoundationConcerns: "string",
      drainageAndWaterConcerns: "string",
      recommendedInvestigations: ["string"],
      businessRiskNotes: ["string"],
      limitations: ["string"],
      clientReviews: {
        builder: ["string"],
        engineer: ["string"],
        purchaser: ["string"],
      },
    },
    activeSite,
    siteScreening,
    providerSnapshot,
    safetyRules: [
      "Do not say safe to build.",
      "Do not provide final foundation design.",
      "Do not replace boreholes, SPT/CPT, lab testing, structural design, legal due diligence, or qualified engineer review.",
      "Use preliminary decision-support language only.",
      "Produce client reviews only for builder, engineer, and purchaser audiences.",
      "Mention professional verification for topographic, geotechnical/geological, cadastral/boundary, floodplain/hydrological, and utility/access data where relevant.",
    ],
  });

  const response = await Promise.race([
    client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, responseMimeType: "application/json" },
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini site analysis timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

  const content = response?.text || response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!content) throw new Error("Gemini site analysis response did not include content.");
  const parsed = safeParseJson(content);
  if (!parsed) throw new Error("Gemini site analysis response was not valid JSON.");

  return {
    executiveSummary: String(parsed.executiveSummary || ""),
    siteContext: String(parsed.siteContext || ""),
    landBuyerInterpretation: String(parsed.landBuyerInterpretation || ""),
    engineeringInterpretation: String(parsed.engineeringInterpretation || ""),
    constructionSuitabilityOpinion: String(parsed.constructionSuitabilityOpinion || ""),
    seismicCaution: String(parsed.seismicCaution || ""),
    soilAndFoundationConcerns: String(parsed.soilAndFoundationConcerns || ""),
    drainageAndWaterConcerns: String(parsed.drainageAndWaterConcerns || ""),
    recommendedInvestigations: normalizeList(parsed.recommendedInvestigations),
    businessRiskNotes: normalizeList(parsed.businessRiskNotes),
    limitations: normalizeList(parsed.limitations),
    clientReviews: normalizeClientReviews(parsed.clientReviews),
    mode: "gemini",
    model,
  };
};
