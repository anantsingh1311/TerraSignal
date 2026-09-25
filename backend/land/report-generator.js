import { disclaimer, mockDataNotice } from "./scoring-engine.js";
import { generateGeminiAnalysis, validateGeminiAnalysis } from "./gemini-analysis-service.js";

const list = (items) => (items?.length ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "None generated.");

const scoreLines = (scan) =>
  Object.values(scan.subScores)
    .map((item) =>
      [
        `${item.scoreId}: ${item.available ? `${item.score}/100` : "unavailable"}, weight ${item.weight}, contribution ${item.weightedContribution}, confidence ${Math.round(item.confidence * 100)}%.`,
        `Formula: ${item.formula}`,
        `Raw inputs: ${JSON.stringify(item.rawInputs)}`,
        `Source: ${item.providerSources.join(" + ") || "unavailable"}`,
        `Limitations: ${item.limitations.join(" ")}`,
        `Professional verification: ${item.recommendedVerification.join("; ")}`,
      ].join(" "),
    )
    .join("\n");

const providerLines = (scan) =>
  (scan.sourceTable || scan.dataSources || [])
    .map(
      (source) =>
        `${source.providerName}: ${source.sourceType}/${source.dataMode}, confidence ${Math.round(
          Number(source.confidence || 0) * 100,
        )}%, coverage ${source.regionCoverage || source.coverage}. Citation: ${source.citation || source.citationUrl || "not configured"}. Limitations: ${source.limitations}`,
    )
    .join("\n");

const readinessBody = (scan, analysis) =>
  [
    `Readiness gate: ${scan.reportReadiness}.`,
    `Client-ready deliverable eligible: ${scan.clientReadyDeliverable ? "yes" : "no"}.`,
    `Minimum live data package: ${scan.minimumLiveDataPackage?.satisfied ? "satisfied" : "not satisfied"}.`,
    scan.minimumLiveDataPackage?.missing?.length ? `Missing: ${scan.minimumLiveDataPackage.missing.join(", ")}.` : "",
    `Gemini status: ${analysis.aiStatus}.`,
    scan.externalUseBlockedReason,
  ]
    .filter(Boolean)
    .join(" ");

export const generateProfessionalReport = async (scan) => {
  const geminiAnalysis = await generateGeminiAnalysis(scan);
  const validation = validateGeminiAnalysis(geminiAnalysis);
  if (!validation.valid) {
    const error = new Error(`Gemini analysis is incomplete: ${validation.errors.join(" ")}`);
    error.status = 502;
    throw error;
  }
  const mockNotice =
    scan.dataMode === "mock"
      ? `${mockDataNotice} This report is internal testing only and is not a client-ready deliverable. `
      : "";
  const executiveSummary = `${mockNotice}${geminiAnalysis.executiveSummary}`;

  const sections = [
    {
      title: "Executive Summary",
      body: executiveSummary,
    },
    {
      title: "Site Overview",
      body: geminiAnalysis.siteOverview,
    },
    {
      title: "Report Readiness",
      body: readinessBody(scan, geminiAnalysis),
    },
    {
      title: "Preliminary Suitability Indicator",
      body: geminiAnalysis.intendedUseAssessment,
    },
    {
      title: "Risk Score Explanation",
      body: geminiAnalysis.scoreReasoning.overallRisk,
    },
    {
      title: "Score Explainability Table",
      body: scoreLines(scan),
    },
    {
      title: "Provider and Source Table",
      body: providerLines(scan),
    },
    {
      title: "Gemini Analysis",
      body: [
        `Data quality: ${geminiAnalysis.dataQualityAssessment}`,
        `Risk interpretation: ${geminiAnalysis.riskInterpretation}`,
        `Overall risk reasoning: ${geminiAnalysis.scoreReasoning.overallRisk}`,
        `Confidence reasoning: ${geminiAnalysis.scoreReasoning.overallConfidence}`,
        `Missing-data impact: ${geminiAnalysis.scoreReasoning.missingDataImpact}`,
        `Client-friendly summary: ${geminiAnalysis.clientFriendlySummary}`,
      ].join("\n"),
    },
    {
      title: "Gemini Sub-score Analysis",
      body: geminiAnalysis.subScoreAnalysis
        .map(
          (item) =>
            `${item.scoreId}: ${item.plainEnglishExplanation} Technical: ${item.technicalExplanation} Confidence: ${item.confidenceCommentary} Verification: ${item.recommendedVerification.join("; ")}`,
        )
        .join("\n"),
    },
    {
      title: "Missing Data and Cannot Conclude",
      body: list([...(scan.unavailableScores || []).map((score) => `${score} unavailable`), ...geminiAnalysis.cannotConclude]),
    },
    {
      title: "Red Flags",
      body: list(geminiAnalysis.redFlagsExplained),
    },
    {
      title: "Positive Indicators",
      body: list(geminiAnalysis.positiveIndicatorsExplained),
    },
    {
      title: "Confidence Level",
      body: geminiAnalysis.scoreReasoning.overallConfidence,
    },
    {
      title: "Recommended Next Steps",
      body: list(geminiAnalysis.recommendedNextSteps),
    },
    {
      title: "What Certified Professionals Should Verify",
      body: list(geminiAnalysis.professionalVerificationChecklist),
    },
    {
      title: "Limitations",
      body:
        list([...geminiAnalysis.limitations, ...(scan.limitationsTable || []).map((item) => `${item.providerName}: ${item.limitations}`)]) +
        "\nThis report does not certify soil class, bearing capacity, flood depth, contamination, legal title, planning status, structural design, or investment outcome.",
    },
    {
      title: "Legal and Technical Disclaimer",
      body: disclaimer,
    },
  ];

  return {
    mode: "gemini",
    generatedAt: new Date().toISOString(),
    executiveSummary,
    aiAnalysis: geminiAnalysis,
    sections,
    narrative: sections.map((section) => `${section.title}\n${section.body}`).join("\n\n"),
  };
};
