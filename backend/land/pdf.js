import { mockDataNotice } from "./scoring-engine.js";

export const pdfExportEligibility = (scan) => {
  if (scan.dataMode === "mock" || scan.reportReadiness === "internalDemo") {
    return {
      allowed: false,
      label: "Internal demo only",
      reason: "Pure mock reports cannot be exported as client reports.",
    };
  }
  if (scan.dataMode === "unavailable" || scan.reportReadiness === "unavailable") {
    return {
      allowed: false,
      label: "Unavailable-data screening record",
      reason: "Not enough live provider data was available to score this site responsibly.",
    };
  }
  if (scan.reportReadiness === "clientPreview" || scan.dataMode === "mixed") {
    return {
      allowed: true,
      label: "Partial Live-Data Preliminary Screening Preview",
      reason: "Preview reports must keep provider limitations visible and are not client-deliverable eligible.",
    };
  }
  return {
    allowed: true,
    label: "Preliminary Site Intelligence Report",
    reason: "Live provider report remains preliminary and requires certified professional verification.",
  };
};

const printableAscii = (value) =>
  Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    })
    .join("");

const escapePdfText = (value) =>
  printableAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const wrapLine = (line, width = 92) => {
  const words = String(line || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current ? `${current} ${word}` : word).length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

const flattenReportLines = (scan, report) => {
  const eligibility = pdfExportEligibility(scan);
  const ai = report.aiAnalysis || {};
  const lines = [
    "TerraSignal",
    eligibility.label,
    scan.reportReadiness === "clientDeliverableEligible"
      ? "Preliminary Site Intelligence Report"
      : scan.reportReadiness === "clientPreview"
        ? "Partial Live-Data Preliminary Screening Preview"
        : "Internal/Unavailable Screening Record",
    "",
    scan.dataMode === "mock" ? "DEMO / MOCK DATA - INTERNAL TESTING ONLY" : "",
    scan.dataMode === "mock" ? mockDataNotice : "",
    scan.dataMode === "mock" ? "This PDF must not be presented as a client-ready deliverable." : "",
    scan.dataMode === "mixed" ? "PARTIAL LIVE-DATA SCREENING REPORT - provider limitations remain material." : "",
    "",
    `Report date: ${new Date(scan.createdAt || Date.now()).toLocaleString("en-US")}`,
    `Coordinates: ${scan.location.lat.toFixed(6)}, ${scan.location.lng.toFixed(6)}`,
    `Radius: ${scan.location.radiusMeters} m`,
    `Intended use: ${scan.intendedUse}`,
    `Data mode: ${scan.dataMode}`,
    `Readiness gate: ${scan.reportReadiness}`,
    `Report label: ${scan.reportLabel}`,
    `Export label: ${eligibility.label}`,
    `Export rule: ${eligibility.reason}`,
    `Risk score: ${scan.overallRiskScore}/100 (${scan.riskBands.label})`,
    `Preliminary suitability indicator: ${scan.overallSuitabilityScore}/100`,
    `Confidence: ${Math.round(scan.confidence * 100)}%`,
    `Client-ready deliverable: ${scan.clientReadyDeliverable ? "yes" : "no"}`,
    `Gemini status: ${ai.aiStatus || "not_configured"}`,
    "",
    "Map/globe snapshot",
    "A browser-side Cesium globe/map snapshot was not attached to this backend PDF request. Coordinates, radius, boundary, and provider/source layers are listed below for traceability.",
    "",
    "Report readiness",
    `Minimum live data package satisfied: ${scan.minimumLiveDataPackage?.satisfied ? "yes" : "no"}`,
    `Missing package items: ${scan.minimumLiveDataPackage?.missing?.join(", ") || "none"}`,
    `Blocked reason: ${scan.externalUseBlockedReason || "none"}`,
    "",
  ];

  for (const section of report.sections) {
    lines.push(section.title, ...String(section.body).split("\n"), "");
  }

  lines.push("Gemini analysis");
  lines.push(`Executive summary: ${ai.executiveSummary || report.executiveSummary || "Unavailable"}`);
  lines.push(`Data quality assessment: ${ai.dataQualityAssessment || "Unavailable"}`);
  lines.push(`Risk interpretation: ${ai.riskInterpretation || "Unavailable"}`);
  lines.push(`Overall risk reasoning: ${ai.scoreReasoning?.overallRisk || "Unavailable"}`);
  lines.push(`Missing data impact: ${ai.scoreReasoning?.missingDataImpact || "Unavailable"}`);
  lines.push(`Intended-use assessment: ${ai.intendedUseAssessment || "Unavailable"}`);
  lines.push("Professional verification checklist");
  for (const item of ai.professionalVerificationChecklist || []) lines.push(`- ${item}`);
  lines.push("");

  lines.push("Provider/source table");
  for (const source of scan.dataSources || []) {
    lines.push(
      `${source.id}: ${source.providerName || source.adapter} | ${source.sourceType || "computed"} | ${source.dataMode || source.status} | confidence ${Math.round((source.confidence || 0) * 100)}%`,
      `Coverage: ${source.regionCoverage || source.coverage || "unknown"}`,
      `Citation: ${source.citation || source.citationUrl || "not configured"}`,
      `Attribution: ${source.attribution || "not configured"}`,
      `Limitations: ${source.limitations}`,
      "",
    );
  }

  lines.push("Score explainability table");
  for (const score of Object.values(scan.subScores)) {
    lines.push(
      `${score.scoreId || score.id}: ${score.available ? `score ${score.score}/100` : "unavailable"}, weight ${score.weight}, contribution ${score.weightedContribution}, confidence ${Math.round(score.confidence * 100)}%.`,
      `Inputs: ${JSON.stringify(score.rawInputs || score.inputs)}`,
      `Formula: ${score.formula || score.calculation}`,
      `Thresholds: ${JSON.stringify(score.thresholds || {})}`,
      `Source: ${(score.providerSources || [score.dataSource]).join(" + ")}`,
      `Limitations: ${(score.limitations || []).join ? score.limitations.join(" ") : score.limitations}`,
      `Verification: ${(score.recommendedVerification || []).join ? score.recommendedVerification.join("; ") : ""}`,
      "",
    );
  }
  lines.push("Red flags and positive indicators", "Red flags:", ...(scan.redFlags || []).map((item) => `- ${item}`));
  lines.push("Positive indicators:", ...(scan.positiveIndicators || []).map((item) => `- ${item}`), "");
  lines.push("Recommended next steps", ...(scan.recommendedNextSteps || []).map((item) => `- ${item}`), "");
  lines.push(
    "Appendix: JSON summary",
    JSON.stringify({
      scanId: scan.scanId,
      dataMode: scan.dataMode,
      reportReadiness: scan.reportReadiness,
      clientReadyDeliverable: scan.clientReadyDeliverable,
      overallRiskScore: scan.overallRiskScore,
      confidence: scan.confidence,
      providerOutputs: scan.providerOutputs,
      scoreExplainability: scan.scoreExplainability,
      aiAnalysis: ai,
    }),
  );
  lines.push("Disclaimer", scan.disclaimer || "");
  return lines.flatMap((line) => wrapLine(line, 95));
};

const buildContentStream = (lines, pageIndex, pageLabel = "") => {
  const commands = ["BT", "/F1 10 Tf", "50 770 Td", "14 TL"];
  if (pageIndex === 0) {
    commands.push("/F1 20 Tf", "(TerraSignal) Tj", "T*", "/F1 14 Tf", "(Preliminary Site Intelligence Report) Tj", "T*", "/F1 10 Tf");
  }
  if (pageLabel) {
    commands.push("/F1 12 Tf", `(${escapePdfText(pageLabel)}) Tj`, "T*", "/F1 10 Tf");
  }
  commands.push(
    pageIndex === 0 ? "" : "T*",
    pageIndex >= 0 ? "(Preliminary decision-support only - not a certified professional report) Tj" : "",
    "T*",
  );
  for (const line of lines) {
    commands.push(`(${escapePdfText(line)}) Tj`, "T*");
  }
  commands.push("ET");
  return commands.join("\n");
};

export const buildReportPdf = (scan, report) => {
  const allLines = flattenReportLines(scan, report);
  const pages = [];
  const linesPerPage = 48;
  const pageLabel =
    scan.dataMode === "mock"
      ? "DEMO / MOCK DATA - INTERNAL TESTING ONLY"
      : scan.reportReadiness === "clientPreview"
        ? "PARTIAL LIVE-DATA PRELIMINARY SCREENING PREVIEW"
        : "";
  for (let index = 0; index < allLines.length; index += linesPerPage) {
    pages.push(allLines.slice(index, index + linesPerPage));
  }

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("PAGES_PLACEHOLDER");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  pages.forEach((pageLines, index) => {
    const stream = buildContentStream(pageLines, index, pageLabel);
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  });

  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] >>`;

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "binary");
};
