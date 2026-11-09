/**
 * Real weather (owner, 9 Nov 2026: "How can we add weather it case it rains and all so we can apply that too"). The
 * weather of each ~10 km square (0.1°) where hunters are, from MET Norway's forecast (api.met.no: free, open to
 * commercial use, with credit). Rain and storms slow walkers and bikes as a Rain Charm does (the server makes them rain
 * effects: weather_set); fog, cloud and snow are only drawn. The game, the server and the broadcast all use these.
 */
export type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "storm" | "snow";
export type Weather = { kind: WeatherKind; heavy: boolean; temp: number | null };

/** The square a place is in (as the database's weather_cell). */
export const weatherCell = (lng: number, lat: number) => `${Math.floor(lng * 10)}_${Math.floor(lat * 10)}`;

/** What MET Norway's symbol means here ("heavyrainandthunder", "lightrainshowers_day", "fog", "partlycloudy_night"…). */
export function weatherOf(symbol: string): { kind: WeatherKind; heavy: boolean } {
  const s = symbol.toLowerCase();
  const heavy = s.startsWith("heavy");
  if (s.includes("thunder")) return { kind: "storm", heavy };
  if (s.includes("snow") || s.includes("sleet")) return { kind: "snow", heavy };
  if (s.includes("rain")) return { kind: "rain", heavy };
  if (s.includes("fog")) return { kind: "fog", heavy: false };
  if (s.startsWith("cloudy")) return { kind: "cloudy", heavy: false };
  return { kind: "clear", heavy: false }; // clear sky, fair, partly cloudy
}

export const WEATHER_ICON: Record<WeatherKind, string> = { clear: "☀️", cloudy: "☁️", fog: "🌫️", rain: "🌧️", storm: "⛈️", snow: "🌨️" };
/** At night a clear sky is a moon. */
export const weatherIcon = (w: Weather, night: boolean) => (w.kind === "clear" && night ? "🌙" : WEATHER_ICON[w.kind]);

/** How much grey skies take from the daylight (the 3D figures and the map's tint): 1 for clear. */
export function weatherDim(w: Weather | null) {
  if (!w) return 1;
  return w.kind === "storm" ? 0.6 : w.kind === "rain" ? (w.heavy ? 0.7 : 0.8) : w.kind === "fog" ? 0.8 : w.kind === "cloudy" || w.kind === "snow" ? 0.88 : 1;
}

/** "Rain", "Heavy rain", "A storm"… */
export function weatherWords(w: Weather) {
  return w.kind === "storm" ? "A storm" : w.kind === "rain" ? (w.heavy ? "Heavy rain" : "Rain") : w.kind === "snow" ? "Snow" : w.kind === "fog" ? "Fog" : w.kind === "cloudy" ? "Cloudy" : "Clear";
}

/** The credit MET Norway asks for, shown with the map's own. */
export const WEATHER_CREDIT = '<a href="https://www.met.no/en" target="_blank" rel="noopener">Weather: MET Norway</a>';
