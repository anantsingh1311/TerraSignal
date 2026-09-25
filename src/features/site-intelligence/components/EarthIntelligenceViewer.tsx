import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import {
  ArcGisMapServerImageryProvider,
  buildModuleUrl,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  createWorldTerrainAsync,
  EllipsoidTerrainProvider,
  Entity,
  ImageryLayer,
  Ion,
  LabelStyle,
  Math as CesiumMath,
  TileMapServiceImageryProvider,
  VerticalOrigin,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Compass, LocateFixed, Maximize2, Minimize2, Orbit, Radar, RotateCcw } from "lucide-react";
import type { ActiveSite, GlobeLayer, SiteScreeningResult } from "../../../types";
import { buildConcentricRingRadii, clamp, offsetCoordinate } from "../utils/geoMath";
import { normalizeSiteLayer } from "../utils/siteLayers";

const hasWebGl = () => {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
};

const riskColor = (value: number) => {
  if (value >= 68) return Color.fromCssColorString("#ff6b4a");
  if (value >= 42) return Color.fromCssColorString("#f6b540");
  return Color.fromCssColorString("#37d99b");
};

const layerValue = (screening: SiteScreeningResult | null, layer: GlobeLayer) => {
  if (!screening) return 38;
  const normalized = normalizeSiteLayer(layer);
  if (normalized === "buildability") return screening.overallRiskScore;
  return screening.layerAssessments[normalized]?.value ?? screening.overallRiskScore;
};

const globalView = {
  destination: Cartesian3.fromDegrees(76, 22, 14_500_000),
  orientation: {
    heading: CesiumMath.toRadians(0),
    pitch: CesiumMath.toRadians(-90),
    roll: 0,
  },
};

const satelliteImageryUrl =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const referenceImageryUrl =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer";

const globalSatelliteUrl = `${satelliteImageryUrl}/export?${new URLSearchParams({
  bbox: "-180,-85,180,85",
  bboxSR: "4326",
  imageSR: "4326",
  size: "1200,675",
  format: "jpg",
  f: "image",
}).toString()}`;

type EarthTextureSource = HTMLCanvasElement | HTMLImageElement;

type EarthCamera = {
  latitude: number;
  longitude: number;
  zoom: number;
};

type EarthRenderQuality = "preview" | "final";
type EarthMapTransitionPhase = "idle" | "handoff" | "map";

const defaultEarthCamera: EarthCamera = {
  latitude: 12,
  longitude: 24,
  zoom: 0.98,
};

const naturalEarthTileLevel = 2;
const naturalEarthTileColumns = 8;
const naturalEarthTileRows = 4;
const naturalEarthTileSize = 256;
const polarCircleLatitude = 66.563;
const earthToMapTransitionMs = 520;

const wrapLongitude = (longitude: number) => ((longitude + 540) % 360) - 180;

const shortestLongitudeDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;

const easeInOutCubic = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

const cesiumStaticAssetUrl = (assetPath: string) =>
  import.meta.env.DEV ? `/node_modules/cesium/Build/Cesium/${assetPath}` : buildModuleUrl(assetPath);

const loadEarthImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load Earth texture: ${src}`));
    image.src = src;
  });

const siteMapImageCache = new Map<string, Promise<HTMLImageElement>>();

const preloadMapImage = async (src: string) => {
  const cachedImage = siteMapImageCache.get(src) ?? loadEarthImage(src);
  siteMapImageCache.set(src, cachedImage);
  const image = await cachedImage;
  if (image.decode) {
    await image.decode().catch(() => undefined);
  }
  return image;
};

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });

const buildNaturalEarthTexture = async () => {
  const atlas = document.createElement("canvas");
  atlas.width = naturalEarthTileColumns * naturalEarthTileSize;
  atlas.height = naturalEarthTileRows * naturalEarthTileSize;

  const context = atlas.getContext("2d");
  if (!context) throw new Error("Unable to prepare Earth texture canvas.");

  context.fillStyle = "#123b52";
  context.fillRect(0, 0, atlas.width, atlas.height);

  const tileRequests = [];
  for (let tileX = 0; tileX < naturalEarthTileColumns; tileX += 1) {
    for (let tileY = 0; tileY < naturalEarthTileRows; tileY += 1) {
      tileRequests.push(
        loadEarthImage(
          cesiumStaticAssetUrl(`Assets/Textures/NaturalEarthII/${naturalEarthTileLevel}/${tileX}/${tileY}.jpg`),
        ).then((image) => {
          const atlasY = (naturalEarthTileRows - 1 - tileY) * naturalEarthTileSize;
          context.drawImage(image, tileX * naturalEarthTileSize, atlasY, naturalEarthTileSize, naturalEarthTileSize);
        }),
      );
    }
  }

  await Promise.all(tileRequests);
  return atlas;
};

const staticSatelliteUrl = (site: ActiveSite) => {
  const latitudeSpan = clamp(site.radiusMeters / 50_000, 0.016, 0.135);
  const longitudeSpan = clamp(
    site.radiusMeters / (50_000 * Math.max(0.28, Math.cos(CesiumMath.toRadians(site.latitude)))),
    0.016,
    0.135,
  );
  const west = site.longitude - longitudeSpan;
  const south = site.latitude - latitudeSpan;
  const east = site.longitude + longitudeSpan;
  const north = site.latitude + latitudeSpan;
  const params = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: "4326",
    imageSR: "4326",
    size: "1100,700",
    format: "jpg",
    f: "image",
  });
  return `${satelliteImageryUrl}/export?${params.toString()}`;
};

const seededWave = (value: number) => Math.sin(value) * 0.5 + Math.cos(value * 0.43) * 0.5;

const buildTopographicHeight = (
  x: number,
  y: number,
  site: ActiveSite,
  screening: SiteScreeningResult | null,
) => {
  const terrainRisk = screening?.terrainSlopeRisk ?? 38;
  const elevationRisk = screening?.layerAssessments.elevationRisk?.value ?? screening?.slopeRisk ?? 34;
  const wetness = screening?.vegetationWetnessProxy ?? screening?.drainageWaterloggingRisk ?? 32;
  const seed = site.latitude * 0.73 + site.longitude * 0.41;
  const radiusFactor = clamp(site.radiusMeters / 850, 0.62, 2.6);
  const baseElevation = 94 + Math.abs(site.latitude) * 4.2 + seededWave(site.longitude * 0.17) * 52;
  const relief = clamp(14 + terrainRisk * 0.82 + elevationRisk * 0.32 + radiusFactor * 9, 18, 118);
  const ridge =
    Math.sin((x * 2.7 + seed * 0.08) * Math.PI) * 0.22 +
    Math.cos((y * 3.1 - seed * 0.05) * Math.PI) * 0.18 +
    Math.sin((x + y) * 4.8 + seed) * 0.12;
  const macroSlope =
    x * Math.sin(seed * 0.3) * 0.42 +
    y * Math.cos(seed * 0.27) * 0.34 +
    Math.hypot(x * 0.8, y * 0.65) * 0.16;
  const drainageCut = Math.exp(-Math.abs(y + Math.sin(x * 2.6 + seed) * 0.18) * 5.1) * (wetness / 100) * 0.24;

  return baseElevation + relief * (macroSlope + ridge - drainageCut);
};

const terrainColor = (value: number, min: number, max: number) => {
  const normalized = clamp((value - min) / Math.max(1, max - min), 0, 1);
  const stops = [
    { at: 0, color: [28, 88, 84] },
    { at: 0.3, color: [75, 128, 91] },
    { at: 0.58, color: [158, 143, 83] },
    { at: 0.8, color: [174, 122, 81] },
    { at: 1, color: [227, 217, 183] },
  ];
  const nextIndex = stops.findIndex((stop) => stop.at >= normalized);
  const upper = stops[Math.max(1, nextIndex === -1 ? stops.length - 1 : nextIndex)];
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  const mix = clamp((normalized - lower.at) / Math.max(0.001, upper.at - lower.at), 0, 1);
  const channel = (index: number) => Math.round(lower.color[index] + (upper.color[index] - lower.color[index]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

const contourSegments = (corners: number[], level: number, x: number, y: number, cellWidth: number, cellHeight: number) => {
  const points: Array<{ x: number; y: number }> = [];
  const edgePoint = (
    valueA: number,
    valueB: number,
    pointA: { x: number; y: number },
    pointB: { x: number; y: number },
  ) => {
    if ((level < Math.min(valueA, valueB) || level > Math.max(valueA, valueB)) || valueA === valueB) return;
    const amount = clamp((level - valueA) / (valueB - valueA), 0, 1);
    points.push({
      x: pointA.x + (pointB.x - pointA.x) * amount,
      y: pointA.y + (pointB.y - pointA.y) * amount,
    });
  };

  const topLeft = { x, y };
  const topRight = { x: x + cellWidth, y };
  const bottomRight = { x: x + cellWidth, y: y + cellHeight };
  const bottomLeft = { x, y: y + cellHeight };

  edgePoint(corners[0], corners[1], topLeft, topRight);
  edgePoint(corners[1], corners[2], topRight, bottomRight);
  edgePoint(corners[2], corners[3], bottomRight, bottomLeft);
  edgePoint(corners[3], corners[0], bottomLeft, topLeft);

  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
};

const drawTopographicMap = async (
  canvas: HTMLCanvasElement,
  site: ActiveSite,
  screening: SiteScreeningResult | null,
  activeLayer: GlobeLayer,
  isCancelled: () => boolean = () => false,
) => {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(bounds.width || canvas.clientWidth || 900));
  const height = Math.max(240, Math.round(bounds.height || canvas.clientHeight || 520));
  const pixelRatio = Math.max(1, Math.min(1.6, window.devicePixelRatio || 1));
  const renderWidth = Math.round(width * pixelRatio);
  const renderHeight = Math.round(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) return false;

  if (canvas.width !== renderWidth) canvas.width = renderWidth;
  if (canvas.height !== renderHeight) canvas.height = renderHeight;

  context.clearRect(0, 0, renderWidth, renderHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const normalizedLayer = normalizeSiteLayer(activeLayer);
  const isTerrainFocus = normalizedLayer === "terrainSlopeRisk" || normalizedLayer === "elevationRisk";
  const columns = 56;
  const rows = 40;
  const values: number[][] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let row = 0; row <= rows; row += 1) {
    const line: number[] = [];
    for (let column = 0; column <= columns; column += 1) {
      const x = (column / columns) * 2 - 1;
      const y = (row / rows) * 2 - 1;
      const value = buildTopographicHeight(x, y, site, screening);
      line.push(value);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    values.push(line);
  }

  await yieldToBrowser();
  if (isCancelled()) return false;

  const cellWidth = renderWidth / columns;
  const cellHeight = renderHeight / rows;
  context.globalAlpha = isTerrainFocus ? 0.76 : 0.58;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = (values[row][column] + values[row][column + 1] + values[row + 1][column] + values[row + 1][column + 1]) / 4;
      context.fillStyle = terrainColor(value, min, max);
      context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
    }
  }

  await yieldToBrowser();
  if (isCancelled()) return false;

  const shade = context.createLinearGradient(0, 0, renderWidth, renderHeight);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.22)");
  shade.addColorStop(0.42, "rgba(255, 255, 255, 0.03)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  context.globalAlpha = isTerrainFocus ? 0.78 : 0.62;
  context.fillStyle = shade;
  context.fillRect(0, 0, renderWidth, renderHeight);

  const interval = max - min > 90 ? 10 : max - min > 45 ? 5 : 2;
  const firstLevel = Math.ceil(min / interval) * interval;
  const lastLevel = Math.floor(max / interval) * interval;

  context.globalAlpha = 1;
  for (let level = firstLevel; level <= lastLevel; level += interval) {
    const isIndex = Math.round(level / interval) % 5 === 0;
    context.beginPath();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const corners = [
          values[row][column],
          values[row][column + 1],
          values[row + 1][column + 1],
          values[row + 1][column],
        ];
        const segments = contourSegments(corners, level, column * cellWidth, row * cellHeight, cellWidth, cellHeight);
        for (const [start, end] of segments) {
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
        }
      }
    }
    context.lineWidth = Math.max(isIndex ? 1.45 : 0.78, renderWidth / (isIndex ? 920 : 1540));
    context.strokeStyle = isIndex ? "rgba(247, 255, 229, 0.86)" : "rgba(213, 255, 230, 0.48)";
    context.stroke();

    if (Math.round(level / interval) % 4 === 0) {
      await yieldToBrowser();
      if (isCancelled()) return false;
    }
  }

  context.globalAlpha = 0.56;
  context.strokeStyle = "rgba(2, 7, 10, 0.62)";
  context.lineWidth = Math.max(1, renderWidth / 1200);
  for (let x = 0; x <= renderWidth; x += renderWidth / 8) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, renderHeight);
    context.stroke();
  }
  for (let y = 0; y <= renderHeight; y += renderHeight / 6) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(renderWidth, y);
    context.stroke();
  }

  context.globalAlpha = 1;
  context.fillStyle = "rgba(2, 7, 10, 0.68)";
  context.strokeStyle = "rgba(159, 255, 234, 0.68)";
  context.lineWidth = Math.max(1, renderWidth / 1000);
  const labelWidth = Math.min(renderWidth - 28 * pixelRatio, 360 * pixelRatio);
  const labelHeight = 54 * pixelRatio;
  const labelX = 14 * pixelRatio;
  const labelY = renderHeight - labelHeight - 14 * pixelRatio;
  context.beginPath();
  context.roundRect(labelX, labelY, labelWidth, labelHeight, 8 * pixelRatio);
  context.fill();
  context.stroke();

  context.fillStyle = "#f6fff9";
  context.font = `900 ${12 * pixelRatio}px Inter, sans-serif`;
  context.textBaseline = "top";
  context.fillText("AI topo A1 render", labelX + 12 * pixelRatio, labelY + 8 * pixelRatio);
  context.fillStyle = "rgba(229, 255, 244, 0.78)";
  context.font = `800 ${10.5 * pixelRatio}px Inter, sans-serif`;
  context.fillText(
    `${Math.round(min)}-${Math.round(max)} m | ${interval} m contours | ${site.radiusMeters} m radius`,
    labelX + 12 * pixelRatio,
    labelY + 29 * pixelRatio,
  );

  const arrowX = renderWidth - 42 * pixelRatio;
  const arrowY = 28 * pixelRatio;
  context.fillStyle = "rgba(2, 7, 10, 0.64)";
  context.beginPath();
  context.arc(arrowX, arrowY, 18 * pixelRatio, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#9fffea";
  context.beginPath();
  context.moveTo(arrowX, arrowY - 12 * pixelRatio);
  context.lineTo(arrowX - 7 * pixelRatio, arrowY + 7 * pixelRatio);
  context.lineTo(arrowX, arrowY + 3 * pixelRatio);
  context.lineTo(arrowX + 7 * pixelRatio, arrowY + 7 * pixelRatio);
  context.closePath();
  context.fill();
  context.font = `900 ${9 * pixelRatio}px Inter, sans-serif`;
  context.textAlign = "center";
  context.fillText("N", arrowX, arrowY + 12 * pixelRatio);
  return true;
};

const projectToEarthCanvas = (
  latitudeDegrees: number,
  longitudeDegrees: number,
  camera: EarthCamera,
  center: number,
  radius: number,
) => {
  const latitude = CesiumMath.toRadians(latitudeDegrees);
  const longitude = CesiumMath.toRadians(longitudeDegrees);
  const centerLatitude = CesiumMath.toRadians(camera.latitude);
  const centerLongitude = CesiumMath.toRadians(camera.longitude);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinCenterLatitude = Math.sin(centerLatitude);
  const cosCenterLatitude = Math.cos(centerLatitude);
  const longitudeDelta = longitude - centerLongitude;
  const visibility =
    sinCenterLatitude * sinLatitude + cosCenterLatitude * cosLatitude * Math.cos(longitudeDelta);

  return {
    visible: visibility > -0.025,
    x: center + radius * cosLatitude * Math.sin(longitudeDelta),
    y:
      center -
      radius *
        (cosCenterLatitude * sinLatitude - sinCenterLatitude * cosLatitude * Math.cos(longitudeDelta)),
  };
};

const drawLatitudeGuide = (
  context: CanvasRenderingContext2D,
  latitude: number,
  camera: EarthCamera,
  center: number,
  radius: number,
  color: string,
) => {
  context.save();
  context.beginPath();
  context.setLineDash([9, 9]);
  context.lineWidth = Math.max(1.4, radius / 260);
  context.strokeStyle = color;

  let hasStarted = false;
  for (let longitude = -180; longitude <= 180; longitude += 2.5) {
    const point = projectToEarthCanvas(latitude, longitude, camera, center, radius);
    if (!point.visible) {
      if (hasStarted) {
        context.stroke();
        context.beginPath();
        hasStarted = false;
      }
      continue;
    }

    if (!hasStarted) {
      context.moveTo(point.x, point.y);
      hasStarted = true;
    } else {
      context.lineTo(point.x, point.y);
    }
  }

  context.stroke();
  context.restore();
};

const drawGuideLabel = (
  context: CanvasRenderingContext2D,
  label: string,
  latitude: number,
  longitude: number,
  camera: EarthCamera,
  center: number,
  radius: number,
  renderSize: number,
) => {
  const point = projectToEarthCanvas(latitude, longitude, camera, center, radius);
  if (!point.visible) return;

  context.save();
  context.font = `900 ${Math.max(12, renderSize / 72)}px Inter, sans-serif`;
  context.letterSpacing = "0.08em";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = Math.max(3, renderSize / 180);
  context.strokeStyle = "rgba(2, 7, 10, 0.86)";
  context.fillStyle = "rgba(239, 250, 247, 0.9)";
  context.strokeText(label, point.x, point.y);
  context.fillText(label, point.x, point.y);
  context.restore();
};

const drawProjectedLabel = (
  context: CanvasRenderingContext2D,
  label: string,
  latitude: number,
  longitude: number,
  camera: EarthCamera,
  center: number,
  radius: number,
  renderSize: number,
  options: {
    color?: string;
    fontScale?: number;
    letterSpacing?: string;
    minZoom?: number;
    offsetY?: number;
    uppercase?: boolean;
  } = {},
) => {
  if (options.minZoom && camera.zoom < options.minZoom) return;
  const point = projectToEarthCanvas(latitude, longitude, camera, center, radius);
  if (!point.visible) return;

  context.save();
  context.font = `900 ${Math.max(10, renderSize / (options.fontScale ?? 82))}px Inter, sans-serif`;
  context.letterSpacing = options.letterSpacing ?? "0.04em";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = Math.max(2.5, renderSize / 210);
  context.strokeStyle = "rgba(2, 7, 10, 0.86)";
  context.fillStyle = options.color ?? "rgba(239, 250, 247, 0.88)";
  const y = point.y + (options.offsetY ?? 0);
  const text = options.uppercase ? label.toUpperCase() : label;
  context.strokeText(text, point.x, y);
  context.fillText(text, point.x, y);
  context.restore();
};

const drawPolarGuides = (
  context: CanvasRenderingContext2D,
  camera: EarthCamera,
  center: number,
  radius: number,
  renderSize: number,
) => {
  drawLatitudeGuide(context, polarCircleLatitude, camera, center, radius, "rgba(216, 247, 255, 0.52)");
  drawLatitudeGuide(context, -polarCircleLatitude, camera, center, radius, "rgba(216, 247, 255, 0.5)");
  drawGuideLabel(context, "ARCTIC CIRCLE", polarCircleLatitude + 2.5, camera.longitude, camera, center, radius, renderSize);
  drawGuideLabel(context, "ANTARCTICA", -76, camera.longitude + 8, camera, center, radius, renderSize);
};

const drawProjectedEarth = (
  canvas: HTMLCanvasElement,
  texture: EarthTextureSource,
  camera: EarthCamera,
  quality: EarthRenderQuality = "final",
) => {
  const size = Math.max(320, Math.min(900, Math.round(canvas.clientWidth || 640)));
  const pixelRatio = quality === "preview" ? 1 : Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const renderSize = Math.round(size * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) return;

  if (canvas.width !== renderSize) canvas.width = renderSize;
  if (canvas.height !== renderSize) canvas.height = renderSize;
  context.clearRect(0, 0, renderSize, renderSize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = quality === "preview" ? "medium" : "high";

  const center = renderSize / 2;
  const radius = renderSize * 0.45 * camera.zoom;
  const sourceWidth = texture instanceof HTMLImageElement ? texture.naturalWidth || texture.width : texture.width;
  const sourceHeight = texture instanceof HTMLImageElement ? texture.naturalHeight || texture.height : texture.height;
  const lat0 = CesiumMath.toRadians(camera.latitude);
  const lon0 = CesiumMath.toRadians(camera.longitude);
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const step =
    quality === "preview"
      ? Math.max(5, Math.round(renderSize / 145))
      : Math.max(2, Math.round(renderSize / (camera.zoom > 1.15 ? 360 : 300)));

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#0f334a";
  context.fillRect(0, 0, renderSize, renderSize);

  for (let y = center - radius; y <= center + radius; y += step) {
    for (let x = center - radius; x <= center + radius; x += step) {
      const normalizedX = (x + step / 2 - center) / radius;
      const normalizedY = -(y + step / 2 - center) / radius;
      const rho = Math.hypot(normalizedX, normalizedY);
      if (rho > 1) continue;

      const angularDistance = Math.asin(rho);
      const sinDistance = Math.sin(angularDistance);
      const cosDistance = Math.cos(angularDistance);
      const latitude =
        rho === 0
          ? lat0
          : Math.asin(cosDistance * sinLat0 + (normalizedY * sinDistance * cosLat0) / rho);
      const longitude =
        rho === 0
          ? lon0
          : lon0 +
            Math.atan2(
              normalizedX * sinDistance,
              rho * cosLat0 * cosDistance - normalizedY * sinLat0 * sinDistance,
            );

      const longitudeDegrees = ((CesiumMath.toDegrees(longitude) + 540) % 360) - 180;
      const latitudeDegrees = clamp(CesiumMath.toDegrees(latitude), -89.85, 89.85);
      const sourceX = ((longitudeDegrees + 180) / 360) * sourceWidth;
      const sourceY = ((90 - latitudeDegrees) / 180) * sourceHeight;

      context.drawImage(
        texture,
        Math.max(0, Math.min(sourceWidth - 2, sourceX)),
        Math.max(0, Math.min(sourceHeight - 2, sourceY)),
        2,
        2,
        x,
        y,
        step + 0.8,
        step + 0.8,
      );
    }
  }

  drawPolarGuides(context, camera, center, radius, renderSize);
  for (const continent of continentLabels) {
    drawProjectedLabel(context, continent.name, continent.latitude, continent.longitude, camera, center, radius, renderSize, {
      color: "rgba(247, 255, 249, 0.78)",
      fontScale: 72,
      letterSpacing: "0.08em",
      offsetY: continent.name === "Antarctica" ? 12 * pixelRatio : 0,
      uppercase: true,
    });
  }
  for (const city of cityLabels) {
    drawProjectedLabel(context, city.name, city.latitude, city.longitude, camera, center, radius, renderSize, {
      color: "rgba(159, 255, 234, 0.9)",
      fontScale: 112,
      minZoom: 1.04,
      offsetY: -8 * pixelRatio,
    });
  }
  context.restore();

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.lineWidth = Math.max(2, renderSize / 270);
  context.strokeStyle = "rgba(180, 232, 255, 0.34)";
  context.stroke();
  context.restore();
};

const continentLabels = [
  { name: "North America", latitude: 47, longitude: -102 },
  { name: "South America", latitude: -16, longitude: -59 },
  { name: "Europe", latitude: 52, longitude: 15 },
  { name: "Africa", latitude: 3, longitude: 20 },
  { name: "Asia", latitude: 36, longitude: 88 },
  { name: "Australia", latitude: -25, longitude: 134 },
  { name: "Antarctica", latitude: -78, longitude: 15 },
];

const cityLabels = [
  { name: "New York", latitude: 40.7128, longitude: -74.006 },
  { name: "Mexico City", latitude: 19.4326, longitude: -99.1332 },
  { name: "Sao Paulo", latitude: -23.5505, longitude: -46.6333 },
  { name: "London", latitude: 51.5072, longitude: -0.1276 },
  { name: "Cairo", latitude: 30.0444, longitude: 31.2357 },
  { name: "Lagos", latitude: 6.5244, longitude: 3.3792 },
  { name: "Dubai", latitude: 25.2048, longitude: 55.2708 },
  { name: "Delhi", latitude: 28.6139, longitude: 77.209 },
  { name: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
  { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
];

export function EarthIntelligenceViewer({
  activeLayer,
  activeSite,
  isMapExpanded,
  isScanning,
  onToggleMapExpanded,
  screening,
}: {
  activeLayer: GlobeLayer;
  activeSite: ActiveSite | null;
  isMapExpanded: boolean;
  isScanning: boolean;
  onToggleMapExpanded: () => void;
  screening: SiteScreeningResult | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globalEarthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const topographicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const entitiesRef = useRef<Entity[]>([]);
  const activeSiteRef = useRef<string | null>(null);
  const earthTextureRef = useRef<EarthTextureSource | null>(null);
  const earthCameraRef = useRef<EarthCamera>({ ...defaultEarthCamera });
  const earthDragRef = useRef<{
    latitude: number;
    longitude: number;
    x: number;
    y: number;
  } | null>(null);
  const earthRenderFrameRef = useRef<number | null>(null);
  const earthRenderSettleTimerRef = useRef<number | null>(null);
  const earthRenderQualityRef = useRef<EarthRenderQuality>("preview");
  const earthToMapFrameRef = useRef<number | null>(null);
  const earthToMapTimerRef = useRef<number | null>(null);
  const earthMapRevealFallbackRef = useRef<number | null>(null);
  const [globeError, setGlobeError] = useState<string | null>(() =>
    hasWebGl() ? null : "WebGL is not available in this browser. Advanced Upload Mode remains available.",
  );
  const [imageryStatus, setImageryStatus] = useState("Satellite imagery loading");
  const [isReady, setIsReady] = useState(false);
  const [isEarthDragging, setIsEarthDragging] = useState(false);
  const [mapTransitionPhase, setMapTransitionPhase] = useState<EarthMapTransitionPhase>("idle");
  const [isSiteMapImageReady, setIsSiteMapImageReady] = useState(false);
  const activeSiteId = activeSite?.id ?? null;
  const activeSiteLatitude = activeSite?.latitude ?? 0;
  const activeSiteLongitude = activeSite?.longitude ?? 0;
  const siteMapUrl = activeSite ? staticSatelliteUrl(activeSite) : "";

  const drawInteractiveEarth = useCallback(() => {
    const canvas = globalEarthCanvasRef.current;
    const texture = earthTextureRef.current;
    if (!canvas || !texture) return;
    drawProjectedEarth(canvas, texture, earthCameraRef.current, "final");
  }, []);

  const scheduleInteractiveEarth = useCallback((quality: EarthRenderQuality = "preview") => {
    earthRenderQualityRef.current =
      quality === "final" || earthRenderQualityRef.current === "final" ? "final" : "preview";

    if (earthRenderFrameRef.current !== null) return;

    earthRenderFrameRef.current = window.requestAnimationFrame(() => {
      earthRenderFrameRef.current = null;
      const canvas = globalEarthCanvasRef.current;
      const texture = earthTextureRef.current;
      if (!canvas || !texture) return;

      const renderQuality = earthRenderQualityRef.current;
      earthRenderQualityRef.current = "preview";
      drawProjectedEarth(canvas, texture, earthCameraRef.current, renderQuality);
    });
  }, []);

  const scheduleFinalEarthRender = useCallback(() => {
    if (earthRenderSettleTimerRef.current !== null) {
      window.clearTimeout(earthRenderSettleTimerRef.current);
    }
    earthRenderSettleTimerRef.current = window.setTimeout(() => {
      earthRenderSettleTimerRef.current = null;
      scheduleInteractiveEarth("final");
    }, 90);
  }, [scheduleInteractiveEarth]);

  const cancelSettledEarthRender = useCallback(() => {
    if (earthRenderSettleTimerRef.current !== null) {
      window.clearTimeout(earthRenderSettleTimerRef.current);
      earthRenderSettleTimerRef.current = null;
    }
    earthRenderQualityRef.current = "preview";
  }, []);

  const resetInteractiveEarth = useCallback(() => {
    earthCameraRef.current = { ...defaultEarthCamera };
    scheduleInteractiveEarth("final");
  }, [scheduleInteractiveEarth]);

  const focusPolarRegion = useCallback(
    (region: "arctic" | "antarctica") => {
      earthCameraRef.current =
        region === "arctic"
          ? { latitude: 64, longitude: -24, zoom: 1.08 }
          : { latitude: -66, longitude: 18, zoom: 1.1 };
      scheduleInteractiveEarth("final");
    },
    [scheduleInteractiveEarth],
  );

  const handleEarthPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      cancelSettledEarthRender();
      event.currentTarget.setPointerCapture(event.pointerId);
      earthDragRef.current = {
        latitude: earthCameraRef.current.latitude,
        longitude: earthCameraRef.current.longitude,
        x: event.clientX,
        y: event.clientY,
      };
      setIsEarthDragging(true);
    },
    [cancelSettledEarthRender],
  );

  const handleEarthPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = earthDragRef.current;
      if (!drag) return;

      const width = Math.max(320, event.currentTarget.clientWidth || 640);
      const degreesPerPixel = 170 / width / earthCameraRef.current.zoom;
      earthCameraRef.current = {
        ...earthCameraRef.current,
        latitude: clamp(drag.latitude + (event.clientY - drag.y) * degreesPerPixel, -82, 82),
        longitude: wrapLongitude(drag.longitude - (event.clientX - drag.x) * degreesPerPixel),
      };
      scheduleInteractiveEarth("preview");
    },
    [scheduleInteractiveEarth],
  );

  const handleEarthPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      earthDragRef.current = null;
      setIsEarthDragging(false);
      scheduleFinalEarthRender();
    },
    [scheduleFinalEarthRender],
  );

  const handleEarthWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      earthCameraRef.current = {
        ...earthCameraRef.current,
        zoom: clamp(earthCameraRef.current.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.74, 1.42),
      };
      scheduleInteractiveEarth("preview");
      scheduleFinalEarthRender();
    },
    [scheduleFinalEarthRender, scheduleInteractiveEarth],
  );

  useEffect(
    () => () => {
      if (earthRenderFrameRef.current !== null) {
        window.cancelAnimationFrame(earthRenderFrameRef.current);
        earthRenderFrameRef.current = null;
      }
      if (earthRenderSettleTimerRef.current !== null) {
        window.clearTimeout(earthRenderSettleTimerRef.current);
        earthRenderSettleTimerRef.current = null;
      }
      if (earthToMapFrameRef.current !== null) {
        window.cancelAnimationFrame(earthToMapFrameRef.current);
        earthToMapFrameRef.current = null;
      }
      if (earthToMapTimerRef.current !== null) {
        window.clearTimeout(earthToMapTimerRef.current);
        earthToMapTimerRef.current = null;
      }
      if (earthMapRevealFallbackRef.current !== null) {
        window.clearTimeout(earthMapRevealFallbackRef.current);
        earthMapRevealFallbackRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (earthToMapFrameRef.current !== null) {
      window.cancelAnimationFrame(earthToMapFrameRef.current);
      earthToMapFrameRef.current = null;
    }
    if (earthToMapTimerRef.current !== null) {
      window.clearTimeout(earthToMapTimerRef.current);
      earthToMapTimerRef.current = null;
    }
    if (earthMapRevealFallbackRef.current !== null) {
      window.clearTimeout(earthMapRevealFallbackRef.current);
      earthMapRevealFallbackRef.current = null;
    }

    if (!activeSiteId) {
      setMapTransitionPhase("idle");
      setIsSiteMapImageReady(false);
      return undefined;
    }

    setMapTransitionPhase("handoff");
    let isCancelled = false;
    const startedAt = performance.now();
    const startCamera = { ...earthCameraRef.current };
    const targetLatitude = clamp(activeSiteLatitude, -68, 68);
    const targetLongitude = wrapLongitude(activeSiteLongitude);
    const longitudeDelta = shortestLongitudeDelta(startCamera.longitude, targetLongitude);

    const revealMap = () => {
      if (!isCancelled) {
        setMapTransitionPhase("map");
      }
    };

    const animateHandoff = (now: number) => {
      const progress = clamp((now - startedAt) / 400, 0, 1);
      const eased = easeInOutCubic(progress);

      earthCameraRef.current = {
        latitude: startCamera.latitude + (targetLatitude - startCamera.latitude) * eased,
        longitude: wrapLongitude(startCamera.longitude + longitudeDelta * eased + 38 * progress),
        zoom: startCamera.zoom + (1.28 - startCamera.zoom) * eased,
      };
      scheduleInteractiveEarth("preview");

      if (progress < 1) {
        earthToMapFrameRef.current = window.requestAnimationFrame(animateHandoff);
      } else {
        earthToMapFrameRef.current = null;
        scheduleInteractiveEarth("final");
      }
    };

    earthToMapFrameRef.current = window.requestAnimationFrame(animateHandoff);
    earthToMapTimerRef.current = window.setTimeout(() => {
      earthToMapTimerRef.current = null;
      earthMapRevealFallbackRef.current = window.setTimeout(() => {
        earthMapRevealFallbackRef.current = null;
        revealMap();
      }, 900);

      void preloadMapImage(siteMapUrl)
        .catch(() => undefined)
        .then(() => {
          if (isCancelled) return;
          if (earthMapRevealFallbackRef.current !== null) {
            window.clearTimeout(earthMapRevealFallbackRef.current);
            earthMapRevealFallbackRef.current = null;
          }
          revealMap();
        });
    }, earthToMapTransitionMs);

    return () => {
      isCancelled = true;
      if (earthToMapFrameRef.current !== null) {
        window.cancelAnimationFrame(earthToMapFrameRef.current);
        earthToMapFrameRef.current = null;
      }
      if (earthToMapTimerRef.current !== null) {
        window.clearTimeout(earthToMapTimerRef.current);
        earthToMapTimerRef.current = null;
      }
      if (earthMapRevealFallbackRef.current !== null) {
        window.clearTimeout(earthMapRevealFallbackRef.current);
        earthMapRevealFallbackRef.current = null;
      }
    };
  }, [activeSiteId, activeSiteLatitude, activeSiteLongitude, scheduleInteractiveEarth, siteMapUrl]);

  useEffect(() => {
    const canvas = globalEarthCanvasRef.current;
    if (!canvas || mapTransitionPhase === "map") return undefined;

    let isCancelled = false;
    const drawIfReady = () => {
      if (!isCancelled) drawInteractiveEarth();
    };

    if (earthTextureRef.current) {
      drawIfReady();
    } else {
      void buildNaturalEarthTexture()
        .then((texture) => {
          if (isCancelled) return;
          earthTextureRef.current = texture;
          setImageryStatus("Interactive Earth texture + polar coverage active");
          drawInteractiveEarth();
        })
        .catch(() => {
          void loadEarthImage(globalSatelliteUrl).then((texture) => {
            if (isCancelled) return;
            earthTextureRef.current = texture;
            setImageryStatus("Interactive satellite globe active");
            drawInteractiveEarth();
          });
        });
    }

    const resizeObserver = new ResizeObserver(() => {
      drawIfReady();
    });
    resizeObserver.observe(canvas);

    return () => {
      isCancelled = true;
      resizeObserver.disconnect();
    };
  }, [drawInteractiveEarth, mapTransitionPhase]);

  useEffect(() => {
    if (!siteMapUrl) {
      setIsSiteMapImageReady(false);
      return undefined;
    }

    let isCancelled = false;
    setIsSiteMapImageReady(false);

    const loadSiteMap = async () => {
      try {
        await preloadMapImage(siteMapUrl);
        if (!isCancelled) {
          setIsSiteMapImageReady(true);
        }
      } catch {
        if (!isCancelled) {
          setIsSiteMapImageReady(true);
        }
      }
    };

    void loadSiteMap();

    return () => {
      isCancelled = true;
    };
  }, [siteMapUrl]);

  const flyToSite = useCallback((mode: "oblique" | "top" = "oblique", duration = 1.4) => {
    const viewer = viewerRef.current;
    if (!viewer || !activeSite) return;
    const height =
      mode === "top"
        ? clamp(activeSite.radiusMeters * 7.5, 1_900, 20_000)
        : clamp(activeSite.radiusMeters * 5.8, 1_350, 18_000);
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(activeSite.longitude, activeSite.latitude, height),
      orientation: {
        heading: mode === "top" ? 0 : 0.62,
        pitch: mode === "top" ? -1.5706 : -0.88,
        roll: 0,
      },
      duration,
      complete: () => {
        activeSiteRef.current = activeSite.id;
      },
    });
  }, [activeSite]);

  const resetView = () => {
    const viewer = viewerRef.current;
    resetInteractiveEarth();
    if (!viewer) return;
    activeSiteRef.current = null;
    viewer.camera.flyTo({ ...globalView, duration: 1.6 });
  };

  const rerunFlyover = () => {
    const viewer = viewerRef.current;
    if (!viewer || !activeSite) return;
    activeSiteRef.current = null;
    viewer.camera.flyTo({
      ...globalView,
      duration: 1.2,
      complete: () => window.setTimeout(() => flyToSite("oblique", 2.4), 160),
    });
  };

  useEffect(() => {
    if (!containerRef.current || globeError) return;

    try {
      Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";
      const viewer = new Viewer(containerRef.current, {
        animation: false,
        baseLayer: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        skyBox: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        timeline: false,
      });
      viewer.targetFrameRate = 30;

      viewer.scene.globe.baseColor = Color.fromCssColorString("#102d36");
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.globe.enableLighting = false;
      viewer.scene.backgroundColor = Color.BLACK;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 450;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 18_000_000;
      viewer.camera.setView(globalView);

      const fallbackLayer = ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(cesiumStaticAssetUrl("Assets/Textures/NaturalEarthII")),
      );
      fallbackLayer.brightness = 1.05;
      fallbackLayer.contrast = 1.12;
      fallbackLayer.saturation = 1.08;
      viewer.imageryLayers.add(fallbackLayer);

      const satelliteLayer = ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromUrl(satelliteImageryUrl, {
          enablePickFeatures: false,
        }),
      );
      satelliteLayer.brightness = 0.92;
      satelliteLayer.contrast = 1.08;
      satelliteLayer.saturation = 1.05;
      satelliteLayer.readyEvent.addEventListener(() => {
        fallbackLayer.show = false;
        setImageryStatus("Live satellite basemap active");
      });
      satelliteLayer.errorEvent.addEventListener(() => {
        fallbackLayer.show = true;
        setImageryStatus("Offline Earth texture active");
      });
      viewer.imageryLayers.add(satelliteLayer);

      const referenceLayer = ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromUrl(referenceImageryUrl, {
          enablePickFeatures: false,
        }),
      );
      referenceLayer.alpha = 0.9;
      referenceLayer.errorEvent.addEventListener(() => undefined);
      viewer.imageryLayers.add(referenceLayer);

      if (Ion.defaultAccessToken) {
        void createWorldTerrainAsync({
          requestVertexNormals: true,
          requestWaterMask: true,
        })
          .then((terrainProvider) => {
            if (!viewer.isDestroyed()) {
              viewer.scene.globe.terrainProvider = terrainProvider;
              setImageryStatus("Satellite imagery + 3D terrain active");
            }
          })
          .catch(() => {
            setImageryStatus("Satellite imagery active; terrain fallback");
          });
      }

      for (const continent of continentLabels) {
        viewer.entities.add({
          name: continent.name,
          position: Cartesian3.fromDegrees(continent.longitude, continent.latitude, 900_000),
          label: {
            text: continent.name,
            fillColor: Color.fromCssColorString("#f6fff9").withAlpha(0.72),
            font: "800 18px Inter, sans-serif",
            outlineColor: Color.fromCssColorString("#02070a"),
            outlineWidth: 5,
            pixelOffset: new Cartesian2(0, 0),
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.CENTER,
          },
        });
      }

      const spin = () => {
        if (!viewer.isDestroyed() && !activeSiteRef.current) {
          viewer.scene.camera.rotate(Cartesian3.UNIT_Z, -0.00014);
        }
      };
      viewer.clock.onTick.addEventListener(spin);

      viewerRef.current = viewer;
      setIsReady(true);

      return () => {
        viewer.clock.onTick.removeEventListener(spin);
        viewer.destroy();
        viewerRef.current = null;
      };
    } catch (error) {
      queueMicrotask(() => {
        setGlobeError(error instanceof Error ? error.message : "Cesium globe failed to initialize.");
      });
    }
  }, [globeError]);

  useEffect(() => {
    if (!viewerRef.current || !isReady || !activeSite) return;
    const isSameSite = activeSiteRef.current === activeSite.id;
    flyToSite("oblique", isSameSite ? 1.1 : 2.8);
  }, [activeSite, flyToSite, isReady]);

  useEffect(() => {
    const canvas = topographicCanvasRef.current;
    if (!canvas || !activeSite || mapTransitionPhase !== "map") return undefined;

    let isCancelled = false;
    let timerId: number | null = null;
    const render = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        timerId = null;
        void drawTopographicMap(canvas, activeSite, screening, activeLayer, () => isCancelled);
      }, 80);
    };

    render();
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvas);

    return () => {
      isCancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      resizeObserver.disconnect();
    };
  }, [activeLayer, activeSite, mapTransitionPhase, screening]);

  useEffect(() => {
    const refresh = () => {
      scheduleInteractiveEarth("final");
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) {
        (viewer as Viewer & { resize?: () => void }).resize?.();
        viewer.scene.requestRender();
      }
      const canvas = topographicCanvasRef.current;
      if (canvas && activeSite && mapTransitionPhase === "map") {
        void drawTopographicMap(canvas, activeSite, screening, activeLayer);
      }
    };

    refresh();
    const frameId = window.requestAnimationFrame(refresh);
    const timerId = window.setTimeout(refresh, 260);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [activeLayer, activeSite, isMapExpanded, mapTransitionPhase, scheduleInteractiveEarth, screening]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !isReady) return;

    for (const entity of entitiesRef.current) {
      viewer.entities.remove(entity);
    }
    entitiesRef.current = [];

    if (!activeSite) return;

    const cautionValue = layerValue(screening, activeLayer);
    const siteColor = riskColor(cautionValue);
    const ringRadii = buildConcentricRingRadii(activeSite.radiusMeters);

    for (const radius of ringRadii) {
      const isOuter = radius === activeSite.radiusMeters;
      const ring = viewer.entities.add({
        name: `${radius} m site radius`,
        position: Cartesian3.fromDegrees(activeSite.longitude, activeSite.latitude, 4),
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: new ColorMaterialProperty(
            Color.fromCssColorString(isOuter ? "#37d9c2" : "#9fffea").withAlpha(isOuter ? 0.16 : 0.05),
          ),
          outline: true,
          outlineColor: Color.fromCssColorString(isOuter ? "#9fffea" : "#d8fff8").withAlpha(isOuter ? 0.86 : 0.42),
        },
      });
      entitiesRef.current.push(ring);

      const labelPosition = offsetCoordinate(activeSite.latitude, activeSite.longitude, radius, 38);
      const label = viewer.entities.add({
        position: Cartesian3.fromDegrees(labelPosition.longitude, labelPosition.latitude, 18),
        label: {
          text: `${radius} m`,
          fillColor: Color.fromCssColorString("#effaf7"),
          font: "700 13px Inter, sans-serif",
          outlineColor: Color.fromCssColorString("#02070a"),
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -10),
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
        },
      });
      entitiesRef.current.push(label);
    }

    const marker = viewer.entities.add({
      name: activeSite.projectName,
      position: Cartesian3.fromDegrees(activeSite.longitude, activeSite.latitude, 24),
      point: {
        color: Color.fromCssColorString("#9fffea"),
        outlineColor: Color.fromCssColorString("#02070a"),
        outlineWidth: 3,
        pixelSize: 14,
      },
      label: {
        text: activeSite.projectName,
        fillColor: Color.fromCssColorString("#effaf7"),
        font: "800 14px Inter, sans-serif",
        outlineColor: Color.fromCssColorString("#02070a"),
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -24),
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
      },
    });
    entitiesRef.current.push(marker);

    if (screening) {
      const activeZone = viewer.entities.add({
        name: `${activeSite.projectName} ${normalizeSiteLayer(activeLayer)}`,
        position: Cartesian3.fromDegrees(activeSite.longitude, activeSite.latitude, 8),
        ellipse: {
          semiMajorAxis: activeSite.radiusMeters * clamp(cautionValue / 52, 0.42, 1.24),
          semiMinorAxis: activeSite.radiusMeters * clamp(cautionValue / 64, 0.36, 1.08),
          material: new ColorMaterialProperty(siteColor.withAlpha(0.2)),
          outline: true,
          outlineColor: siteColor.withAlpha(0.78),
        },
      });
      entitiesRef.current.push(activeZone);

      const layerConfigs = [
        { value: screening.terrainSlopeRisk, angle: 25, factor: 0.36 },
        { value: screening.drainageWaterloggingRisk, angle: 125, factor: 0.48 },
        { value: screening.waterProximityRisk, angle: 215, factor: 0.58 },
        { value: screening.soilUncertaintyRisk, angle: 310, factor: 0.42 },
        { value: screening.legalTitlePlanningRisk, angle: 72, factor: 0.64 },
      ];

      for (const config of layerConfigs) {
        const offset = offsetCoordinate(
          activeSite.latitude,
          activeSite.longitude,
          activeSite.radiusMeters * config.factor,
          config.angle,
        );
        const color = riskColor(config.value);
        const entity = viewer.entities.add({
          position: Cartesian3.fromDegrees(offset.longitude, offset.latitude, 12),
          ellipse: {
            semiMajorAxis: clamp(config.value * 3.1, 70, activeSite.radiusMeters * 0.7),
            semiMinorAxis: clamp(config.value * 2.1, 54, activeSite.radiusMeters * 0.56),
            material: new ColorMaterialProperty(color.withAlpha(0.13)),
            outline: true,
            outlineColor: color.withAlpha(0.42),
          },
        });
        entitiesRef.current.push(entity);
      }
    }
  }, [activeLayer, activeSite, isReady, screening]);

  const isMapTransitioning = Boolean(activeSite) && mapTransitionPhase !== "map";
  const showGlobalEarth = !activeSite || isMapTransitioning;
  const globeCanvasClassName = [
    "globe-canvas-wrap",
    activeSite ? "has-active-site" : "",
    isMapTransitioning ? "is-map-transition" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const globalEarthClassName = [
    "satellite-ground-plane",
    "global-earth-plane",
    isEarthDragging ? "is-dragging" : "",
    isMapTransitioning ? "is-handoff" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const siteMapClassName = [
    "satellite-ground-plane",
    "site-satellite-plane",
    isMapTransitioning ? "is-expanding" : "is-ready",
    isSiteMapImageReady ? "is-image-ready" : "is-image-loading",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={globeCanvasClassName}>
      {showGlobalEarth && (
        <div
          className={globalEarthClassName}
          aria-label="Interactive Earth globe. Drag to rotate, scroll to zoom, and use the polar shortcuts to inspect Arctic and Antarctic regions."
          role="application"
        >
          <canvas
            className="global-earth-canvas"
            onLostPointerCapture={handleEarthPointerEnd}
            onPointerCancel={handleEarthPointerEnd}
            onPointerDown={handleEarthPointerDown}
            onPointerMove={handleEarthPointerMove}
            onPointerUp={handleEarthPointerEnd}
            onWheel={handleEarthWheel}
            ref={globalEarthCanvasRef}
          />
          <span className="global-earth-glow" />
          <span className="global-earth-hint">Drag to rotate - Scroll to zoom - Polar circles included</span>
          <div className="polar-nav" aria-label="Polar map shortcuts">
            <button type="button" onClick={() => focusPolarRegion("arctic")}>
              Arctic Circle
            </button>
            <button type="button" onClick={() => focusPolarRegion("antarctica")}>
              Antarctica
            </button>
            <button type="button" onClick={resetInteractiveEarth}>
              Reset Earth
            </button>
          </div>
        </div>
      )}
      {activeSite && (
        <div className={siteMapClassName} aria-hidden="true">
          <img alt="" decoding="async" loading="eager" onLoad={() => setIsSiteMapImageReady(true)} src={siteMapUrl} />
          <canvas className="topographic-map-canvas" ref={topographicCanvasRef} />
          <span className="topographic-map-sheen" />
          <span className="satellite-map-grid" />
          <span className="satellite-radius-circle" />
          <span className="satellite-site-pin" />
          <span className="satellite-site-label">
            {screening ? `${screening.buildabilityCautionLevel} caution` : "Analyzing site"}
          </span>
        </div>
      )}
      {isMapTransitioning && (
        <div className="earth-map-transition-label" aria-hidden="true">
          <span>Rotating into site view</span>
          <strong>Expanding live 2D map</strong>
        </div>
      )}
      <div className="cesium-container" ref={containerRef} />
      {!activeSite && (
        <div className="earth-title" aria-hidden="true">
          <span>TerraSignal Earth</span>
          <strong>Coordinate Intelligence</strong>
        </div>
      )}
      <div className="earth-data-badge">
        <span>{imageryStatus}</span>
        <b>{activeSite ? `${activeSite.latitude.toFixed(5)}, ${activeSite.longitude.toFixed(5)}` : "Global Earth"}</b>
      </div>
      <div className={activeSite ? "earth-stage is-site-active" : "earth-stage"} aria-hidden="true">
        {activeSite && (
          <div className={screening ? "analysis-target has-screening" : "analysis-target is-scanning"}>
            <span className="target-ring ring-one" />
            <span className="target-ring ring-two" />
            <span className="target-core" />
            <strong>{screening ? screening.buildabilityCautionLevel : "Scanning"}</strong>
          </div>
        )}
        {(screening || isScanning) && (
          <div className="risk-layer-orbits">
            <span className="risk-orbit terrain" />
            <span className="risk-orbit drainage" />
            <span className="risk-orbit soil" />
            <span className="risk-orbit water" />
          </div>
        )}
      </div>
      <div className="compass-control" aria-hidden="true">
        <Compass size={18} />
        <span>N</span>
      </div>
      <div className="camera-controls">
        <button
          className="map-size-toggle"
          type="button"
          onClick={onToggleMapExpanded}
          title={isMapExpanded ? "Contract map" : "Expand map"}
        >
          {isMapExpanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          <span>{isMapExpanded ? "Contract" : "Expand"}</span>
        </button>
        <button type="button" onClick={resetView} title="Reset View">
          <RotateCcw size={15} aria-hidden="true" />
          <span>Reset</span>
        </button>
        <button type="button" onClick={() => flyToSite("top")} disabled={!activeSite} title="Top Down">
          <LocateFixed size={15} aria-hidden="true" />
          <span>Top Down</span>
        </button>
        <button type="button" onClick={() => flyToSite("oblique")} disabled={!activeSite} title="Oblique View">
          <Orbit size={15} aria-hidden="true" />
          <span>Oblique</span>
        </button>
        <button type="button" onClick={rerunFlyover} disabled={!activeSite} title="Re-run Flyover">
          <Radar size={15} aria-hidden="true" />
          <span>Flyover</span>
        </button>
      </div>
      {globeError && (
        <div className="globe-fallback" role="status">
          <Radar size={28} aria-hidden="true" />
          <strong>3D Earth unavailable</strong>
          <span>{globeError}</span>
        </div>
      )}
      {!globeError && !isReady && (
        <div className="globe-loading" role="status">
          <Radar size={30} aria-hidden="true" />
          <span>Initializing TerraSignal Earth</span>
        </div>
      )}
    </div>
  );
}
