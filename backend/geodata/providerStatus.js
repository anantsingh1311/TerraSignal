const modelledLayer = () => "cached";

export const getProviderStatus = () => ({
  elevation: modelledLayer(),
  soil: modelledLayer(),
  seismic: modelledLayer(),
  water: modelledLayer(),
  landCover: modelledLayer(),
  rainfall: modelledLayer(),
  groundwater: modelledLayer(),
  legalPlanning: modelledLayer(),
  infrastructure: modelledLayer(),
  news: "unavailable",
  ai: process.env.GEMINI_API_KEY ? "live" : "fallback",
});
