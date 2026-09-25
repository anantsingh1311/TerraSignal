import { parseSurveyFile } from "./analysis-engine.js";

const cases = [
  {
    name: "comma CSV",
    text: "id,x,y,depth,resistivity,velocity,magnetic,noise\nA,1,2,3,40,1200,48000,10",
    expectedId: "A",
  },
  {
    name: "tab TSV",
    text: "ID\tX\tY\tDEPTH\tRESISTIVITY\tVELOCITY\tMAGNETIC\tNOISE\nB\t1\t2\t3\t40\t1200\t48000\t10",
    expectedId: "B",
  },
  {
    name: "whitespace TXT",
    text: "id x y depth resistivity velocity magnetic noise\nC 1 2 3 40 1200 48000 10",
    expectedId: "C",
  },
  {
    name: "alias headers",
    text: "station,easting,northing,z,rho,vs,mag_nt,snr\nD,1,2,3,40,1200,48000,10",
    expectedId: "D",
  },
  {
    name: "lat lon headers",
    text: "station,lat,lon,depth,rho,vs,mag_nt,snr\nG,40.7357,-74.0112,3,40,1200,48000,10",
    expectedId: "G",
    expectedMode: "lat_lon",
  },
];

const issues = [];

for (const testCase of cases) {
  const result = parseSurveyFile(testCase.text);
  const point = result.points[0];
  if (result.points.length !== 1 || point.id !== testCase.expectedId || point.resistivity !== 40) {
    issues.push(`${testCase.name} did not parse the expected station shape.`);
  }
  if ((testCase.expectedMode ?? "local_xy") !== result.coordinateMode) {
    issues.push(`${testCase.name} returned ${result.coordinateMode} coordinate mode.`);
  }
}

const missingCoordinates = parseSurveyFile(
  "id,depth,resistivity,velocity,magnetic,noise\nH,3,40,1200,48000,10",
);
if (missingCoordinates.points.length !== 0 || !missingCoordinates.warnings.some((warning) => warning.message.includes("coordinate"))) {
  issues.push("Files without x/y or lat/lon should be rejected with a coordinate warning.");
}

const malformed = parseSurveyFile(
  "id,x,y,depth,resistivity,velocity,magnetic,noise\nE,1,nope,3,bad,1200,48000,10",
);
if (malformed.points.length !== 0 || malformed.warnings.length < 2) {
  issues.push("Malformed numeric rows should be skipped with row-level warnings.");
}

const clamped = parseSurveyFile(
  "id,x,y,depth,resistivity,velocity,magnetic,noise\nF,1,2,3,40,1200,48000,140",
);
if (clamped.points[0]?.noise !== 100 || !clamped.warnings.some((warning) => warning.field === "noise")) {
  issues.push("Noise values outside 0-100 should be clamped with a warning.");
}

if (issues.length) {
  console.error("Parser validation failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      message: "CSV, TSV, TXT, alias-header, and malformed-row parser checks passed.",
    },
    null,
    2,
  ),
);
