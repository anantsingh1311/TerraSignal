import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArcGisMapServerImageryProvider,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  createWorldTerrainAsync,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  LabelStyle,
  Math as CesiumMath,
  HeadingPitchRange,
  PolygonHierarchy,
  TileMapServiceImageryProvider,
  VerticalOrigin,
  Viewer,
  type Entity,
  type TerrainProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  Layers,
  Map,
  MapPinned,
  Maximize2,
  Minimize2,
  Mountain,
  Radar,
  RotateCcw,
  Route,
  Satellite,
  Waves,
  Warehouse,
} from "lucide-react";
import type { ExplainableLandScan, ScanInput } from "./productTypes";

export type PremiumGeoExperienceProps = {
  scan?: ExplainableLandScan | null;
  input?: ScanInput | null;
  isScanning?: boolean;
  compact?: boolean;
  title?: string;
};

type UtilityLayer = "satellite" | "labels" | "terrain" | "contours" | "slope" | "drainage" | "roads" | "landuse";

const utilityLayers: Array<{ id: UtilityLayer; label: string; icon: typeof Map }> = [
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "labels", label: "Labels", icon: MapPinned },
  { id: "terrain", label: "Terrain", icon: Mountain },
  { id: "contours", label: "Contours", icon: Layers },
  { id: "slope", label: "Slope", icon: Radar },
  { id: "drainage", label: "Water", icon: Waves },
  { id: "roads", label: "Roads", icon: Route },
  { id: "landuse", label: "Land use", icon: Warehouse },
];

const loadingSteps = [
  "Locating region",
  "Sampling elevation",
  "Checking terrain indicators",
  "Evaluating data availability",
  "Generating AI analysis",
  "Preparing report",
];

const satelliteImageryUrl = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
const referenceImageryUrl = "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer";
const transportationImageryUrl = "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer";
const earthBoundingSphere = new BoundingSphere(Cartesian3.ZERO, 6_378_137);
const earthGlobalOffset = new HeadingPitchRange(CesiumMath.toRadians(0), CesiumMath.toRadians(-22), 24_000_000);
const cesiumBaseUrl = import.meta.env.DEV
  ? "/node_modules/cesium/Build/Cesium/"
  : "/cesiumStatic/node_modules/cesium/Build/Cesium/";

if (typeof window !== "undefined") {
  (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = cesiumBaseUrl;
}

const flyToGlobalEarth = (viewer: Viewer, duration = 1.4) => {
  viewer.camera.flyToBoundingSphere(earthBoundingSphere, {
    duration,
    offset: earthGlobalOffset,
  });
};

const cesiumStaticAssetUrl = (assetPath: string) => `${cesiumBaseUrl}${assetPath}`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const providerWithTimeout = async <T,>(source: Promise<T> | T, label: string, timeoutMs = 9000) => {
  let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(source),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

const offsetCoordinate = (lat: number, lng: number, eastMeters: number, northMeters: number) => {
  const latOffset = northMeters / 111_320;
  const lngOffset = eastMeters / (111_320 * Math.max(0.18, Math.cos(CesiumMath.toRadians(lat))));
  return { lat: lat + latOffset, lng: lng + lngOffset };
};

const targetFrom = (scan?: ExplainableLandScan | null, input?: ScanInput | null) => {
  if (scan) {
    return {
      id: scan.scanId,
      lat: scan.location.lat,
      lng: scan.location.lng,
      radiusMeters: scan.location.radiusMeters,
      boundary: scan.location.boundary || [],
      label: scan.location.address || `${scan.location.lat.toFixed(5)}, ${scan.location.lng.toFixed(5)}`,
      dataMode: scan.dataMode,
      readiness: scan.reportReadiness,
      intendedUse: scan.intendedUse,
      riskScore: scan.overallRiskScore,
      confidence: scan.confidence,
    };
  }
  if (input && input.latitude !== "" && input.longitude !== "") {
    const lat = Number(input.latitude);
    const lng = Number(input.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        id: `${lat.toFixed(5)}-${lng.toFixed(5)}-${input.radiusMeters}`,
        lat,
        lng,
        radiusMeters: input.radiusMeters,
        boundary: input.boundary || [],
        label: input.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        dataMode: input.scanMode || "live",
        readiness: input.scanMode === "internalDemo" ? "internalDemo" : "provider scan",
        intendedUse: input.intendedUse,
        riskScore: null,
        confidence: null,
      };
    }
  }
  return null;
};

const ringMaterial = (color: string, alpha: number) => new ColorMaterialProperty(Color.fromCssColorString(color).withAlpha(alpha));

const globalPlaceLabels: Array<{ name: string; lat: number; lng: number; type: "city" | "continent" }> = [];

export function PremiumGeoExperience({
  scan,
  input,
  isScanning = false,
  compact = false,
  title = "TerraSignal Earth",
}: PremiumGeoExperienceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const targetRef = useRef<string | null>(null);
  const satelliteLayerRef = useRef<ImageryLayer | null>(null);
  const referenceLayerRef = useRef<ImageryLayer | null>(null);
  const transportationLayerRef = useRef<ImageryLayer | null>(null);
  const terrainProviderRef = useRef<TerrainProvider | null>(null);
  const ellipsoidTerrainProviderRef = useRef(new EllipsoidTerrainProvider());
  const overlayEntitiesRef = useRef<Entity[]>([]);
  const globalLabelEntitiesRef = useRef<Entity[]>([]);
  const activeLayersRef = useRef<UtilityLayer[]>([]);
  const flyQualityTimerRef = useRef<number | null>(null);
  const flySignatureRef = useRef<string | null>(null);
  const fallbackReasonsRef = useRef<Set<string>>(new Set());
  const [activeLayers, setActiveLayers] = useState<UtilityLayer[]>(["satellite", "contours", "drainage", "landuse"]);
  const [stepIndex, setStepIndex] = useState(0);
  const [viewerStatus, setViewerStatus] = useState("Initializing map");
  const [providerWarning, setProviderWarning] = useState("");
  const [globeError, setGlobeError] = useState("");
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isFlying, setIsFlying] = useState(false);
  const [flyoverNonce, setFlyoverNonce] = useState(0);
  const target = useMemo(() => targetFrom(scan, input), [scan, input]);
  const [displayTarget, setDisplayTarget] = useState(target);
  const mapStatusText = providerWarning || (isFlying ? "Flying to target" : viewerStatus === "Initializing map" ? viewerStatus : "");
  const mapPropertyRows = displayTarget
    ? [
        ["Coordinates", `${displayTarget.lat.toFixed(6)}, ${displayTarget.lng.toFixed(6)}`],
        ["Radius", `${displayTarget.radiusMeters} m`],
        ["Use", displayTarget.intendedUse],
        ["Status", String(displayTarget.readiness).replace(/([a-z])([A-Z])/g, "$1 $2")],
      ]
    : [];
  const updateFallbackReason = useCallback((reason: string, active: boolean) => {
    const nextReasons = new Set(fallbackReasonsRef.current);
    if (active) {
      nextReasons.add(reason);
    } else {
      nextReasons.delete(reason);
    }
    fallbackReasonsRef.current = nextReasons;
    setProviderWarning(nextReasons.size ? "Map data unavailable / fallback active" : "");
  }, []);

  useEffect(() => {
    activeLayersRef.current = activeLayers;
  }, [activeLayers]);

  useEffect(() => {
    document.body.classList.toggle("geo-map-expanded-open", isMapExpanded);
    return () => document.body.classList.remove("geo-map-expanded-open");
  }, [isMapExpanded]);

  useEffect(() => {
    const debounceMs = target ? 220 : 0;
    const id = window.setTimeout(() => setDisplayTarget(target), debounceMs);
    return () => window.clearTimeout(id);
  }, [target]);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current || globeError) return undefined;
    try {
      Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || "";
      if (!Ion.defaultAccessToken) {
        console.warn("Cesium Ion token is not configured; using ellipsoid terrain fallback.");
      }
      const viewer = new Viewer(containerRef.current, {
        animation: false,
        baseLayer: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        requestRenderMode: true,
        maximumRenderTimeChange: 0.5,
        sceneModePicker: false,
        scene3DOnly: true,
        selectionIndicator: false,
        shouldAnimate: true,
        terrainProvider: ellipsoidTerrainProviderRef.current,
        timeline: false,
        useBrowserRecommendedResolution: true,
        contextOptions: {
          webgl: {
            alpha: false,
            antialias: true,
            powerPreference: "high-performance",
          },
        },
      });

      viewer.targetFrameRate = 45;
      viewer.resolutionScale = Math.min(1.25, Math.max(0.85, window.devicePixelRatio || 1));
      viewer.scene.globe.baseColor = Color.fromCssColorString("#0b2738");
      viewer.scene.globe.maximumScreenSpaceError = 2.7;
      viewer.scene.globe.tileCacheSize = 420;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.globe.enableLighting = false;
      viewer.scene.backgroundColor = Color.fromCssColorString("#02070c");
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.00012;
      viewer.scene.postProcessStages.fxaa.enabled = true;
      viewer.scene.rethrowRenderErrors = false;
      viewer.scene.renderError.addEventListener(() => {
        viewer.scene.globe.terrainProvider = ellipsoidTerrainProviderRef.current;
        updateFallbackReason("render", true);
        setViewerStatus("Fallback map active");
        window.setTimeout(() => {
          containerRef.current?.querySelectorAll(".cesium-widget-errorPanel").forEach((panel) => panel.remove());
        }, 0);
        viewer.scene.requestRender();
      });
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 350;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 22_000_000;
      viewer.scene.screenSpaceCameraController.inertiaSpin = 0.72;
      viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.72;
      viewer.scene.screenSpaceCameraController.inertiaZoom = 0.66;
      flyToGlobalEarth(viewer, 0);

      globalLabelEntitiesRef.current = globalPlaceLabels.map((place) => {
        const isCity = place.type === "city";
        return viewer.entities.add({
          name: place.name,
          position: Cartesian3.fromDegrees(place.lng, place.lat, isCity ? 260_000 : 760_000),
          label: {
            text: isCity ? place.name : place.name.toUpperCase(),
            fillColor: Color.fromCssColorString(isCity ? "#9fffea" : "#f6fff9").withAlpha(isCity ? 0.9 : 0.74),
            font: isCity ? "800 13px Inter, sans-serif" : "900 17px Inter, sans-serif",
            outlineColor: Color.fromCssColorString("#02070a"),
            outlineWidth: isCity ? 3 : 5,
            pixelOffset: new Cartesian2(0, isCity ? -8 : 0),
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: isCity
              ? new DistanceDisplayCondition(0, 7_200_000)
              : new DistanceDisplayCondition(2_000_000, 24_000_000),
          },
        });
      });

      const fallbackLayer = ImageryLayer.fromProviderAsync(
        providerWithTimeout(
          TileMapServiceImageryProvider.fromUrl(cesiumStaticAssetUrl("Assets/Textures/NaturalEarthII")),
          "Offline map texture",
          7000,
        ),
      );
      fallbackLayer.brightness = 1.02;
      fallbackLayer.contrast = 1.12;
      fallbackLayer.saturation = 1.05;
      fallbackLayer.errorEvent.addEventListener(() => {
        updateFallbackReason("offline-texture", true);
      });
      viewer.imageryLayers.add(fallbackLayer);

      const satelliteLayer = ImageryLayer.fromProviderAsync(
        providerWithTimeout(
          ArcGisMapServerImageryProvider.fromUrl(satelliteImageryUrl, { enablePickFeatures: false }),
          "Satellite imagery",
          10000,
        ),
      );
      satelliteLayer.brightness = 0.92;
      satelliteLayer.contrast = 1.08;
      satelliteLayer.saturation = 1.05;
      satelliteLayer.readyEvent.addEventListener(() => {
        fallbackLayer.show = false;
        updateFallbackReason("offline-texture", false);
        updateFallbackReason("satellite", false);
        setViewerStatus("Satellite basemap active");
      });
      satelliteLayer.errorEvent.addEventListener(() => {
        fallbackLayer.show = true;
        satelliteLayer.show = false;
        updateFallbackReason("satellite", true);
        setViewerStatus("Fallback map active");
      });
      viewer.imageryLayers.add(satelliteLayer);
      satelliteLayerRef.current = satelliteLayer;

      const referenceLayer = ImageryLayer.fromProviderAsync(
        providerWithTimeout(
          ArcGisMapServerImageryProvider.fromUrl(referenceImageryUrl, { enablePickFeatures: false }),
          "Reference labels",
          9000,
        ),
      );
      referenceLayer.alpha = 0.88;
      referenceLayer.show = activeLayersRef.current.includes("labels");
      referenceLayer.errorEvent.addEventListener(() => {
        referenceLayer.show = false;
        if (activeLayersRef.current.includes("labels")) updateFallbackReason("labels", true);
      });
      viewer.imageryLayers.add(referenceLayer);
      referenceLayerRef.current = referenceLayer;

      const transportationLayer = ImageryLayer.fromProviderAsync(
        providerWithTimeout(
          ArcGisMapServerImageryProvider.fromUrl(transportationImageryUrl, { enablePickFeatures: false }),
          "Road overlay",
          9000,
        ),
      );
      transportationLayer.alpha = 0.65;
      transportationLayer.show = activeLayersRef.current.includes("roads");
      transportationLayer.errorEvent.addEventListener(() => {
        transportationLayer.show = false;
        if (activeLayersRef.current.includes("roads")) updateFallbackReason("roads", true);
      });
      viewer.imageryLayers.add(transportationLayer);
      transportationLayerRef.current = transportationLayer;

      if (Ion.defaultAccessToken) {
        void providerWithTimeout(createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true }), "Cesium terrain", 12000)
          .then((terrainProvider) => {
            if (!viewer.isDestroyed()) {
              terrainProviderRef.current = terrainProvider;
              if (activeLayersRef.current.includes("terrain")) viewer.scene.globe.terrainProvider = terrainProvider;
              setViewerStatus("Satellite basemap active; terrain available");
              viewer.scene.requestRender();
            }
          })
          .catch(() => {
            if (activeLayersRef.current.includes("terrain")) {
              updateFallbackReason("terrain", true);
            }
            setViewerStatus("Satellite basemap active; terrain fallback");
          });
      } else {
        window.queueMicrotask(() => setViewerStatus("Satellite basemap active; terrain fallback"));
      }

      let lastSpinMs = 0;
      const spin = () => {
        const nowMs = performance.now();
        if (!viewer.isDestroyed() && !targetRef.current && nowMs - lastSpinMs > 36) {
          viewer.scene.camera.rotate(Cartesian3.UNIT_Z, -0.00013);
          viewer.scene.requestRender();
          lastSpinMs = nowMs;
        }
      };
      viewer.clock.onTick.addEventListener(spin);
      viewerRef.current = viewer;

      return () => {
        if (flyQualityTimerRef.current) window.clearTimeout(flyQualityTimerRef.current);
        viewer.clock.onTick.removeEventListener(spin);
        viewer.destroy();
        viewerRef.current = null;
      };
    } catch (error) {
      window.queueMicrotask(() =>
        setGlobeError(error instanceof Error ? error.message : "Cesium globe failed to initialize."),
      );
      return undefined;
    }
  }, [globeError, updateFallbackReason]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const container = containerRef.current;
    if (!viewer || !container) return undefined;

    const refresh = () => {
      if (viewer.isDestroyed()) return;
      (viewer as Viewer & { resize?: () => void }).resize?.();
      viewer.scene.requestRender();
    };

    refresh();
    const frameId = window.requestAnimationFrame(refresh);
    const timerId = window.setTimeout(refresh, 260);
    const resizeObserver = new ResizeObserver(refresh);
    resizeObserver.observe(container);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
      resizeObserver.disconnect();
    };
  }, [compact, displayTarget, isMapExpanded]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (satelliteLayerRef.current) satelliteLayerRef.current.show = activeLayers.includes("satellite");
    if (referenceLayerRef.current) referenceLayerRef.current.show = activeLayers.includes("labels");
    if (transportationLayerRef.current) transportationLayerRef.current.show = activeLayers.includes("roads");
    if (!activeLayers.includes("labels")) updateFallbackReason("labels", false);
    if (!activeLayers.includes("roads")) updateFallbackReason("roads", false);
    for (const entity of globalLabelEntitiesRef.current) entity.show = activeLayers.includes("labels");
    if (activeLayers.includes("terrain") && terrainProviderRef.current) {
      viewer.scene.globe.terrainProvider = terrainProviderRef.current;
      updateFallbackReason("terrain", false);
    } else {
      viewer.scene.globe.terrainProvider = ellipsoidTerrainProviderRef.current;
      if (activeLayers.includes("terrain")) {
        updateFallbackReason("terrain", true);
        setViewerStatus("Terrain fallback active");
      } else {
        updateFallbackReason("terrain", false);
      }
    }
    viewer.scene.requestRender();
  }, [activeLayers, updateFallbackReason]);

  useEffect(() => {
    if (!isScanning) {
      const id = window.setTimeout(() => setStepIndex(0), 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setInterval(() => setStepIndex((value) => Math.min(loadingSteps.length - 1, value + 1)), 760);
    return () => window.clearInterval(id);
  }, [isScanning]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const entity of overlayEntitiesRef.current) viewer.entities.remove(entity);
    overlayEntitiesRef.current = [];

    if (!displayTarget) {
      const hadTarget = targetRef.current !== null;
      targetRef.current = null;
      flySignatureRef.current = null;
      if (hadTarget) {
        viewer.camera.cancelFlight();
        flyToGlobalEarth(viewer, 1.4);
      }
      viewer.scene.requestRender();
      return;
    }

    const previousTargetId = targetRef.current;
    targetRef.current = displayTarget.id;
    const radius = clamp(displayTarget.radiusMeters || 500, 25, 100_000);
    const position = Cartesian3.fromDegrees(displayTarget.lng, displayTarget.lat, 80);
    const riskColor = displayTarget.riskScore
      ? displayTarget.riskScore >= 70
        ? "#ff785f"
        : displayTarget.riskScore >= 45
          ? "#f6c44d"
          : "#47e6a4"
      : "#78ffe5";

    overlayEntitiesRef.current.push(
      viewer.entities.add({
        name: "Selected scan radius",
        position,
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: ringMaterial(riskColor, 0.13),
          outline: true,
          outlineColor: Color.fromCssColorString(riskColor).withAlpha(0.9),
          height: 0,
        },
      }),
    );

    overlayEntitiesRef.current.push(
      viewer.entities.add({
        name: "Scan target label",
        position: Cartesian3.fromDegrees(displayTarget.lng, displayTarget.lat, 120),
        point: {
          color: Color.WHITE,
          outlineColor: Color.fromCssColorString("#061017"),
          outlineWidth: 3,
          pixelSize: 10,
        },
        label: {
          text: "Scan target",
          fillColor: Color.fromCssColorString("#f6fff9"),
          font: "800 15px Inter, sans-serif",
          outlineColor: Color.fromCssColorString("#02070a"),
          outlineWidth: 4,
          pixelOffset: new Cartesian2(0, -24),
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
        },
      }),
    );

    if (displayTarget.boundary.length > 2) {
      overlayEntitiesRef.current.push(
        viewer.entities.add({
          name: "Submitted polygon boundary",
          polygon: {
            hierarchy: new PolygonHierarchy(
              displayTarget.boundary.map((point) => Cartesian3.fromDegrees(point.lng, point.lat, 5)),
            ),
            material: ringMaterial("#f6c44d", 0.18),
            outline: true,
            outlineColor: Color.fromCssColorString("#f6c44d"),
          },
        }),
      );
    }

    if (activeLayers.includes("contours")) {
      [0.28, 0.48, 0.68, 0.88].forEach((scale, index) => {
        overlayEntitiesRef.current.push(
          viewer.entities.add({
            name: `Computed contour overlay ${index + 1}`,
            position,
            ellipse: {
              semiMajorAxis: radius * scale,
              semiMinorAxis: radius * scale * (0.82 + index * 0.03),
              material: ringMaterial("#ffffff", 0),
              outline: true,
              outlineColor: Color.fromCssColorString("#dfffea").withAlpha(0.34),
            },
          }),
        );
      });
    }

    if (activeLayers.includes("slope")) {
      const slopePoint = offsetCoordinate(displayTarget.lat, displayTarget.lng, radius * 0.28, radius * 0.18);
      overlayEntitiesRef.current.push(
        viewer.entities.add({
          name: "Computed slope visualization overlay",
          position: Cartesian3.fromDegrees(slopePoint.lng, slopePoint.lat, 18),
          ellipse: {
            semiMajorAxis: radius * 0.42,
            semiMinorAxis: radius * 0.24,
            material: ringMaterial("#ff8f4f", 0.18),
            outline: true,
            outlineColor: Color.fromCssColorString("#ffb36b").withAlpha(0.5),
          },
        }),
      );
    }

    if (activeLayers.includes("drainage")) {
      [-0.42, 0, 0.42].forEach((offset, index) => {
        const start = offsetCoordinate(displayTarget.lat, displayTarget.lng, -radius * 0.95, radius * offset);
        const mid = offsetCoordinate(displayTarget.lat, displayTarget.lng, 0, radius * (offset + 0.12));
        const end = offsetCoordinate(displayTarget.lat, displayTarget.lng, radius * 0.95, radius * (offset - 0.08));
        overlayEntitiesRef.current.push(
          viewer.entities.add({
            name: `Water/drainage context overlay ${index + 1}`,
            polyline: {
              positions: Cartesian3.fromDegreesArray([start.lng, start.lat, mid.lng, mid.lat, end.lng, end.lat]),
              width: 2,
              material: Color.fromCssColorString("#50c9ff").withAlpha(0.62),
            },
          }),
        );
      });
    }

    if (activeLayers.includes("roads")) {
      [
        [
          offsetCoordinate(displayTarget.lat, displayTarget.lng, -radius, -radius * 0.35),
          offsetCoordinate(displayTarget.lat, displayTarget.lng, radius, radius * 0.28),
        ],
        [
          offsetCoordinate(displayTarget.lat, displayTarget.lng, -radius * 0.36, radius),
          offsetCoordinate(displayTarget.lat, displayTarget.lng, radius * 0.42, -radius),
        ],
      ].forEach(([start, end], index) => {
        overlayEntitiesRef.current.push(
          viewer.entities.add({
            name: `Road/access context overlay ${index + 1}`,
            polyline: {
              positions: Cartesian3.fromDegreesArray([start.lng, start.lat, end.lng, end.lat]),
              width: 3,
              material: Color.fromCssColorString("#ffffff").withAlpha(0.56),
            },
          }),
        );
      });
    }

    if (activeLayers.includes("landuse")) {
      const corners = [
        offsetCoordinate(displayTarget.lat, displayTarget.lng, -radius * 0.55, -radius * 0.55),
        offsetCoordinate(displayTarget.lat, displayTarget.lng, radius * 0.55, -radius * 0.42),
        offsetCoordinate(displayTarget.lat, displayTarget.lng, radius * 0.52, radius * 0.5),
        offsetCoordinate(displayTarget.lat, displayTarget.lng, -radius * 0.45, radius * 0.48),
      ];
      overlayEntitiesRef.current.push(
        viewer.entities.add({
          name: "Land-use/context visualization overlay",
          polygon: {
            hierarchy: new PolygonHierarchy(corners.map((point) => Cartesian3.fromDegrees(point.lng, point.lat, 3))),
            material: ringMaterial("#8df0ae", 0.1),
            outline: true,
            outlineColor: Color.fromCssColorString("#8df0ae").withAlpha(0.38),
          },
        }),
      );
    }

    if (flyQualityTimerRef.current) window.clearTimeout(flyQualityTimerRef.current);
    const flySignature = `${displayTarget.id}|${radius}|${compact ? "compact" : "full"}|${flyoverNonce}`;
    if (flySignatureRef.current !== flySignature) {
      flySignatureRef.current = flySignature;
      viewer.camera.cancelFlight();
      viewer.scene.globe.maximumScreenSpaceError = compact ? 2.6 : 3;
      setIsFlying(true);
      const settleQuality = () => {
        setIsFlying(false);
        updateFallbackReason("fly", false);
        flyQualityTimerRef.current = window.setTimeout(() => {
          if (!viewer.isDestroyed()) {
            viewer.scene.globe.maximumScreenSpaceError = compact ? 1.25 : 1.45;
            viewer.scene.requestRender();
          }
        }, compact ? 360 : 700);
      };
      const destinationHeight = compact
        ? clamp(radius * 4.2, 950, 28_000)
        : clamp(radius * 8.5, 3600, 120_000);
      try {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(displayTarget.lng, displayTarget.lat, destinationHeight),
          orientation: {
            heading: compact ? 0 : CesiumMath.toRadians(18),
            pitch: compact ? CesiumMath.toRadians(-89) : CesiumMath.toRadians(-58),
            roll: 0,
          },
          duration: previousTargetId === displayTarget.id ? 0.45 : compact ? 1.35 : 2.4,
          complete: settleQuality,
          cancel: settleQuality,
        });
      } catch {
        settleQuality();
        updateFallbackReason("fly", true);
      }
    }
    viewer.scene.requestRender();
  }, [activeLayers, compact, displayTarget, flyoverNonce, updateFallbackReason]);

  const toggleLayer = (layer: UtilityLayer) => {
    setActiveLayers((current) =>
      current.includes(layer) ? current.filter((item) => item !== layer) : [...current, layer],
    );
  };

  const sectionClassName = [
    "premium-geo",
    "cesium-experience",
    compact ? "compact" : "",
    isMapExpanded ? "is-map-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={sectionClassName}>
      <div className="cesium-viewport">
        <div ref={containerRef} className="cesium-canvas" aria-label="Cesium 3D Earth globe" />
        {globeError && (
          <div className="cesium-error">
            <strong>3D globe unavailable</strong>
            <span>{globeError}</span>
          </div>
        )}
        <div className="geo-overlay-panel primary">
          <span>{title}</span>
          <strong>{displayTarget ? displayTarget.label : "Rotating global Earth"}</strong>
          <small>{viewerStatus}</small>
        </div>
        <div className="geo-overlay-panel secondary">
          <span>{displayTarget ? `${displayTarget.lat.toFixed(5)}, ${displayTarget.lng.toFixed(5)}` : "Awaiting target"}</span>
          <strong>{displayTarget ? `${displayTarget.radiusMeters} m radius` : "Global scan console"}</strong>
          <small>
            {displayTarget
              ? `${String(displayTarget.dataMode).toUpperCase()} | ${displayTarget.intendedUse}`
              : "Satellite basemap, terrain token support, provider overlays"}
          </small>
        </div>
        {displayTarget && (
          <div className="map-property-card">
            <strong>Map properties</strong>
            {mapPropertyRows.map(([label, value]) => (
              <span key={label}>
                <b>{label}</b>
                <em>{value}</em>
              </span>
            ))}
          </div>
        )}
        {mapStatusText && <div className="map-status-badge">{mapStatusText}</div>}
        {isScanning && (
          <div className="scan-sequence cesium-sequence">
            <Radar size={18} aria-hidden="true" />
            <span>{loadingSteps[stepIndex]}</span>
          </div>
        )}
        {scan?.dataMode === "mock" && <div className="mock-watermark">DEMO / MOCK DATA</div>}
      </div>
      <div className="map-action-bar" aria-label="Map view controls">
        <button type="button" onClick={() => setFlyoverNonce((value) => value + 1)} disabled={!displayTarget}>
          <RotateCcw size={15} aria-hidden="true" />
          Fly over
        </button>
        <button type="button" onClick={() => setIsMapExpanded((value) => !value)}>
          {isMapExpanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          {isMapExpanded ? "Close map" : "Maximize"}
        </button>
      </div>
      <div className="utility-layer-bar cesium-layer-bar" aria-label="Map utility layers">
        {utilityLayers.map(({ id, label, icon: Icon }) => (
          <button className={activeLayers.includes(id) ? "active" : ""} key={id} type="button" onClick={() => toggleLayer(id)}>
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="geo-meta-strip">
        <span>CesiumJS 3D Earth</span>
        <span>ArcGIS satellite imagery</span>
        <span>Cesium terrain when token is configured</span>
        <span>Reference labels and transportation overlay</span>
        <span>Computed contour/slope overlays</span>
        <span>Provider scoring stays backend-driven</span>
      </div>
    </section>
  );
}
