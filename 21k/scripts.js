
import loadEncoder from 'https://unpkg.com/mp4-h264@1.0.7/build/mp4-encoder.js';
import { simd } from "https://unpkg.com/wasm-feature-detect?module";

import flyInAndRotate from "./fly-in-and-rotate.js";
import animatePath from "./animate-path.js";


import { createGeoJSONCircle } from './util.js'

const urlSearchParams = new URLSearchParams(window.location.search);
const { gender, stage, square: squareQueryParam, prod: prodQueryParam } = Object.fromEntries(urlSearchParams.entries());

const prod = prodQueryParam === 'true'
const square = squareQueryParam === 'true'

if (square) {
  document.getElementById("map").style.height = '1080px';
  document.getElementById("map").style.width = '1080px';
}



window.map = map

map.on("load", async () => {
  
  // add 3d, sky and fog
  add3D();

  // don't forget to enable WebAssembly SIMD in chrome://flags for faster encoding
  const supportsSIMD = await simd();

  // initialize H264 video encoder
  const Encoder = await loadEncoder({ simd: supportsSIMD });

  const gl = map.painter.context.gl;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;

  const encoder = Encoder.create({
    width,
    height,
    fps: 30,
    kbps: 64000,
    rgbFlipY: true
  });

  // stub performance.now for deterministic rendering per-frame (only available in dev build)
  let now = performance.now();
  mapboxgl.setNow(now);

  const ptr = encoder.getRGBPointer(); // keep a pointer to encoder WebAssembly heap memory

  function frame() {
    // increment stub time by 16.6ms (60 fps)
    now += 1000 / 60;
    mapboxgl.setNow(now);

    const pixels = encoder.memory().subarray(ptr); // get a view into encoder memory
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); // read pixels into encoder
    encoder.encodeRGBPointer(); // encode the frame
  }

  map.on('render', frame); // set up frame-by-frame recording



  // fetch the geojson for the linestring to be animated
  const trackGeojson = await fetch("./rhsr-21k.geojson").then((d) =>
    d.json()
  );
  // kick off the animations
  await playAnimations(trackGeojson);
  // stop recording
  map.off('render', frame);
  mapboxgl.restoreNow();



});

const add3D = () => {
  // add map 3d terrain and sky layer and fog
  // Add some fog in the background
  map.setFog({
    range: [0.5, 10],
    color: "white",
    "horizon-blend": 0.2,
  });

  // Add a sky layer over the horizon
  map.addLayer({
    id: "sky",
    type: "sky",
    paint: {
      "sky-type": "atmosphere",
      "sky-atmosphere-color": "rgba(85, 151, 210, 0.5)",
    },
  });

  // Add terrain source, with slight exaggeration
  map.addSource("mapbox-dem", {
    type: "raster-dem",
    url: "mapbox://mapbox.terrain-rgb",
    tileSize: 512,
    maxzoom: 14,
  });
  map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
};

const playAnimations = async (trackGeojson) => {
  return new Promise(async (resolve) => {
    // add a geojson source and layer for the linestring to the map
    addPathSourceAndLayer(trackGeojson);

    // get the start of the linestring, to be used for animating a zoom-in from high altitude
    var targetLngLat = {
      lng: trackGeojson.geometry.coordinates[0][0],
      lat: trackGeojson.geometry.coordinates[0][1],
    };

    // animate zooming in to the start point, get the final bearing and altitude for use in the next animation
    const { bearing, altitude } = await flyInAndRotate({
      map,
      targetLngLat,
      duration: 5000,
      startAltitude: 2000000,
      endAltitude: 9000,
      startBearing: 0,
      endBearing: 90,
      startPitch: 40,
      endPitch: 50,
    });

    // follow the path while slowly rotating the camera, passing in the camera bearing and altitude from the previous animation
    await animatePath({
      map,
      duration: 40000,
      path: trackGeojson,
      startBearing: bearing,
      startAltitude: altitude,
      pitch: 50,
    });

    // get the bounds of the linestring, use fitBounds() to animate to a final view
    const bounds = turf.bbox(trackGeojson);
    map.fitBounds(bounds, {
      duration: 3000,
      pitch: 30,
      bearing: 0,
      padding: 120,
    });

    setTimeout(() => {
      resolve()
    }, 10000)
  })
};

const addPathSourceAndLayer = (trackGeojson) => {
  // Add a line feature and layer. This feature will get updated as we progress the animation
  map.addSource("line", {
    type: "geojson",
    // Line metrics is required to use the 'line-progress' property
    lineMetrics: true,
    data: trackGeojson,
  });
map.addLayer({
    id: "line-layer",
    type: "line",
    source: "line",
    paint: {
      "line-color": "rgba(0,0,0,0)",
      "line-width": 6,
      "line-opacity": 0.8,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });

  

    // add checkered flag
map.loadImage('https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Checkered_flag.svg/120px-Checkered_flag.svg.png', (error, image) => {
    if (error) throw error;
    map.addImage('checkered-flag', image);

    // Add flag marker at the finish line
    map.addLayer({
        id: "checkered-flag-marker",
        type: "symbol",
        source: {
            type: "geojson",
            data: {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Point",
                    coordinates: trackGeojson.geometry.coordinates.slice(-1)[0] // Last point of the route
                }
            }
        },
        layout: {
            "icon-image": "checkered-flag", // Use loaded flag
            "icon-size": 0.2, // Adjust size
            "icon-anchor": "bottom" // Place correctly
        }
    });
});


};
