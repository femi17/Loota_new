import type { Map } from "maplibre-gl";

/**
 * Adjust the base map for play: flat building outlines at every zoom (no 3D
 * blocks), larger street names, and waterways that look like water. Call after
 * the style has loaded.
 */
export function styleMapForGame(map: Map) {
  // The style draws flat buildings up to zoom 14 and 3D blocks above it: keep them flat.
  if (map.getLayer("building-3d")) map.setLayoutProperty("building-3d", "visibility", "none");
  if (map.getLayer("building")) map.setLayerZoomRange("building", 13, 24);

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
