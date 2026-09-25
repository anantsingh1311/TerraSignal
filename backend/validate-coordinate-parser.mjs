import assert from "node:assert/strict";
import { parseSiteCoordinateInput } from "../src/features/site-intelligence/utils/coordinateParser.ts";

const cases = [
  ["decimal comma", "28.440402, 77.073830", 28.440402, 77.07383],
  ["decimal space", "28.440402 77.073830", 28.440402, 77.07383],
  ["labeled decimal", "lat: 28.440402, lng: 77.073830", 28.440402, 77.07383],
  ["compact DMS", "19\u00b012'44.7\"N 73\u00b008'39.3\"E", 19.2124166667, 73.14425],
  ["spaced DMS", "19 12 44.7 N, 73 08 39.3 E", 19.2124166667, 73.14425],
  ["cardinal decimal", "28.440402 N, 77.073830 E", 28.440402, 77.07383],
];

const closeTo = (actual, expected) => Math.abs(actual - expected) < 0.000001;

for (const [name, input, expectedLatitude, expectedLongitude] of cases) {
  const result = parseSiteCoordinateInput(input);
  assert.equal(result.ok, true, `${name} should parse`);
  assert.equal(closeTo(result.coordinate.latitude, expectedLatitude), true, `${name} latitude mismatch`);
  assert.equal(closeTo(result.coordinate.longitude, expectedLongitude), true, `${name} longitude mismatch`);
}

for (const input of ["91, 77", "28, 181", "lat: 28.4", "not a coordinate"]) {
  const result = parseSiteCoordinateInput(input);
  assert.equal(result.ok, false, `${input} should be rejected`);
  assert.equal(typeof result.error, "string");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      message: "Coordinate parser decimal, labeled, DMS, cardinal, and rejection examples passed.",
    },
    null,
    2,
  ),
);
