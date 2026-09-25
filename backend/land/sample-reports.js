import { randomUUID } from "node:crypto";
import { collectLandScanLayers } from "./data-adapters.js";
import { buildExplainableLandScan } from "./scoring-engine.js";
import { generateProfessionalReport } from "./report-generator.js";

const sampleInputs = [
  {
    id: "sample-uk-residential",
    title: "UK Residential Land Screening",
    market: "UK",
    demo: true,
    input: {
      location: {
        lat: 51.5079,
        lng: -0.0877,
        address: "Demo parcel near Greater London, UK",
        radiusMeters: 650,
        boundary: [],
        coordinateInput: "51.5079, -0.0877",
        coordinateFormat: "decimal",
      },
      intendedUse: "residential",
      reportDepth: "standard",
      scanMode: "internalDemo",
      pricingMode: "free-demo",
    },
  },
  {
    id: "sample-us-warehouse",
    title: "US Warehouse Site Screening",
    market: "US",
    demo: true,
    input: {
      location: {
        lat: 33.749,
        lng: -84.388,
        address: "Demo logistics parcel near Atlanta, USA",
        radiusMeters: 1200,
        boundary: [],
        coordinateInput: "33.749, -84.388",
        coordinateFormat: "decimal",
      },
      intendedUse: "warehouse",
      reportDepth: "professional",
      scanMode: "internalDemo",
      pricingMode: "free-demo",
    },
  },
  {
    id: "sample-india-urban",
    title: "India Urban Development Screening",
    market: "India",
    demo: true,
    input: {
      location: {
        lat: 28.4595,
        lng: 77.0266,
        address: "Demo urban parcel near Gurugram, India",
        radiusMeters: 500,
        boundary: [],
        coordinateInput: "28.4595, 77.0266",
        coordinateFormat: "decimal",
      },
      intendedUse: "mixed use",
      reportDepth: "professional",
      scanMode: "internalDemo",
      pricingMode: "free-demo",
    },
  },
  {
    id: "sample-uae-commercial",
    title: "UAE Commercial Land Screening",
    market: "UAE",
    demo: true,
    input: {
      location: {
        lat: 25.2048,
        lng: 55.2708,
        address: "Demo commercial parcel near Dubai, UAE",
        radiusMeters: 900,
        boundary: [],
        coordinateInput: "25.2048, 55.2708",
        coordinateFormat: "decimal",
      },
      intendedUse: "commercial",
      reportDepth: "standard",
      scanMode: "internalDemo",
      pricingMode: "free-demo",
    },
  },
];

const sampleCacheTtlMs = 5 * 60 * 1000;
let sampleReportsCache = null;
let sampleReportsCacheAt = 0;
let sampleReportsPromise = null;

export const buildSampleReports = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && sampleReportsCache && now - sampleReportsCacheAt < sampleCacheTtlMs) return sampleReportsCache;
  if (!force && sampleReportsPromise) return sampleReportsPromise;

  sampleReportsPromise = Promise.all(
    sampleInputs.map(async (sample) => {
      const scan = buildExplainableLandScan({
        scanId: sample.id,
        userId: "demo",
        input: sample.input,
        layers: await collectLandScanLayers(sample.input),
      });
      const report = await generateProfessionalReport(scan);
      scan.aiAnalysis = report.aiAnalysis;
      scan.aiStatus = report.aiAnalysis?.aiStatus || "not_configured";
      return {
        id: sample.id,
        title: sample.title,
        market: sample.market,
        demo: true,
        scan: {
          ...scan,
          scanId: sample.id,
          sampleReportId: sample.id,
          demoLabel: "Demo/sample report - not a real client scan",
        },
        report,
      };
    }),
  )
    .then((reports) => {
      sampleReportsCache = reports;
      sampleReportsCacheAt = Date.now();
      return reports;
    })
    .finally(() => {
      sampleReportsPromise = null;
    });

  return sampleReportsPromise;
};

export const createSampleLikeScan = async (sampleInput) => {
  const input = sampleInput.input || sampleInput;
  const scan = buildExplainableLandScan({
    scanId: randomUUID(),
    userId: "demo",
    input,
    layers: await collectLandScanLayers(input),
  });
  const report = await generateProfessionalReport(scan);
  scan.aiAnalysis = report.aiAnalysis;
  scan.aiStatus = report.aiAnalysis?.aiStatus || "not_configured";
  return { scan, report };
};
