import type { Map as MapLibre } from "maplibre-gl";

/**
 * The map's credits as just the ⓘ icon (owner, 7 Nov 2026: "The openfreemap on the bottom of the page, just change it to
 * only icon removing all the letters"). MapLibre's compact credits open themselves and fold only when the map is
 * dragged, which never happens here (the camera follows the hunter), so fold them once they appear. Tapping the icon
 * still shows the credits: OpenStreetMap's licence asks for them to be reachable.
 */
export function foldAttribution(map: MapLibre) {
  const fold = () => {
    const el = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    if (!el?.classList.contains("maplibregl-compact")) return;
    el.classList.remove("maplibregl-compact-show");
    el.removeAttribute("open");
    map.off("styledata", fold);
    map.off("sourcedata", fold);
    map.off("idle", fold);
  };
  map.on("styledata", fold);
  map.on("sourcedata", fold);
  map.on("idle", fold);
}
