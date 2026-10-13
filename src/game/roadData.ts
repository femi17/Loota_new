/**
 * Our own road data (design decision 13 Oct 2026): roads cut from the raw
 * OpenStreetMap extract for Nigeria by scripts/build-roads.mts and served as
 * small files, one per square of ROAD_CELL_DEG. Unlike the drawing tiles,
 * junctions are exact (roads that meet share a point id), and every road has
 * its type, name and bridge / tunnel / one-way details.
 *
 * Shared by the build script (Node) and the game (browser).
 */

/** Size of one road square, in degrees (~5.5 km): few enough files to host, small enough to load (a busy Lagos square is ~150 KB). */
export const ROAD_CELL_DEG = 0.05;

/**
 * Which build the game reads: the OpenStreetMap extract date. A monthly rebuild is
 * uploaded to a new folder, then this changes to switch every player over at once.
 */
export const ROAD_DATA_VERSION = "ng-2026-10-12";

/** Road types kept, by OpenStreetMap "highway" value. Their index is stored in the files. */
export const ROAD_CLASSES = [
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
  "track",
  "pedestrian",
  "footway",
  "path",
  "steps",
  "cycleway",
  "bridleway",
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const ROAD_FLAGS = { bridge: 1, tunnel: 2, oneway: 4, onewayBackwards: 8, private: 16 } as const;

/** The square a point is in. */
export function roadCellOf(lng: number, lat: number) {
  return { ix: Math.floor(lng / ROAD_CELL_DEG), iy: Math.floor(lat / ROAD_CELL_DEG) };
}
export const roadCellKey = (ix: number, iy: number) => `${ix}_${iy}`;

/**
 * One square's file. Point ids and coordinates are delta-encoded (each value
 * is the difference from the previous one) so the numbers stay small and
 * compress well; coordinates are in millionths of a degree.
 */
export type RoadCellFile = {
  v: 1;
  /** Point ids, sorted, delta-encoded. */
  ids: number[];
  /** Longitudes and latitudes ×1e6, delta-encoded, in the same order as `ids`. */
  lng: number[];
  lat: number[];
  names: string[];
  /** [class index, name index or −1, flags, point indices into `ids`] */
  ways: [number, number, number, number[]][];
};

export type RoadCellData = {
  points: { id: number; lng: number; lat: number }[];
  ways: { cls: RoadClass; name: string | null; flags: number; points: number[] /* point ids */ }[];
};

export function decodeRoadCell(file: RoadCellFile): RoadCellData {
  const points: RoadCellData["points"] = [];
  let id = 0;
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < file.ids.length; i++) {
    id += file.ids[i];
    lng += file.lng[i];
    lat += file.lat[i];
    points.push({ id, lng: lng / 1e6, lat: lat / 1e6 });
  }
  const ways = file.ways.map(([cls, name, flags, idx]) => ({
    cls: ROAD_CLASSES[cls],
    name: name >= 0 ? file.names[name] : null,
    flags,
    points: idx.map((i) => points[i].id),
  }));
  return { points, ways };
}
