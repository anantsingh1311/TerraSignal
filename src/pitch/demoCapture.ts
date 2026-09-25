// Captured screening output for the pitch demo.
//
// These are REAL outputs from the deterministic scoring engine, produced by
// running live provider queries against three coordinates in the Gurugram area
// on the date recorded in capturedAt below. Nothing here is invented, adjusted
// or illustrative.
//
// The demo re-weights these captured sub-scores using the same ranking
// arithmetic the product uses, so a visitor can interrogate the real method
// without waiting for a live scan or consuming provider quota. Running a live
// scan in the product produces the same shape of output for any coordinate.
//
// The AI narrative is deliberately excluded: the demo exists to show the
// deterministic layer, which is the part that produces the numbers.

export const demoCapture = {
  "capturedAt": "2026-09-01T01:38:35.340Z",
  "sites": [
    {
      "id": "demo-site-a",
      "label": "Site A - Cyber City corridor, Gurugram",
      "note": "Dense established commercial corridor",
      "location": {
        "lat": 28.495,
        "lng": 77.089,
        "address": "Site A - Cyber City corridor, Gurugram",
        "radiusMeters": 900,
        "boundary": [],
        "coordinateInput": "28.495, 77.089",
        "coordinateFormat": "decimal"
      },
      "dataMode": "live",
      "confidence": 0.43,
      "overallRiskScore": 13,
      "overallSuitabilityScore": 82,
      "riskBand": {
        "label": "Low",
        "description": "No major screening-level indicators dominate, but professional verification is still required."
      },
      "minimumLiveDataPackage": {
        "satisfied": true,
        "hasRealElevationOrTerrainProvider": true,
        "hasRealMapInfrastructureContextProvider": true,
        "noMockProviderUsedInScore": true,
        "missing": []
      },
      "unavailableScores": [
        "floodContextIndicator"
      ],
      "redFlags": [
        "Data availability is limited and materially reduces confidence; unsupported indicators are not scored."
      ],
      "positiveIndicators": [
        "Slope/terrain indicator is not dominant in this preliminary screen.",
        "Mapped drainage/water proximity indicator is not dominant in this preliminary screen.",
        "Mapped road/access context appears favorable at screening level, subject to official verification.",
        "Minimum live-data package is present for a preliminary live-data screening workflow."
      ],
      "subScores": {
        "slopeTerrainRisk": {
          "scoreId": "slopeTerrainRisk",
          "scoreName": "Slope/terrain risk",
          "available": true,
          "score": 2,
          "confidence": 0.58,
          "formula": "meanSlopeDegrees * 3.4 + maxSlopeDegrees * 1.3 + slopeVariance * 1.1, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "meanSlopeDegrees": 0.3,
            "maxSlopeDegrees": 0.6,
            "slopeVariance": 0.3
          },
          "providerSources": [
            "Open-Meteo elevation API"
          ],
          "limitations": [
            "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
          ],
          "recommendedVerification": [
            "Parcel topographic survey",
            "Slope stability review where slopes, cuts, or retaining are material"
          ]
        },
        "elevationVariabilityRisk": {
          "scoreId": "elevationVariabilityRisk",
          "scoreName": "Elevation variability risk",
          "available": true,
          "score": 13,
          "confidence": 0.58,
          "formula": "reliefMeters * 0.55 + terrainVariabilityIndex * 45, clamped to 0-100.",
          "thresholds": {
            "low": "relief under about 35 m",
            "moderate": "35-95 m",
            "high": "above about 95 m"
          },
          "rawInputs": {
            "minElevationMeters": 234,
            "maxElevationMeters": 249,
            "meanElevationMeters": 241,
            "reliefMeters": 15,
            "terrainVariabilityIndex": 0.11,
            "resolutionLabel": "Open-Meteo elevation sampled points"
          },
          "providerSources": [
            "Open-Meteo elevation API"
          ],
          "limitations": [
            "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
          ],
          "recommendedVerification": [
            "Topographic survey",
            "Cut/fill and drainage levels review"
          ]
        },
        "drainageWaterProximityRisk": {
          "scoreId": "drainageWaterProximityRisk",
          "scoreName": "Drainage/water proximity risk",
          "available": true,
          "score": 0,
          "confidence": 0.66,
          "formula": "waterProximityRiskIndex when supplied; otherwise 100 - nearestWaterFeatureMeters / 35 + waterFeatureCount * 6, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "nearestWaterFeatureMeters": null,
            "waterFeatureCount": 0,
            "waterProximityRiskIndex": 0
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Official floodplain maps",
            "Drainage/stormwater design review",
            "Seasonal site observations"
          ]
        },
        "infrastructureAccessIndicator": {
          "scoreId": "infrastructureAccessIndicator",
          "scoreName": "Infrastructure/access indicator",
          "available": true,
          "score": 6,
          "confidence": 0.66,
          "formula": "(100 - roadAccessQualityIndex) * 0.65 + distancePenalty * 0.2 + (100 - infrastructureContextIndex) * 0.15.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "nearestRoadMeters": 297,
            "roadFeatureCount": 18,
            "utilityAmenityFeatureCount": 102,
            "roadAccessQualityIndex": 95,
            "infrastructureContextIndex": 95
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Legal access check",
            "Road classification and utility availability",
            "Easement and right-of-way review"
          ]
        },
        "landUseContextIndicator": {
          "scoreId": "landUseContextIndicator",
          "scoreName": "Land-use/context indicator",
          "available": true,
          "score": 0,
          "confidence": 0.66,
          "formula": "landUseContextIndex + industrialContextFeatureCount * 4, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "dominantClass": "urban or peri-urban",
            "landUseFeatureCount": 0,
            "industrialContextFeatureCount": 0,
            "landUseContextIndex": 0
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Official zoning/planning records",
            "Environmental desktop review",
            "Historical land-use review"
          ]
        },
        "floodContextIndicator": {
          "scoreId": "floodContextIndicator",
          "scoreName": "Flood context indicator",
          "available": false,
          "score": 0,
          "confidence": 0,
          "formula": "Unavailable: no real scoring dataset was returned for this indicator.",
          "thresholds": {},
          "rawInputs": {},
          "providerSources": [
            "drainageFlood unavailable"
          ],
          "limitations": [
            "No supported live flood authority provider returned data for this location."
          ],
          "recommendedVerification": [
            "Official flood authority datasets",
            "Drainage/stormwater review"
          ]
        },
        "dataAvailabilityConfidence": {
          "scoreId": "dataAvailabilityConfidence",
          "scoreName": "Data availability confidence risk",
          "available": true,
          "score": 48,
          "confidence": 0.52,
          "formula": "100 - providerAvailabilityScore.",
          "thresholds": {
            "low": "availability risk <35",
            "moderate": "35-64",
            "high": ">=65"
          },
          "rawInputs": {
            "providerAvailabilityScore": 52,
            "providerStatuses": {
              "elevationTopography": "live",
              "slope": "live",
              "drainageFlood": "unavailable",
              "nearbyWaterBodies": "live",
              "infrastructure": "live",
              "landUseContext": "live",
              "cesiumTerrain": "live",
              "mapboxVisualLayers": "unavailable",
              "geologySoil": "unavailable",
              "seismicGeology": "unavailable",
              "indiaAuthoritativePlaceholder": "unavailable"
            },
            "minimumLiveDataPackage": {
              "satisfied": true,
              "hasRealElevationOrTerrainProvider": true,
              "hasRealMapInfrastructureContextProvider": true,
              "noMockProviderUsedInScore": true,
              "missing": []
            }
          },
          "providerSources": [
            "Provider registry"
          ],
          "limitations": [
            "This is an evidence-quality indicator, not a ground-condition measurement."
          ],
          "recommendedVerification": [
            "Connect live providers",
            "Upload verified site documents",
            "Collect certified professional evidence"
          ]
        },
        "intendedUsePreliminarySuitability": {
          "scoreId": "intendedUsePreliminarySuitability",
          "scoreName": "Intended-use preliminary suitability pressure",
          "available": true,
          "score": 19,
          "confidence": 0.63,
          "formula": "physicalRiskAverage + intendedUseAdjustment + dataAvailabilityRisk * 0.22, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "intendedUse": "commercial",
            "reportDepth": "standard",
            "physicalRiskAverage": 4,
            "intendedUseAdjustment": 4,
            "dataAvailabilityRisk": 48
          },
          "providerSources": [
            "Deterministic scoring engine"
          ],
          "limitations": [
            "Depends on available provider coverage and does not include certified site investigation."
          ],
          "recommendedVerification": [
            "Professional discipline review based on intended use and local requirements"
          ]
        }
      },
      "sourceTable": [
        {
          "id": "elevationTopography",
          "providerName": "Open-Meteo elevation API",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.58,
          "citation": "https://open-meteo.com/en/docs/elevation-api",
          "attribution": "Open-Meteo elevation API; underlying DEM source attribution applies.",
          "limitations": "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
        },
        {
          "id": "slope",
          "providerName": "Open-Meteo elevation API",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.58,
          "citation": "https://open-meteo.com/en/docs/elevation-api",
          "attribution": "Open-Meteo elevation API; underlying DEM source attribution applies.",
          "limitations": "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
        },
        {
          "id": "drainageFlood",
          "providerName": "drainageFlood unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No supported live flood authority provider returned data for this location."
        },
        {
          "id": "nearbyWaterBodies",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "infrastructure",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "landUseContext",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "cesiumTerrain",
          "providerName": "Cesium ion world terrain",
          "sourceType": "commercial-api",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.5,
          "citation": "https://cesium.com/platform/cesium-ion/",
          "attribution": "Cesium ion",
          "limitations": "Cesium terrain is currently used for visualization metadata only in this backend; it is not treated as a scoring dataset unless terrain sampling is implemented."
        },
        {
          "id": "mapboxVisualLayers",
          "providerName": "Mapbox satellite/terrain/contour layers",
          "sourceType": "commercial-api",
          "dataMode": "unavailable",
          "regionCoverage": "global",
          "confidence": 0,
          "citation": "https://www.mapbox.com/",
          "attribution": "Mapbox attribution applies when configured.",
          "limitations": "MAPBOX_ACCESS_TOKEN is not configured; Mapbox visual layers are unavailable."
        },
        {
          "id": "geologySoil",
          "providerName": "geologySoil unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No real soil/geology provider is implemented or configured for this scan."
        },
        {
          "id": "seismicGeology",
          "providerName": "seismicGeology unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No real seismic/geology hazard provider is implemented for this scan."
        },
        {
          "id": "indiaAuthoritativePlaceholder",
          "providerName": "India authoritative/open data placeholder",
          "sourceType": "authoritative",
          "dataMode": "unavailable",
          "regionCoverage": "India",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No India authoritative/open geotechnical, flood, cadastral, seismic, or environmental adapter is implemented in this build."
        }
      ]
    },
    {
      "id": "demo-site-b",
      "label": "Site B - Sohna Road corridor, Gurugram",
      "note": "Growth corridor south of the city",
      "location": {
        "lat": 28.4089,
        "lng": 77.041,
        "address": "Site B - Sohna Road corridor, Gurugram",
        "radiusMeters": 900,
        "boundary": [],
        "coordinateInput": "28.4089, 77.041",
        "coordinateFormat": "decimal"
      },
      "dataMode": "live",
      "confidence": 0.43,
      "overallRiskScore": 34,
      "overallSuitabilityScore": 66,
      "riskBand": {
        "label": "Low",
        "description": "No major screening-level indicators dominate, but professional verification is still required."
      },
      "minimumLiveDataPackage": {
        "satisfied": true,
        "hasRealElevationOrTerrainProvider": true,
        "hasRealMapInfrastructureContextProvider": true,
        "noMockProviderUsedInScore": true,
        "missing": []
      },
      "unavailableScores": [
        "floodContextIndicator"
      ],
      "redFlags": [
        "Data availability is limited and materially reduces confidence; unsupported indicators are not scored."
      ],
      "positiveIndicators": [
        "Slope/terrain indicator is not dominant in this preliminary screen.",
        "Mapped road/access context appears favorable at screening level, subject to official verification.",
        "Minimum live-data package is present for a preliminary live-data screening workflow."
      ],
      "subScores": {
        "slopeTerrainRisk": {
          "scoreId": "slopeTerrainRisk",
          "scoreName": "Slope/terrain risk",
          "available": true,
          "score": 1,
          "confidence": 0.58,
          "formula": "meanSlopeDegrees * 3.4 + maxSlopeDegrees * 1.3 + slopeVariance * 1.1, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "meanSlopeDegrees": 0.1,
            "maxSlopeDegrees": 0.4,
            "slopeVariance": 0.3
          },
          "providerSources": [
            "Open-Meteo elevation API"
          ],
          "limitations": [
            "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
          ],
          "recommendedVerification": [
            "Parcel topographic survey",
            "Slope stability review where slopes, cuts, or retaining are material"
          ]
        },
        "elevationVariabilityRisk": {
          "scoreId": "elevationVariabilityRisk",
          "scoreName": "Elevation variability risk",
          "available": true,
          "score": 6,
          "confidence": 0.58,
          "formula": "reliefMeters * 0.55 + terrainVariabilityIndex * 45, clamped to 0-100.",
          "thresholds": {
            "low": "relief under about 35 m",
            "moderate": "35-95 m",
            "high": "above about 95 m"
          },
          "rawInputs": {
            "minElevationMeters": 225,
            "maxElevationMeters": 232,
            "meanElevationMeters": 228,
            "reliefMeters": 7,
            "terrainVariabilityIndex": 0.05,
            "resolutionLabel": "Open-Meteo elevation sampled points"
          },
          "providerSources": [
            "Open-Meteo elevation API"
          ],
          "limitations": [
            "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
          ],
          "recommendedVerification": [
            "Topographic survey",
            "Cut/fill and drainage levels review"
          ]
        },
        "drainageWaterProximityRisk": {
          "scoreId": "drainageWaterProximityRisk",
          "scoreName": "Drainage/water proximity risk",
          "available": true,
          "score": 54,
          "confidence": 0.66,
          "formula": "waterProximityRiskIndex when supplied; otherwise 100 - nearestWaterFeatureMeters / 35 + waterFeatureCount * 6, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "nearestWaterFeatureMeters": 1807,
            "waterFeatureCount": 1,
            "waterProximityRiskIndex": 54.371428571428574
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Official floodplain maps",
            "Drainage/stormwater design review",
            "Seasonal site observations"
          ]
        },
        "infrastructureAccessIndicator": {
          "scoreId": "infrastructureAccessIndicator",
          "scoreName": "Infrastructure/access indicator",
          "available": true,
          "score": 6,
          "confidence": 0.66,
          "formula": "(100 - roadAccessQualityIndex) * 0.65 + distancePenalty * 0.2 + (100 - infrastructureContextIndex) * 0.15.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "nearestRoadMeters": 297,
            "roadFeatureCount": 69,
            "utilityAmenityFeatureCount": 30,
            "roadAccessQualityIndex": 95,
            "infrastructureContextIndex": 95
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Legal access check",
            "Road classification and utility availability",
            "Easement and right-of-way review"
          ]
        },
        "landUseContextIndicator": {
          "scoreId": "landUseContextIndicator",
          "scoreName": "Land-use/context indicator",
          "available": true,
          "score": 100,
          "confidence": 0.66,
          "formula": "landUseContextIndex + industrialContextFeatureCount * 4, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "dominantClass": "industrial or commercial context",
            "landUseFeatureCount": 20,
            "industrialContextFeatureCount": 8,
            "landUseContextIndex": 95
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Official zoning/planning records",
            "Environmental desktop review",
            "Historical land-use review"
          ]
        },
        "floodContextIndicator": {
          "scoreId": "floodContextIndicator",
          "scoreName": "Flood context indicator",
          "available": false,
          "score": 0,
          "confidence": 0,
          "formula": "Unavailable: no real scoring dataset was returned for this indicator.",
          "thresholds": {},
          "rawInputs": {},
          "providerSources": [
            "drainageFlood unavailable"
          ],
          "limitations": [
            "No supported live flood authority provider returned data for this location."
          ],
          "recommendedVerification": [
            "Official flood authority datasets",
            "Drainage/stormwater review"
          ]
        },
        "dataAvailabilityConfidence": {
          "scoreId": "dataAvailabilityConfidence",
          "scoreName": "Data availability confidence risk",
          "available": true,
          "score": 48,
          "confidence": 0.52,
          "formula": "100 - providerAvailabilityScore.",
          "thresholds": {
            "low": "availability risk <35",
            "moderate": "35-64",
            "high": ">=65"
          },
          "rawInputs": {
            "providerAvailabilityScore": 52,
            "providerStatuses": {
              "elevationTopography": "live",
              "slope": "live",
              "drainageFlood": "unavailable",
              "nearbyWaterBodies": "live",
              "infrastructure": "live",
              "landUseContext": "live",
              "cesiumTerrain": "live",
              "mapboxVisualLayers": "unavailable",
              "geologySoil": "unavailable",
              "seismicGeology": "unavailable",
              "indiaAuthoritativePlaceholder": "unavailable"
            },
            "minimumLiveDataPackage": {
              "satisfied": true,
              "hasRealElevationOrTerrainProvider": true,
              "hasRealMapInfrastructureContextProvider": true,
              "noMockProviderUsedInScore": true,
              "missing": []
            }
          },
          "providerSources": [
            "Provider registry"
          ],
          "limitations": [
            "This is an evidence-quality indicator, not a ground-condition measurement."
          ],
          "recommendedVerification": [
            "Connect live providers",
            "Upload verified site documents",
            "Collect certified professional evidence"
          ]
        },
        "intendedUsePreliminarySuitability": {
          "scoreId": "intendedUsePreliminarySuitability",
          "scoreName": "Intended-use preliminary suitability pressure",
          "available": true,
          "score": 48,
          "confidence": 0.63,
          "formula": "physicalRiskAverage + intendedUseAdjustment + dataAvailabilityRisk * 0.22, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "intendedUse": "commercial",
            "reportDepth": "standard",
            "physicalRiskAverage": 33,
            "intendedUseAdjustment": 4,
            "dataAvailabilityRisk": 48
          },
          "providerSources": [
            "Deterministic scoring engine"
          ],
          "limitations": [
            "Depends on available provider coverage and does not include certified site investigation."
          ],
          "recommendedVerification": [
            "Professional discipline review based on intended use and local requirements"
          ]
        }
      },
      "sourceTable": [
        {
          "id": "elevationTopography",
          "providerName": "Open-Meteo elevation API",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.58,
          "citation": "https://open-meteo.com/en/docs/elevation-api",
          "attribution": "Open-Meteo elevation API; underlying DEM source attribution applies.",
          "limitations": "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
        },
        {
          "id": "slope",
          "providerName": "Open-Meteo elevation API",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.58,
          "citation": "https://open-meteo.com/en/docs/elevation-api",
          "attribution": "Open-Meteo elevation API; underlying DEM source attribution applies.",
          "limitations": "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
        },
        {
          "id": "drainageFlood",
          "providerName": "drainageFlood unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No supported live flood authority provider returned data for this location."
        },
        {
          "id": "nearbyWaterBodies",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "infrastructure",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "landUseContext",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "cesiumTerrain",
          "providerName": "Cesium ion world terrain",
          "sourceType": "commercial-api",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.5,
          "citation": "https://cesium.com/platform/cesium-ion/",
          "attribution": "Cesium ion",
          "limitations": "Cesium terrain is currently used for visualization metadata only in this backend; it is not treated as a scoring dataset unless terrain sampling is implemented."
        },
        {
          "id": "mapboxVisualLayers",
          "providerName": "Mapbox satellite/terrain/contour layers",
          "sourceType": "commercial-api",
          "dataMode": "unavailable",
          "regionCoverage": "global",
          "confidence": 0,
          "citation": "https://www.mapbox.com/",
          "attribution": "Mapbox attribution applies when configured.",
          "limitations": "MAPBOX_ACCESS_TOKEN is not configured; Mapbox visual layers are unavailable."
        },
        {
          "id": "geologySoil",
          "providerName": "geologySoil unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No real soil/geology provider is implemented or configured for this scan."
        },
        {
          "id": "seismicGeology",
          "providerName": "seismicGeology unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No real seismic/geology hazard provider is implemented for this scan."
        },
        {
          "id": "indiaAuthoritativePlaceholder",
          "providerName": "India authoritative/open data placeholder",
          "sourceType": "authoritative",
          "dataMode": "unavailable",
          "regionCoverage": "India",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No India authoritative/open geotechnical, flood, cadastral, seismic, or environmental adapter is implemented in this build."
        }
      ]
    },
    {
      "id": "demo-site-c",
      "label": "Site C - Aravalli fringe, south Gurugram",
      "note": "Rising ground near the Aravalli ridge",
      "location": {
        "lat": 28.3705,
        "lng": 77.1075,
        "address": "Site C - Aravalli fringe, south Gurugram",
        "radiusMeters": 900,
        "boundary": [],
        "coordinateInput": "28.3705, 77.1075",
        "coordinateFormat": "decimal"
      },
      "dataMode": "live",
      "confidence": 0.43,
      "overallRiskScore": 23,
      "overallSuitabilityScore": 74,
      "riskBand": {
        "label": "Low",
        "description": "No major screening-level indicators dominate, but professional verification is still required."
      },
      "minimumLiveDataPackage": {
        "satisfied": true,
        "hasRealElevationOrTerrainProvider": true,
        "hasRealMapInfrastructureContextProvider": true,
        "noMockProviderUsedInScore": true,
        "missing": []
      },
      "unavailableScores": [
        "floodContextIndicator"
      ],
      "redFlags": [
        "Data availability is limited and materially reduces confidence; unsupported indicators are not scored."
      ],
      "positiveIndicators": [
        "Slope/terrain indicator is not dominant in this preliminary screen.",
        "Mapped drainage/water proximity indicator is not dominant in this preliminary screen.",
        "Mapped road/access context appears favorable at screening level, subject to official verification.",
        "Minimum live-data package is present for a preliminary live-data screening workflow."
      ],
      "subScores": {
        "slopeTerrainRisk": {
          "scoreId": "slopeTerrainRisk",
          "scoreName": "Slope/terrain risk",
          "available": true,
          "score": 9,
          "confidence": 0.58,
          "formula": "meanSlopeDegrees * 3.4 + maxSlopeDegrees * 1.3 + slopeVariance * 1.1, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "meanSlopeDegrees": 1.2,
            "maxSlopeDegrees": 2.4,
            "slopeVariance": 1.2
          },
          "providerSources": [
            "Open-Meteo elevation API"
          ],
          "limitations": [
            "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
          ],
          "recommendedVerification": [
            "Parcel topographic survey",
            "Slope stability review where slopes, cuts, or retaining are material"
          ]
        },
        "elevationVariabilityRisk": {
          "scoreId": "elevationVariabilityRisk",
          "scoreName": "Elevation variability risk",
          "available": true,
          "score": 53,
          "confidence": 0.58,
          "formula": "reliefMeters * 0.55 + terrainVariabilityIndex * 45, clamped to 0-100.",
          "thresholds": {
            "low": "relief under about 35 m",
            "moderate": "35-95 m",
            "high": "above about 95 m"
          },
          "rawInputs": {
            "minElevationMeters": 244,
            "maxElevationMeters": 305,
            "meanElevationMeters": 266,
            "reliefMeters": 61,
            "terrainVariabilityIndex": 0.44,
            "resolutionLabel": "Open-Meteo elevation sampled points"
          },
          "providerSources": [
            "Open-Meteo elevation API"
          ],
          "limitations": [
            "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
          ],
          "recommendedVerification": [
            "Topographic survey",
            "Cut/fill and drainage levels review"
          ]
        },
        "drainageWaterProximityRisk": {
          "scoreId": "drainageWaterProximityRisk",
          "scoreName": "Drainage/water proximity risk",
          "available": true,
          "score": 0,
          "confidence": 0.66,
          "formula": "waterProximityRiskIndex when supplied; otherwise 100 - nearestWaterFeatureMeters / 35 + waterFeatureCount * 6, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "nearestWaterFeatureMeters": null,
            "waterFeatureCount": 0,
            "waterProximityRiskIndex": 0
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Official floodplain maps",
            "Drainage/stormwater design review",
            "Seasonal site observations"
          ]
        },
        "infrastructureAccessIndicator": {
          "scoreId": "infrastructureAccessIndicator",
          "scoreName": "Infrastructure/access indicator",
          "available": true,
          "score": 8,
          "confidence": 0.66,
          "formula": "(100 - roadAccessQualityIndex) * 0.65 + distancePenalty * 0.2 + (100 - infrastructureContextIndex) * 0.15.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "nearestRoadMeters": 666,
            "roadFeatureCount": 16,
            "utilityAmenityFeatureCount": 0,
            "roadAccessQualityIndex": 95,
            "infrastructureContextIndex": 95
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Legal access check",
            "Road classification and utility availability",
            "Easement and right-of-way review"
          ]
        },
        "landUseContextIndicator": {
          "scoreId": "landUseContextIndicator",
          "scoreName": "Land-use/context indicator",
          "available": true,
          "score": 16,
          "confidence": 0.66,
          "formula": "landUseContextIndex + industrialContextFeatureCount * 4, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "dominantClass": "urban or peri-urban",
            "landUseFeatureCount": 4,
            "industrialContextFeatureCount": 0,
            "landUseContextIndex": 16
          },
          "providerSources": [
            "OpenStreetMap Overpass context"
          ],
          "limitations": [
            "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
          ],
          "recommendedVerification": [
            "Official zoning/planning records",
            "Environmental desktop review",
            "Historical land-use review"
          ]
        },
        "floodContextIndicator": {
          "scoreId": "floodContextIndicator",
          "scoreName": "Flood context indicator",
          "available": false,
          "score": 0,
          "confidence": 0,
          "formula": "Unavailable: no real scoring dataset was returned for this indicator.",
          "thresholds": {},
          "rawInputs": {},
          "providerSources": [
            "drainageFlood unavailable"
          ],
          "limitations": [
            "No supported live flood authority provider returned data for this location."
          ],
          "recommendedVerification": [
            "Official flood authority datasets",
            "Drainage/stormwater review"
          ]
        },
        "dataAvailabilityConfidence": {
          "scoreId": "dataAvailabilityConfidence",
          "scoreName": "Data availability confidence risk",
          "available": true,
          "score": 48,
          "confidence": 0.52,
          "formula": "100 - providerAvailabilityScore.",
          "thresholds": {
            "low": "availability risk <35",
            "moderate": "35-64",
            "high": ">=65"
          },
          "rawInputs": {
            "providerAvailabilityScore": 52,
            "providerStatuses": {
              "elevationTopography": "live",
              "slope": "live",
              "drainageFlood": "unavailable",
              "nearbyWaterBodies": "live",
              "infrastructure": "live",
              "landUseContext": "live",
              "cesiumTerrain": "live",
              "mapboxVisualLayers": "unavailable",
              "geologySoil": "unavailable",
              "seismicGeology": "unavailable",
              "indiaAuthoritativePlaceholder": "unavailable"
            },
            "minimumLiveDataPackage": {
              "satisfied": true,
              "hasRealElevationOrTerrainProvider": true,
              "hasRealMapInfrastructureContextProvider": true,
              "noMockProviderUsedInScore": true,
              "missing": []
            }
          },
          "providerSources": [
            "Provider registry"
          ],
          "limitations": [
            "This is an evidence-quality indicator, not a ground-condition measurement."
          ],
          "recommendedVerification": [
            "Connect live providers",
            "Upload verified site documents",
            "Collect certified professional evidence"
          ]
        },
        "intendedUsePreliminarySuitability": {
          "scoreId": "intendedUsePreliminarySuitability",
          "scoreName": "Intended-use preliminary suitability pressure",
          "available": true,
          "score": 32,
          "confidence": 0.63,
          "formula": "physicalRiskAverage + intendedUseAdjustment + dataAvailabilityRisk * 0.22, clamped to 0-100.",
          "thresholds": {
            "low": "<45",
            "moderate": "45-74",
            "high": ">=75"
          },
          "rawInputs": {
            "intendedUse": "commercial",
            "reportDepth": "standard",
            "physicalRiskAverage": 17,
            "intendedUseAdjustment": 4,
            "dataAvailabilityRisk": 48
          },
          "providerSources": [
            "Deterministic scoring engine"
          ],
          "limitations": [
            "Depends on available provider coverage and does not include certified site investigation."
          ],
          "recommendedVerification": [
            "Professional discipline review based on intended use and local requirements"
          ]
        }
      },
      "sourceTable": [
        {
          "id": "elevationTopography",
          "providerName": "Open-Meteo elevation API",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.58,
          "citation": "https://open-meteo.com/en/docs/elevation-api",
          "attribution": "Open-Meteo elevation API; underlying DEM source attribution applies.",
          "limitations": "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
        },
        {
          "id": "slope",
          "providerName": "Open-Meteo elevation API",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.58,
          "citation": "https://open-meteo.com/en/docs/elevation-api",
          "attribution": "Open-Meteo elevation API; underlying DEM source attribution applies.",
          "limitations": "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface."
        },
        {
          "id": "drainageFlood",
          "providerName": "drainageFlood unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No supported live flood authority provider returned data for this location."
        },
        {
          "id": "nearbyWaterBodies",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "infrastructure",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "landUseContext",
          "providerName": "OpenStreetMap Overpass context",
          "sourceType": "open-data",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.66,
          "citation": "https://www.openstreetmap.org/copyright",
          "attribution": "OpenStreetMap contributors",
          "limitations": "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification."
        },
        {
          "id": "cesiumTerrain",
          "providerName": "Cesium ion world terrain",
          "sourceType": "commercial-api",
          "dataMode": "live",
          "regionCoverage": "global",
          "confidence": 0.5,
          "citation": "https://cesium.com/platform/cesium-ion/",
          "attribution": "Cesium ion",
          "limitations": "Cesium terrain is currently used for visualization metadata only in this backend; it is not treated as a scoring dataset unless terrain sampling is implemented."
        },
        {
          "id": "mapboxVisualLayers",
          "providerName": "Mapbox satellite/terrain/contour layers",
          "sourceType": "commercial-api",
          "dataMode": "unavailable",
          "regionCoverage": "global",
          "confidence": 0,
          "citation": "https://www.mapbox.com/",
          "attribution": "Mapbox attribution applies when configured.",
          "limitations": "MAPBOX_ACCESS_TOKEN is not configured; Mapbox visual layers are unavailable."
        },
        {
          "id": "geologySoil",
          "providerName": "geologySoil unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No real soil/geology provider is implemented or configured for this scan."
        },
        {
          "id": "seismicGeology",
          "providerName": "seismicGeology unavailable",
          "sourceType": "computed",
          "dataMode": "unavailable",
          "regionCoverage": "unsupported",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No real seismic/geology hazard provider is implemented for this scan."
        },
        {
          "id": "indiaAuthoritativePlaceholder",
          "providerName": "India authoritative/open data placeholder",
          "sourceType": "authoritative",
          "dataMode": "unavailable",
          "regionCoverage": "India",
          "confidence": 0,
          "citation": "",
          "attribution": "",
          "limitations": "No India authoritative/open geotechnical, flood, cadastral, seismic, or environmental adapter is implemented in this build."
        }
      ]
    }
  ]
} as const;

export type DemoSite = (typeof demoCapture.sites)[number];
