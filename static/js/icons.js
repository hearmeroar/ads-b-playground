// Shared boilerplate for every rotating marker icon: wraps an inline SVG in
// the div Leaflet's divIcon rotates via CSS transform. `data-color` records
// the source color on the wrapper regardless of how many colored <path>s the
// glyph itself has — this is what lets tests count markers by source color
// without depending on each icon having exactly one colored path (see
// colorCounts() in tests/frontend/helpers.js).
// The rotation lives on an inner wrapper, not on `.plane-icon` itself: a CSS
// `filter` (the drop-shadow below) is computed on the already-rotated content
// of the element it's set on, so putting both `transform: rotate()` and the
// shadow filter on the same node makes the shadow spin with the aircraft —
// wrong, since a real cast shadow's direction is fixed relative to the
// ground/light source, not the object's heading.
function rotatedDivIcon(cssClass, size, anchor, headingDeg, color, svgInner, viewBox) {
  const heading = Number.isFinite(headingDeg) ? headingDeg : 0;
  const vb = viewBox || '0 0 24 24';
  const html =
    '<div class="plane-icon ' + cssClass + '" data-color="' + color + '">' +
      '<div class="plane-icon-rotate" style="transform: rotate(' + heading + 'deg)">' +
        '<svg width="' + size + '" height="' + size + '" viewBox="' + vb + '">' + svgInner + '</svg>' +
      '</div>' +
    '</div>';
  return L.divIcon({ className: '', html: html, iconSize: [size, size], iconAnchor: [anchor, anchor] });
}

// Default glyph (Material Design "flight" icon, 24×24 viewBox) — used for
// the uav category, which has no dedicated per-category artwork in the
// icon set.
const GENERIC_AIRCRAFT_GLYPH =
  '<path d="M21,16v-2l-8-5V3.5C13,2.67,12.33,2,11.5,2S10,2.67,10,3.5V9l-8,5v2l8-2.5V19l-2.5,1.5V22l4-1l4,1v-1.5' +
        'L13,19v-5.5L21,16z" fill="COLOR" stroke="#fff" stroke-width="0.8"/>';

function genericGlyph(color) {
  return GENERIC_AIRCRAFT_GLYPH.replace(/COLOR/g, color);
}

// Per-category glyphs from ADS-B Radar icon set (200×200 viewBox). Each wrapped
// in <g> with source color, stroke, and vector-effect for constant outline.
// Transform applied to handle coordinate system from source SVG editor.
const LIGHT_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 137.678 -39.456 C 137.678 -41.883 134.94 -44.391 133.645 -44.391 C 130.326 -44.391 135.025 -44.391 128.237 -44.391 L 109.354 -44.391 C 106.278 -44.391 101.866 -46.186 99.913 -48.286 L 99.913 -91.597 C 98.693 -92.916 94.12 -96.731 90.472 -96.731 C 86.824 -96.731 80.299 -93.16 81.031 -91.597 L 71.59 -44.391 L 62.149 -44.391 L 33.822 -39.639 C 33.825 -40.147 33.825 -57.191 33.825 -63.273 C 33.825 -67.493 21.167 -63.273 21.167 -63.273 C 19.703 -63.273 20.894 -55.345 20.979 -53.858 C 20.894 -53.832 16.125 -41.44 16.143 -34.95 C 16.161 -28.451 21.006 -16.068 21.006 -16.068 C 21.006 -14.506 19.141 -6.626 21.176 -6.6129999999999995 C 20.605 -6.626 33.825 -2.219 33.825 -6.626 C 33.825 -13.832 33.825 -30.235 33.825 -30.235 L 62.149 -25.509 L 71.59 -25.509 L 81.031 21.697 C 80.299 23.21 86.998 25.911 90.472 25.911 C 93.946 25.911 98.693 23.015 99.913 21.697 L 99.913 -20.794 C 101.866 -22.943 106.278 -25.509 109.354 -25.509 L 128.237 -25.509 C 135.418 -25.509 130.239 -25.509 133.62 -25.485 C 135.593 -25.509 137.678 -28.025 137.678 -30.396 C 137.678 -30.396 146.133 -33.618 146.135 -34.95 C 146.137 -36.315 137.678 -39.456 137.678 -39.456 Z"/></g>';
const SMALL_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.119 -34.95 C 147.119 -41.542 138.979 -44.391 128.237 -44.391 L 109.354 -44.391 C 106.278 -44.391 101.866 -46.186 99.913 -48.286 L 90.472 -91.597 C 89.252 -92.916 84.679 -97.135 81.031 -97.135 C 77.383 -97.135 70.858 -93.16 71.59 -91.597 L 73.978 -44.391 L 62.149 -44.391 C 62.149 -44.391 64.374 -51.607 62.149 -53.832 C 57.698 -58.283 47.717 -58.283 43.266 -53.832 C 41.041 -51.607 43.266 -44.391 43.266 -44.391 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 19.737 -34.95 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 43.451 -26.66 C 43.451 -26.66 40.791 -18.587 43.266 -16.068 C 47.678 -11.579 57.698 -11.617 62.149 -16.068 C 64.374 -18.293 62.149 -25.509 62.149 -25.509 L 73.978 -25.509 L 71.59 21.697 C 70.858 23.21 77.557 26.113 81.031 26.113 C 84.505 26.113 89.252 23.015 90.472 21.697 L 99.913 -20.794 C 101.866 -22.943 106.278 -25.509 109.354 -25.509 L 128.237 -25.509 C 138.979 -25.509 147.119 -28.358 147.119 -35.511 L 147.119 -34.95 Z"/></g>';
const LARGE_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.119 -35.254 C 147.119 -41.846000000000004 138.086 -46.68 127.344 -46.68 L 103.125 -46.68 C 100.049 -46.68 98.877 -47.168 96.924 -49.268 L 90.503 -56.217 L 90.503 -66.571 L 81.002 -66.571 L 59.277 -90.478 C 58.057 -91.797 56.592 -92.529 55.029 -92.529 L 48.438 -92.529 C 46.973 -92.529 46.143 -91.211 46.875 -89.648 L 66.26 -46.68 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 66.26 -23.877 L 46.875 19.141 C 46.143 20.654 46.973 21.973 48.438 21.973 L 55.029 21.973 C 56.592 21.973 58.057 21.24 59.277 19.922 L 81.069 -3.904 L 90.503 -3.927 L 90.503 -14.345 L 96.924 -21.24 C 98.877 -23.389 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.662 147.119 -35.254 Z"/></g>';
const HIGH_VORTEX_LARGE_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.119 -35.254 C 147.119 -41.846000000000004 138.086 -46.68 127.344 -46.68 L 103.125 -46.68 C 100.049 -46.68 98.877 -47.168 96.924 -49.268 L 90.503 -56.217 L 90.503 -66.571 L 81.002 -66.571 L 59.277 -90.478 C 58.057 -91.797 56.592 -92.529 55.029 -92.529 L 48.438 -92.529 C 46.973 -92.529 46.143 -91.211 46.875 -89.648 L 66.26 -46.68 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 24.384 -34.95 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 66.26 -23.877 L 46.875 19.141 C 46.143 20.654 46.973 21.973 48.438 21.973 L 55.029 21.973 C 56.592 21.973 58.057 21.24 59.277 19.922 L 80.805 -3.927 L 90.503 -3.927 L 90.503 -14.345 L 96.924 -21.24 C 98.877 -23.389 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.662 147.119 -35.254 Z"/></g>';
const HEAVY_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.119 -35.254 C 147.119 -41.846000000000004 138.086 -46.68 127.344 -46.68 L 103.125 -46.68 C 100.049 -46.68 98.877 -47.168 96.924 -49.268 L 90.503 -56.217 L 90.503 -66.571 L 81.002 -66.571 L 81.031 -82.156 L 66.863 -82.156 L 59.277 -90.478 C 58.057 -91.797 56.592 -92.529 55.029 -92.529 L 48.438 -92.529 C 46.973 -92.529 46.143 -91.211 46.875 -89.648 L 66.26 -46.68 L 34.912 -43.555 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 34.912 -26.953 L 66.26 -23.877 L 46.875 19.141 C 46.143 20.654 46.973 21.973 48.438 21.973 L 55.029 21.973 C 56.592 21.973 58.057 21.24 59.277 19.922 L 66.848 12.193 L 81.031 12.256 L 81.002 -3.927 L 90.503 -3.927 L 90.503 -14.345 L 96.924 -21.24 C 98.877 -23.389 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.662 147.119 -35.254 Z"/></g>';
const HIGH_PERFORMANCE_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 17.718 -10.644 L 24.384 -34.95 L 17.718 -59.193 L 22.376 -63.188 L 42.042 -45.053 L 46.445 -45.053 L 42.042 -78.667 L 53.954 -79.462 L 99.913 -44.391 C 99.913 -44.391 119.05 -46.566 128.237 -44.391 C 135.089 -42.769 147.119 -34.918 147.119 -34.918 C 147.119 -34.918 135.081 -27.123 128.237 -25.509 C 119.056 -23.344 99.939 -25.485 99.939 -25.485 L 53.954 9.636 L 42.042 8.831 L 46.445 -24.784 L 42.042 -24.784 L 22.376 -6.638 L 17.718 -10.644 Z"/></g>';
const ROTORCRAFT_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 142.944 -44.391 C 139.538 -52.615 135.405 -50.329 128.237 -53.832 C 116.927 -59.359 102.102 -58.649 90.472 -53.832 C 82.248 -50.426 71.59 -40.893 71.59 -40.893 L 33.825 -40.893 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 24.384 -44.391 L 24.384 -25.509 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 33.822 -30.006 L 71.59 -29.975 C 71.59 -29.975 82.248 -19.474 90.472 -16.068 C 102.102 -11.25 116.937 -10.521 128.237 -16.068 C 135.379 -19.574 139.429 -17.285 142.835 -25.509 C 145.244 -31.324 145.353 -38.576 142.86 -44.422 L 142.944 -44.391 Z"/></g>';
const GLIDER_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.119 -35.509 C 147.119 -42.101 128.247 -40.196 128.247 -40.196 C 128.247 -40.196 121.869 -39.494 118.811 -40.229 C 115.479 -41.03 109.637 -44.871 109.637 -44.871 C 109.637 -44.871 109.637 -82.316 109.637 -97.762 C 109.637 -101.182 99.913 -101.038 99.913 -101.038 C 98.849 -102.188 99.913 -59.556 97.974 -44.881 C 96.725 -42.05 90.503 -40.229 90.503 -40.229 L 24.386 -38.787 L 24.658 -62.158 C 23.828 -63.477 22.9 -64.062 21.094 -64.062 L 18.359 -64.062 C 16.895 -64.062 16.064 -63.281 16.064 -61.768 L 14.943 -34.95 L 16.064 -8.789 C 16.064 -7.227 16.895 -6.494 18.359 -6.494 L 21.094 -6.494 C 22.9 -6.494 23.828 -7.08 24.658 -8.398 L 24.386 -32.234 L 90.503 -30.858 C 90.503 -30.858 96.893 -28.325 97.974 -26.14 C 100.715 -9.365 99.913 28.489 99.939 30.016 C 99.181 30.002 109.637 30.048 109.637 26.756 C 109.637 11.297 109.637 -26.148 109.637 -26.148 C 111.59 -28.297 115.471 -30.44 119.008 -30.858 C 122.368 -30.977 128.247 -30.826 128.247 -30.826 C 128.247 -30.826 147.119 -28.917 147.119 -35.509 Z"/></g>';
const LIGHTER_THAN_AIR_GLYPH = '<g transform="translate(100, 100)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><ellipse cx="0" cy="0.1" rx="46.209" ry="85.8"/></g>';
const PARACHUTIST_GLYPH = '<g fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 142.86 28.6 L 171.432 57.2 L 185.718 100.1 L 171.432 143 L 142.86 171.6 L 100.002 185.9 L 57.144 171.6 L 28.572 143 L 14.286 100.1 L 28.572 57.2 L 57.144 28.6 L 100.002 14.3 L 142.86 28.6 Z"/><circle cx="100" cy="100" r="12.48" style="fill: rgb(255, 255, 255);"/></g>';
const ULTRALIGHT_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.64 -35.505 C 147.64 -42.097 91.064 -101.03 91.064 -101.03 C 90.511 -101.627 91.418 -78.099 91.418 -78.099 L 82.048 -63.585 C 82.048 -63.585 98.395 -44.866 91.418 -44.866 C 72.677 -44.866 72.677 -44.866 63.306 -44.866 C 60.254 -44.866 72.744 -40.081 72.677 -35.505 C 72.606 -30.724 60.117 -26.143 63.306 -26.143 C 72.677 -26.143 78.924 -26.143 91.418 -26.143 C 100.788 -26.143 82.048 -7.418 82.048 -7.418 L 91.418 7.087 L 91.09 30.024 C 91.09 30.024 147.64 -28.913 147.64 -35.505 Z"/></g>';
const SURFACE_OBSTACLE_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.197083, 247.503403)" fill="#9ca3af" stroke="none"><path d="M 143.535 -82.319 C 143.535 -82.819 134.164 -82.319 134.164 -82.319 C 134.164 -82.319 136.37 -89.474 134.164 -91.68 C 130.987 -94.857 109.502 -95.129 106.053 -91.68 C 103.847 -89.474 106.053 -82.319 106.053 -82.319 L 87.312 -82.319 C 87.312 -82.319 89.518 -89.474 87.312 -91.68 C 83.747 -95.245 62.262 -94.741 59.201 -91.68 C 56.995 -89.474 59.201 -82.319 59.201 -82.319 L 40.46 -82.319 C 40.367 -82.419 40.46 -54.235 40.46 -54.235 L 96.683 -44.874 L 96.683 -26.151 L 40.46 -16.79 L 40.46 11.294 L 59.201 11.294 C 59.201 11.294 56.995 18.449 59.201 20.655 C 62.344 23.798 83.829 24.138 87.312 20.655 C 89.518 18.449 87.312 11.294 87.312 11.294 C 107.852 11.294 106.053 11.294 106.053 11.294 C 106.053 11.294 103.847 18.449 106.053 20.655 C 109.208 23.81 130.693 24.126 134.164 20.655 C 136.37 18.449 134.164 11.294 134.164 11.294 L 143.535 11.294 L 143.535 -7.429 L 152.905 -7.429 L 152.905 -63.596 L 143.535 -63.596 C 143.535 -63.596 143.535 -81.196 143.535 -82.319 Z"/></g>';
// Unknown / no-category aircraft (ADS-B Radar a0.svg — "no ADS-B info" variant).
const UNKNOWN_GLYPH = '<g transform="matrix(0, -1.526083, 1.526083, 0, 154.192352, 224.515808)" fill="COLOR" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"><path d="M 147.119 -35.2539 C 147.119 -41.8457 138.086 -46.6797 127.344 -46.6797 L 103.125 -46.6797 C 100.049 -46.6797 98.877 -47.168 96.9238 -49.2676 L 59.2773 -90.4785 C 58.0566 -91.7969 56.5918 -92.5293 55.0293 -92.5293 L 48.4375 -92.5293 C 46.9727 -92.5293 46.1426 -91.2109 46.875 -89.6484 L 66.2598 -46.6797 L 34.9121 -43.5547 L 24.6582 -62.1582 C 23.8281 -63.4766 22.9004 -64.0625 21.0938 -64.0625 L 18.3594 -64.0625 C 16.8945 -64.0625 16.0645 -63.2812 16.0645 -61.7676 L 16.0645 -8.78906 C 16.0645 -7.22656 16.8945 -6.49414 18.3594 -6.49414 L 21.0938 -6.49414 C 22.9004 -6.49414 23.8281 -7.08008 24.6582 -8.39844 L 34.9121 -26.9531 L 66.2598 -23.877 L 46.875 19.1406 C 46.1426 20.6543 46.9727 21.9727 48.4375 21.9727 L 55.0293 21.9727 C 56.5918 21.9727 58.0566 21.2402 59.2773 19.9219 L 96.9238 -21.2402 C 98.877 -23.3887 100.049 -23.877 103.125 -23.877 L 127.344 -23.877 C 138.086 -23.877 147.119 -28.6621 147.119 -35.2539 Z"/></g>';

// Every per-category marker icon differs only in its glyph and CSS class,
// so one table + one factory replaces the old per-category function pairs.
// Keys are category groups with a dedicated ADS-B Radar glyph; uav is the
// one exception (generic Material Design glyph, different size/viewBox —
// see uavIcon) and joins ICON_BUILDERS separately below.
const CATEGORY_GLYPHS = {
  light: LIGHT_GLYPH,                     // OpenSky cat 2 / ADSBExchange A1
  small: SMALL_GLYPH,                     // cat 3 / A2
  large: LARGE_GLYPH,                     // cat 4 / A3
  high_vortex_large: HIGH_VORTEX_LARGE_GLYPH, // 747/A380-class, cat 5 / A4
  heavy: HEAVY_GLYPH,                     // cat 6 / A5
  high_performance: HIGH_PERFORMANCE_GLYPH,   // cat 7 / A6
  rotorcraft: ROTORCRAFT_GLYPH,           // cat 8 / A7
  glider: GLIDER_GLYPH,                   // cat 9 / B1
  lighter_than_air: LIGHTER_THAN_AIR_GLYPH,   // cat 10 / B2
  parachutist: PARACHUTIST_GLYPH,         // cat 11 / B3
  ultralight: ULTRALIGHT_GLYPH,           // cat 12 / B4
  unknown: UNKNOWN_GLYPH,                 // cat 0 / absent (a0.svg) — also iconFor()'s fallback
  // space: intentionally absent — falls through to the unknown icon in iconFor().
};

// The CSS class is exactly what the old per-category builders used
// ("light-icon", "high-vortex-large-icon", ...) — style.css and the tests
// key off these names, so the underscore→hyphen derivation must not change.
function categoryIcon(group, headingDeg, color) {
  const cssClass = group.replace(/_/g, '-') + '-icon';
  return rotatedDivIcon(cssClass, 20, 10, headingDeg, color,
    CATEGORY_GLYPHS[group].replace(/COLOR/g, color), '0 0 200 200');
}

// UAV (OpenSky cat 14 / ADSBExchange B6) — deliberately keeps the generic
// Material Design glyph rather than the icon set's b0.svg, which is used
// for the category dropdown only (no re-approval was given to change the
// on-map UAV glyph).
function uavIcon(headingDeg, color) {
  return rotatedDivIcon('uav-icon', 28, 14, headingDeg, color, genericGlyph(color));
}

// Surface obstacle icon for ground stations/vehicles (`isGroundVehicle` or
// categoryGroup "surface_obstacle") — uses ADS-B Radar icon set (c0.svg) in
// neutral grey rather than source-colored, since these aren't really "sources"
// of aircraft data. Never rotated — ground stations have no heading. `color`
// is still accepted and recorded via `data-color` for colorCounts() compatibility.
function towerIcon(color) {
  return rotatedDivIcon('surface-obstacle-icon', 20, 10, 0, color, SURFACE_OBSTACLE_GLYPH, '0 0 200 200');
}

// Airport/heliport markers (map-init.js's Airports layer) — Material Design
// Icons (pictogrammers.com/MaterialDesign, Apache-2.0), same vendoring
// convention as GROUP_ICONS in render-details.js and the favicon glyph.
// Heliports get their own distinct "helicopter" glyph rather than reusing
// the generic airport pin, since they're a visually and operationally
// distinct kind of facility a user would want to tell apart at a glance.
const AIRPORT_GLYPH = '<path d="M14.97,5.92C14.83,5.41 14.3,5.1 13.79,5.24L10.39,6.15L5.95,2.03L4.72,2.36L7.38,6.95L4.19,7.8L2.93,6.82L2,7.07L3.66,9.95L14.28,7.11C14.8,6.96 15.1,6.43 14.97,5.92M21,10L20,12H15L14,10L15,9H17V7H18V9H20L21,10M22,20V22H2V20H15V13H20V20H22Z" fill="COLOR" stroke="#fff" stroke-width="0.6"/>';
const HELIPORT_GLYPH = '<path d="M3,3H17V5H3V3M23,6V10.5L14.75,12.2C14.91,12.6 15,13.04 15,13.5C15,14.9 14.18,16.1 13,16.66V17L13,19H16V21H4A3,3 0 0,1 1,18V17H3V18A1,1 0 0,0 4,19H5V16.74C3.25,16.13 2,14.46 2,12.5C2,10 4,8 6.5,8H9V6H11V8H21V6H23M11,19V17H7V19H11M7.5,10C6.12,10 5,10.9 5,12C5,13.1 6.12,14 7.5,14C8.88,14 10,13.1 10,12C10,10.9 8.88,10 7.5,10Z" fill="COLOR" stroke="#fff" stroke-width="0.6"/>';

// Fixed neutral slate color, not source-colored — like towerIcon, an
// airport is static ground infrastructure, not a "source" of aircraft data.
const AIRPORT_MARKER_COLOR = '#475569';

// Icon size scales with real-world significance (a major hub should read
// as more prominent than a small strip/heliport at a glance, the same idea
// as varying line weight on a paper aviation chart) rather than every
// airport type looking identical regardless of size.
const AIRPORT_ICON_SIZES = {
  large_airport: 26, medium_airport: 20, small_airport: 15,
  heliport: 15, seaplane_base: 15, balloonport: 13,
};

// Never rotated (static ground infrastructure, no heading) — headingDeg is
// hardcoded to 0 via rotatedDivIcon, same idiom towerIcon already uses.
function airportIcon(type) {
  const size = AIRPORT_ICON_SIZES[type] || 15;
  const cssClass = 'airport-icon airport-icon-' + (type || 'unknown').replace(/_/g, '-');
  const glyph = (type === 'heliport' ? HELIPORT_GLYPH : AIRPORT_GLYPH).replace(/COLOR/g, AIRPORT_MARKER_COLOR);
  return rotatedDivIcon(cssClass, size, size / 2, 0, AIRPORT_MARKER_COLOR, glyph, '0 0 24 24');
}

const ICON_BUILDERS = { uav: uavIcon };
for (const group of Object.keys(CATEGORY_GLYPHS)) {
  ICON_BUILDERS[group] = (headingDeg, color) => categoryIcon(group, headingDeg, color);
}

// Ground vehicles (either flagged by looksLikeGroundVehicle()'s heuristics,
// which can fire even when category is absent/unknown, or by categoryGroup
// itself being "surface_obstacle") always get the tower icon regardless of
// category. Every other item is dispatched by categoryGroup via
// ICON_BUILDERS, falling back to the unknown-category icon (a0.svg) for
// groups with no dedicated icon (space category, or no category at all).
function iconFor(item, color) {
  if (item.isGroundVehicle || item.categoryGroup === 'surface_obstacle') {
    return towerIcon(color);
  }
  const builder = ICON_BUILDERS[item.categoryGroup];
  return builder ? builder(item.heading, color) : categoryIcon('unknown', item.heading, color);
}

// Creates/moves/removes markers in `markerMap` to match `items`
// ({id, lat, lon, heading, info, registration, isGroundVehicle,
// categoryGroup}[]), reusing existing markers instead of recreating them
// each poll. Returns the number of markers now shown.
function syncMarkers(markerMap, items, color) {
  const seen = new Set();

  for (const item of items) {
    seen.add(item.id);
    const latlng = [item.lat, item.lon];
    let marker = markerMap.get(item.id);

    if (marker) {
      marker.setLatLng(latlng);
      marker.setIcon(iconFor(item, color));
    } else {
      const isGround = item.isGroundVehicle || item.categoryGroup === 'surface_obstacle';
      const markerOptions = { icon: iconFor(item, color) };
      if (isGround) markerOptions.pane = 'groundPane';
      marker = L.marker(latlng, markerOptions).addTo(map);
      // L.Marker defaults bubblingMouseEvents to false (unlike L.Path, which
      // defaults to true), so this click never actually reaches the map's own
      // click handler below — stopPropagation() here is a defensive no-op,
      // kept in case that ever changes rather than because it's currently load-bearing.
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectAircraft(item.id);
      });
      markerMap.set(item.id, marker);
    }

    // lat/lon are carried through for route-validation.js's geometric
    // checks (buildMergedDetails needs the aircraft's *current* position,
    // which otherwise only ever lived on the marker itself). categoryGroup/
    // categoryCode are carried the same way for the collection feature's
    // save-button gating (auth-collection.js) — categoryCode is item.category
    // as-is: a number for OpenSky-sourced items, or the raw ADS-B letter+digit
    // string (e.g. "C0") for adsb.fi/airplanes.live-sourced ones.
    detailsById.set(item.id, {
      info: item.info, registration: item.registration, fieldSources: item.fieldSources,
      lat: item.lat, lon: item.lon, categoryGroup: item.categoryGroup, categoryCode: item.categoryCode,
      isGroundVehicle: item.isGroundVehicle,
    });
    // Keep the open sidebar's text live across polls. Unlike the old Leaflet
    // popup, this never touches the gallery (a separate element) — so an
    // already-loaded photo just keeps sitting there rather than needing to
    // be re-fetched or re-triggered.
    if (selectedIcao24 === item.id) renderSelectedDetails();
  }

  clearStaleMarkers(markerMap, seen);
  return seen.size;
}

function clearStaleMarkers(markerMap, seen) {
  for (const [id, marker] of markerMap) {
    if (!seen.has(id)) {
      map.removeLayer(marker);
      markerMap.delete(id);
      // Do NOT deselect here — a single source's stale-marker sweep only sees
      // that source's view. Cross-source handoffs (aircraft moves from adsb.fi
      // to OpenSky priority) would spuriously close the sidebar even though
      // the aircraft is still alive. Deselection is decided once per poll in
      // main.js's poll() after all sources have rendered.
    }
  }
}

function clearAllMarkers(markerMap) {
  for (const [id, marker] of markerMap) {
    map.removeLayer(marker);
    if (selectedIcao24 === id) deselectAircraft();
  }
  markerMap.clear();
}
