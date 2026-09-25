export const coordinateParserExamples = [
  "28.4595, 77.0266",
  "28.4595 77.0266",
  "lat: 28.4595, lng: 77.0266",
  "19°12'44.7\"N 73°08'39.3\"E",
  "19 12 44.7 N, 73 08 39.3 E",
  "28.4595 N, 77.0266 E",
];

const normalizeCoordinateText = (input) =>
  String(input || "")
    .trim()
    .normalize("NFKC")
    .replace(/\u00c2?\u00b0|\u00ba|\u02da/gi, " deg ")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/\bnorth\b/gi, "N")
    .replace(/\bsouth\b/gi, "S")
    .replace(/\beast\b/gi, "E")
    .replace(/\bwest\b/gi, "W")
    .replace(/\blongitude\b|\blong\b|\blon\b/gi, "lng")
    .replace(/\blatitude\b/gi, "lat")
    .replace(/[;|]/g, ",")
    .replace(/\s+/g, " ")
    .trim();

const parseNumber = (value) => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const validateLatitudeLongitude = (latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "Coordinates must contain valid numeric latitude and longitude values.";
  }
  if (latitude < -90 || latitude > 90) return "Latitude must be between -90 and 90 degrees.";
  if (longitude < -180 || longitude > 180) return "Longitude must be between -180 and 180 degrees.";
  return null;
};

const failure = (error) => ({ ok: false, error, examples: coordinateParserExamples });

const success = (latitude, longitude, originalInput, normalizedInput, format) => {
  const error = validateLatitudeLongitude(latitude, longitude);
  if (error) return failure(error);
  return {
    ok: true,
    coordinate: { latitude, longitude, originalInput, normalizedInput, format },
  };
};

const signedByHemisphere = (degrees, hemisphere) => {
  const sign = /[SW]/i.test(hemisphere) ? -1 : degrees < 0 ? -1 : 1;
  return sign * Math.abs(degrees);
};

const dmsToDecimal = (parts, hemisphere) => {
  const [degrees = 0, minutes = 0, seconds = 0] = parts;
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  const absolute = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const signed = signedByHemisphere(absolute, hemisphere);
  const max = /[NS]/i.test(hemisphere) ? 90 : 180;
  return Math.abs(signed) <= max ? signed : null;
};

const parseLabeledDecimal = (originalInput, normalizedInput) => {
  const latMatch = normalizedInput.match(/\blat\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  const lngMatch = normalizedInput.match(/\blng\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  if (!latMatch && !lngMatch) return null;
  if (!latMatch || !lngMatch) return failure("Both labeled latitude and longitude are required.");
  const latitude = parseNumber(latMatch[1]);
  const longitude = parseNumber(lngMatch[1]);
  if (latitude === null || longitude === null) {
    return failure("Labeled coordinates must contain numeric latitude and longitude values.");
  }
  return success(latitude, longitude, originalInput, normalizedInput, "labeled-decimal");
};

const parseDecimalPair = (originalInput, normalizedInput) => {
  if (/[NSEW]/i.test(normalizedInput)) return null;
  const match = normalizedInput.match(/([+-]?\d+(?:\.\d+)?)\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = parseNumber(match[1]);
  const longitude = parseNumber(match[2]);
  if (latitude === null || longitude === null) return failure("Decimal coordinates must contain two numeric values.");
  return success(latitude, longitude, originalInput, normalizedInput, "decimal");
};

const parseCardinalDecimal = (originalInput, normalizedInput) => {
  if (!/(?:\d\s*(?:deg\s*)?[NSEW]\b)|(?:\b[NSEW]\b)/i.test(normalizedInput)) return null;
  const matches = [...normalizedInput.matchAll(/([+-]?\d+(?:\.\d+)?)\s*(?:deg)?\s*([NSEW])/gi)].map(
    (match) => ({ value: Number(match[1]), hemisphere: match[2].toUpperCase() }),
  );
  if (matches.length < 2) return null;
  const latitudeItem = matches.find((item) => item.hemisphere === "N" || item.hemisphere === "S");
  const longitudeItem = matches.find((item) => item.hemisphere === "E" || item.hemisphere === "W");
  if (!latitudeItem || !longitudeItem) {
    return failure("Coordinates with N/S/E/W must include one latitude hemisphere and one longitude hemisphere.");
  }
  return success(
    signedByHemisphere(latitudeItem.value, latitudeItem.hemisphere),
    signedByHemisphere(longitudeItem.value, longitudeItem.hemisphere),
    originalInput,
    normalizedInput,
    "cardinal-decimal",
  );
};

const parseDms = (originalInput, normalizedInput) => {
  if (!/(?:\d\s*(?:deg\s*)?[NSEW]\b)|(?:\b[NSEW]\b)/i.test(normalizedInput)) return null;
  const tokenized = normalizedInput
    .replace(/deg|[,'"]/gi, " ")
    .replace(/([0-9.])\s*([NSEW])\b/gi, "$1 $2 ")
    .replace(/\b([NSEW])\b/gi, " $1 ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const coordinateParts = [];
  let pendingNumbers = [];
  for (const token of tokenized) {
    if (/^[NSEW]$/i.test(token)) {
      coordinateParts.push({ hemisphere: token.toUpperCase(), parts: pendingNumbers.slice(-3) });
      pendingNumbers = [];
      continue;
    }
    const parsed = parseNumber(token);
    if (parsed !== null) pendingNumbers.push(parsed);
  }

  if (coordinateParts.length < 2) return null;
  const latitudePart = coordinateParts.find((item) => item.hemisphere === "N" || item.hemisphere === "S");
  const longitudePart = coordinateParts.find((item) => item.hemisphere === "E" || item.hemisphere === "W");
  if (!latitudePart || !longitudePart) return failure("DMS coordinates must include N/S and E/W.");

  const latitude = dmsToDecimal(latitudePart.parts, latitudePart.hemisphere);
  const longitude = dmsToDecimal(longitudePart.parts, longitudePart.hemisphere);
  if (latitude === null || longitude === null) {
    return failure("DMS minutes and seconds must be between 0 and 59, and degrees must be in range.");
  }

  const format =
    latitudePart.parts.length === 1 && longitudePart.parts.length === 1 ? "cardinal-decimal" : "dms";
  return success(latitude, longitude, originalInput, normalizedInput, format);
};

export const parseCoordinateInput = (input) => {
  const originalInput = String(input || "").trim();
  if (!originalInput) return failure("Enter coordinates before running a land scan.");
  const normalizedInput = normalizeCoordinateText(originalInput);
  return (
    parseLabeledDecimal(originalInput, normalizedInput) ||
    parseDms(originalInput, normalizedInput) ||
    parseCardinalDecimal(originalInput, normalizedInput) ||
    parseDecimalPair(originalInput, normalizedInput) ||
    failure("Could not read the coordinate format. Paste decimal or DMS latitude/longitude values.")
  );
};

export const normalizeScanLocation = ({ coordinateInput, latitude, longitude, address, radiusMeters, boundary }) => {
  const coordinateResult = coordinateInput ? parseCoordinateInput(coordinateInput) : null;
  const lat = coordinateResult?.ok ? coordinateResult.coordinate.latitude : Number(latitude);
  const lng = coordinateResult?.ok ? coordinateResult.coordinate.longitude : Number(longitude);
  const coordinateError = coordinateResult && !coordinateResult.ok ? coordinateResult.error : validateLatitudeLongitude(lat, lng);
  const radius = Number(radiusMeters ?? 500);
  const errors = [];
  if (coordinateError) errors.push(coordinateError);
  if (!Number.isFinite(radius) || radius < 25 || radius > 100_000) {
    errors.push("Radius must be between 25 m and 100,000 m.");
  }

  const normalizedBoundary = Array.isArray(boundary)
    ? boundary
        .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
        .filter((point) => !validateLatitudeLongitude(point.lat, point.lng))
        .slice(0, 100)
    : [];

  return {
    valid: errors.length === 0,
    errors,
    location: {
      lat,
      lng,
      address: String(address || "").trim(),
      radiusMeters: radius,
      boundary: normalizedBoundary,
      coordinateInput: coordinateInput || `${lat}, ${lng}`,
      coordinateFormat: coordinateResult?.ok ? coordinateResult.coordinate.format : "decimal",
    },
  };
};
