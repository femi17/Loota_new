import type { ExpressionSpecification, Map } from "maplibre-gl";

/** How tall buildings are drawn: their mapped height, capped at about four storeys so they never hide the hunter for long. */
const BUILDING_HEIGHT: ExpressionSpecification = ["min", ["coalesce", ["get", "render_height"], 6], 14];

/** One of six looks per building, picked from its id so neighbours differ but each stays the same. */
const PICK = ["%", ["to-number", ["id"], 0], 6] as ExpressionSpecification;

/**
 * Painted walls seen across Lagos: cream, peach, sky blue, mint, butter yellow,
 * off-white. Brighter than they appear: the map shades building sides.
 */
const WALLS = [
  { wall: "#FFEBC2", glass: "#3D5468", frame: "#FFFFFF" },
  { wall: "#FFCC9E", glass: "#41505E", frame: "#FFF1E2" },
  { wall: "#BFE3FA", glass: "#2F4B63", frame: "#FFFFFF" },
  { wall: "#C8F0C2", glass: "#355247", frame: "#FFFFFF" },
  { wall: "#FFE88A", glass: "#4A4A3A", frame: "#FFFBEA" },
  { wall: "#FFFCF5", glass: "#3A4B5C", frame: "#FFFFFF" },
];

/** Corrugated-metal roofs: rust red, blue, green, aluminium, brown, terracotta. */
const ROOFS = ["#A4523A", "#476A8C", "#5F7A5C", "#9A9C9E", "#7A5A44", "#B8643C"];

/** A small seeded random generator, so each look is the same every time. */
function seeded(seed: number) {
  let x = seed * 9301 + 49297;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

const FACADE = 64; // pixels per house front (pixelRatio 2: about one storey tall on the map)

/**
 * A strip of eight different house fronts: paint, windows, shutters, a sill.
 * The map's tiles merge neighbouring buildings of the same height into one
 * shape, so variety has to live in the wall pattern itself: a long merged
 * block then reads as a row of separate houses.
 */
function facadeStrip(seed: number) {
  const rand = seeded(seed);
  const canvas = document.createElement("canvas");
  canvas.width = FACADE * 8;
  canvas.height = FACADE;
  const g = canvas.getContext("2d")!;
  for (let house = 0; house < 8; house++) {
    const look = WALLS[Math.floor(rand() * WALLS.length)];
    const x0 = house * FACADE;
    g.fillStyle = look.wall;
    g.fillRect(x0, 0, FACADE, FACADE);
    g.fillStyle = "rgba(0,0,0,0.07)"; // a line between storeys
    g.fillRect(x0, FACADE - 3, FACADE, 3);
    g.fillStyle = "rgba(0,0,0,0.12)"; // where one house meets the next
    g.fillRect(x0, 0, 2, FACADE);
    const shutters = rand() < 0.45;
    const tall = rand() < 0.5;
    const top = tall ? 12 : 18;
    const h = tall ? 34 : 24;
    for (const x of rand() < 0.3 ? [x0 + 22] : [x0 + 10, x0 + 38]) {
      g.fillStyle = look.frame;
      g.fillRect(x - 2, top - 2, 20, h + 4);
      g.fillStyle = look.glass;
      g.fillRect(x, top, 16, h);
      g.fillStyle = "rgba(255,255,255,0.18)"; // a glint on the glass
      g.fillRect(x + 2, top + 2, 4, h - 4);
      g.fillStyle = "rgba(0,0,0,0.18)"; // the sill's shadow
      g.fillRect(x - 3, top + h + 2, 22, 2);
      if (shutters) {
        g.fillStyle = ["rgba(90,60,40,0.6)", "rgba(40,90,70,0.55)", "rgba(40,60,110,0.5)"][Math.floor(rand() * 3)];
        g.fillRect(x - 7, top - 2, 5, h + 4);
        g.fillRect(x + 18, top - 2, 5, h + 4);
      }
    }
  }
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Metal roofs for the same reason: big patches in two colours per look (so a
 * merged block reads as a few separate roofs without looking like a quilt).
 */
function roofPatchwork(seed: number) {
  const rand = seeded(seed);
  const size = 256;
  const patch = 128;
  const pair = [ROOFS[seed % ROOFS.length], ROOFS[(seed * 7 + 3) % ROOFS.length]];
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  for (let y = 0; y < size; y += patch) {
    for (let x = 0; x < size; x += patch) {
      g.fillStyle = pair[rand() < 0.5 ? 0 : 1];
      g.fillRect(x, y, patch, patch);
      g.fillStyle = "rgba(255,255,255,0.08)"; // corrugation ridges
      for (let r = 4; r < patch; r += 8) g.fillRect(x, y + r, patch, 2);
      g.fillStyle = "rgba(0,0,0,0.18)"; // the edge between two roofs
      g.fillRect(x, y, patch, 2);
      g.fillRect(x, y, 2, patch);
    }
  }
  return g.getImageData(0, 0, size, size);
}

/**
 * Adjust the base map for play: 3D buildings with windows and painted walls
 * under coloured metal roofs, larger street names, and waterways that look
 * like water. Call after the style has loaded.
 */
export function styleMapForGame(map: Map) {
  if (map.getLayer("building-3d")) {
    for (let i = 0; i < 6; i++) {
      if (!map.hasImage(`loota-walls-${i}`)) map.addImage(`loota-walls-${i}`, facadeStrip(i + 1), { pixelRatio: 2 });
      if (!map.hasImage(`loota-roofs-${i}`)) map.addImage(`loota-roofs-${i}`, roofPatchwork(i + 11), { pixelRatio: 2 });
    }
    map.setLayoutProperty("building-3d", "visibility", "visible");
    map.setPaintProperty("building-3d", "fill-extrusion-height", BUILDING_HEIGHT);
    map.setPaintProperty("building-3d", "fill-extrusion-base", 0);
    map.setPaintProperty("building-3d", "fill-extrusion-pattern", ["concat", "loota-walls-", ["to-string", PICK]]);
    map.setPaintProperty("building-3d", "fill-extrusion-opacity", 1);

    // Roofs: a thin slab on top in a patchwork of roof colours, so tops don't show the window pattern.
    if (!map.getLayer("loota-roofs")) {
      map.addLayer(
        {
          id: "loota-roofs",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-extrusion-base": BUILDING_HEIGHT,
            "fill-extrusion-height": ["+", BUILDING_HEIGHT, 0.4],
            "fill-extrusion-pattern": ["concat", "loota-roofs-", ["to-string", PICK]],
            "fill-extrusion-opacity": 1,
          },
        },
        nextLayerAfter(map, "building-3d"),
      );
    }
  }

  // Streams and drainage canals: drawn thin and pale they look like footpaths,
  // so make them read as water (wider when close, a water blue unlike the route's
  // deep blue, and named along their length).
  for (const id of ["waterway_river", "waterway_other"]) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "line-color", "#6DB8EC");
    map.setPaintProperty(id, "line-width", ["interpolate", ["exponential", 1.6], ["zoom"], 13, 1, 17, 4, 20, 16, 22, 40]);
  }
  if (map.getLayer("waterway_line_label")) {
    map.setPaintProperty("waterway_line_label", "text-color", "#1D5A99");
    map.setPaintProperty("waterway_line_label", "text-halo-color", "#FFFFFF");
    map.setPaintProperty("waterway_line_label", "text-halo-width", 2);
    map.setLayoutProperty("waterway_line_label", "text-size", ["interpolate", ["linear"], ["zoom"], 14, 11, 20, 16]);
  }

  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol" || layer["source-layer"] !== "transportation_name") continue;
    map.setLayoutProperty(layer.id, "text-size", ["interpolate", ["linear"], ["zoom"], 13, 11, 17, 14, 20, 19]);
    map.setPaintProperty(layer.id, "text-color", "#2E3340");
    map.setPaintProperty(layer.id, "text-halo-color", "#FFFFFF");
    map.setPaintProperty(layer.id, "text-halo-width", 2);
  }
}

/** The id of the layer drawn just after `id` (to insert a layer straight after it). */
function nextLayerAfter(map: Map, id: string) {
  const layers = map.getStyle().layers;
  const i = layers.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < layers.length ? layers[i + 1].id : undefined;
}
