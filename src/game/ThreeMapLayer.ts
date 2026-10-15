import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map } from "maplibre-gl";
import * as THREE from "three";
import type { LngLat } from "./geo";

/** Something drawn on the map: a 3D object at a real latitude and longitude. */
export type MapEntity = {
  object: THREE.Object3D;
  lng: number;
  lat: number;
  /** Scene heading in radians (see geo.headingOf). */
  heading?: number;
  /** Fixed scale; otherwise the object is enlarged to stay readable at any zoom. */
  scale?: number;
  /** Multiplies the automatic enlargement (ignored when `scale` is set). */
  scaleBy?: number;
};

/**
 * A MapLibre custom layer that draws three.js objects on the real map.
 * The scene is re-anchored on a focus point every frame (usually the player),
 * so one unit is one metre around it and positions stay precise worldwide.
 */
export class ThreeMapLayer implements CustomLayerInterface {
  readonly id = "loota-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  readonly scene = new THREE.Scene();
  readonly entities = new Set<MapEntity>();
  private readonly billboards = new Set<THREE.Object3D>();
  private readonly camera = new THREE.Camera();
  private renderer?: THREE.WebGLRenderer;
  private map?: Map;

  constructor(
    private readonly getFocus: () => LngLat,
    /** Target on-screen height of an avatar, in CSS pixels. */
    private readonly avatarPx: number,
  ) {
    this.scene.add(this.sky);
    this.sun.position.set(30, 80, 20);
    this.scene.add(this.sun);
  }

  private readonly sky = new THREE.HemisphereLight(0xffffff, 0x667755, 2.2);
  private readonly sun = new THREE.DirectionalLight(0xfff2d0, 1.6);

  /** Daylight from 1 (day) to 0 (night): figures and vehicles darken at night, bluish under the moon. */
  setDaylight(light: number) {
    this.sky.intensity = 0.9 + 1.3 * light;
    this.sky.color.setRGB(0.75 + 0.25 * light, 0.8 + 0.2 * light, 1);
    this.sun.intensity = 0.25 + 1.35 * light;
    this.map?.triggerRepaint();
  }

  add(entity: MapEntity) {
    this.entities.add(entity);
    this.scene.add(entity.object);
    return entity;
  }

  remove(entity: MapEntity) {
    this.entities.delete(entity);
    this.scene.remove(entity.object);
  }

  /** Keep a flat object (such as a name tag) turned towards the camera. Its parent should be an entity's object. */
  billboard(object: THREE.Object3D) {
    this.billboards.add(object);
    return object;
  }

  /** How much to enlarge avatars so they stay about `avatarPx` tall on screen. */
  enlargement(): number {
    if (!this.map) return 1;
    const lat = this.getFocus().lat;
    const metresPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom());
    return Math.max(1, Math.min(400, (this.avatarPx * metresPerPixel) / 2.4));
  }

  onAdd(map: Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove() {
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.renderer) return;
    const focus = this.getFocus();
    const origin = MercatorCoordinate.fromLngLat([focus.lng, focus.lat], 0);
    const metre = origin.meterInMercatorCoordinateUnits();
    const enlarge = this.enlargement();

    for (const e of this.entities) {
      const m = MercatorCoordinate.fromLngLat([e.lng, e.lat], 0);
      e.object.position.set((m.x - origin.x) / metre, 0, (m.y - origin.y) / metre);
      if (e.heading !== undefined) e.object.rotation.y = e.heading;
      e.object.scale.setScalar(e.scale ?? enlarge * (e.scaleBy ?? 1));
    }

    // Face the camera: it looks along the map bearing from above at the map pitch.
    // In scene terms the camera sits at heading −bearing (see geo.headingOf).
    if (this.map && this.billboards.size) {
      const toRad = Math.PI / 180;
      const tilt = -(90 - this.map.getPitch()) * toRad;
      const towardsCamera = -this.map.getBearing() * toRad;
      for (const b of this.billboards) {
        b.rotation.set(tilt, towardsCamera - (b.parent?.rotation.y ?? 0), 0, "YXZ");
      }
    }

    // Scene metres (x east, y up, z south) -> mercator units -> clip space.
    const toMercator = new THREE.Matrix4()
      .makeTranslation(origin.x, origin.y, origin.z)
      .scale(new THREE.Vector3(metre, -metre, metre))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(options.defaultProjectionData.mainMatrix as unknown as number[])
      .multiply(toMercator);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}
