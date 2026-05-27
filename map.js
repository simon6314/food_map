/* ==========================================================================
   Our Food Map - Leaflet Map Controller (map.js)
   Controls map initialization, tile themes, marker rendering, and polyline animations.
   ========================================================================== */

let map;
let markersLayer;
let pathPolyline = null;
let pathGlowPolyline = null;
let mapMarkers = {}; // Keep track of marker objects mapped by record ID / index

// Tile layer URLs
const MAP_TILES = {
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};

const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Initialize Leaflet Map
 */
function initMap(initialTheme = 'light') {
    // Default focus: center of Taiwan
    const defaultCenter = [23.973875, 120.982024];
    const defaultZoom = 8;
    
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    });
    
    // Add Zoom control at top right to keep bottom clean
    L.control.zoom({
        position: 'topright'
    }).addTo(map);
    
    // Add Attribution at bottom right
    L.control.attribution({
        position: 'bottomright',
        prefix: false
    }).addTo(map);
    
    // Set initial view
    map.setView(defaultCenter, defaultZoom);
    
    // Load and add the initial tile layer
    setMapTheme(initialTheme);
    
    // Initialize FeatureGroup for markers
    markersLayer = L.featureGroup().addTo(map);
    
    console.log("Leaflet map initialized successfully.");
}

/**
 * Set the Map Theme Tiles
 */
function setMapTheme(theme) {
    if (!map) return;
    
    // Remove existing tile layers
    map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }
    });
    
    // Add new themed tile layer
    const url = MAP_TILES[theme] || MAP_TILES.light;
    L.tileLayer(url, {
        attribution: MAP_ATTRIBUTION,
        maxZoom: 20
    }).addTo(map);
}

/**
 * Create Custom Pulsing DivIcon
 */
function createCustomIcon(type, isHighlighted = false) {
    const highlightClass = isHighlighted ? 'highlighted' : '';
    
    return L.divIcon({
        html: `
            <div class="custom-pulsing-marker ${highlightClass}">
                <div class="marker-pulse ${type}"></div>
                <div class="marker-pin ${type}"></div>
            </div>
        `,
        className: 'custom-marker-container',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

/*/**
 * Render Markers on Map
 * @param {Array} records - Filtered and sorted records
 * @param {Object} coordsDb - Coordinates database lookup
 * @param {Boolean} animatePath - Unused parameter after path lines removal
 */
function updateMapTrail(records, coordsDb, animatePath = true) {
    if (!map || !markersLayer) return;
    
    // 1. Clear previous layers
    markersLayer.clearLayers();
    mapMarkers = {};
    
    if (records.length === 0) return;
    
    // 2. Plot Markers
    const validMarkers = [];
    
    records.forEach((rec) => {
        const key = `${rec.location}|${rec.food}`;
        
        // Prioritize coordinates parsed directly from the Google Sheet columns (rec.lat, rec.lng)
        let lat = rec.lat ? parseFloat(rec.lat) : null;
        let lng = rec.lng ? parseFloat(rec.lng) : null;
        let address = "";
        let type = "restaurant";
        
        // If not present in Sheet columns, fall back to our coordinates database coordsDb
        if (!lat || !lng) {
            const coord = coordsDb[key];
            if (coord && coord.lat && coord.lng) {
                lat = coord.lat;
                lng = coord.lng;
                address = coord.address || "";
                type = coord.type || "restaurant";
            }
        } else {
            address = "Google 試算表直接定位";
            type = rec.location.includes("家") ? "home" : "restaurant";
        }
        
        if (lat && lng) {
            // Create L.marker
            const marker = L.marker([lat, lng], {
                icon: createCustomIcon(type),
                title: `${rec.location} - ${rec.food}`
            });
            
            // Build rich beautiful popup
            const cleanFood = rec.food.split(/[，,]/)[0].trim().replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "");
            const noteText = rec.food.includes("（") || rec.food.includes("(") ? 
                `<div class="card-note" style="margin-top: 0.25rem;">${rec.food.match(/[\uff08\u0028]([^\uff09\u0029]*)[\uff09\u0029]/)[1]}</div>` : '';
            
            const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.location + " " + cleanFood)}`;
            
            const popupContent = `
                <div class="map-popup-title">${cleanFood}</div>
                <div class="map-popup-meta">
                    <span>🗓️ ${rec.date}</span>
                    <span>📍 ${rec.location}</span>
                </div>
                ${noteText}
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top:0.4rem; border-top:1px solid rgba(0,0,0,0.05); padding-top:0.3rem;">
                    🏢 ${address}
                </div>
                <a href="${mapsLink}" target="_blank" class="map-popup-link">
                    <i data-lucide="map"></i> <span>在 Google 地圖中開啟</span>
                </a>
            `;
            
            marker.bindPopup(popupContent, {
                maxWidth: 240,
                closeButton: false
            });
            
            // Trigger popup Lucide icons refresh after opening
            marker.on('popupopen', () => {
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            });
            
            // Map bidirection interaction (marker click highlights timeline card)
            marker.on('click', () => {
                highlightTimelineCard(rec.index);
            });
            
            // Add marker to layer group and store reference
            markersLayer.addLayer(marker);
            mapMarkers[rec.index] = marker;
            validMarkers.push(marker);
        }
    });
    
    // 3. Fly and Auto-Zoom to Fit Markers
    if (validMarkers.length > 0) {
        const bounds = markersLayer.getBounds();
        map.flyToBounds(bounds, {
            padding: [40, 40],
            maxZoom: 15,
            duration: 1.5
        });
    }
}

/**
 * Highlight a specific map marker
 */
function highlightMapMarker(recordIndex, isHighlighted = true) {
    const marker = mapMarkers[recordIndex];
    if (!marker) return;
    
    const key = Object.keys(mapMarkers).find(k => mapMarkers[k] === marker);
    // Find key in database to get the type
    // Fallback is default restaurant
    const type = marker.options.title.includes("家") ? "home" : "restaurant";
    
    marker.setIcon(createCustomIcon(type, isHighlighted));
    
    if (isHighlighted) {
        // Bring marker to front
        marker.setZIndexOffset(1000);
    } else {
        marker.setZIndexOffset(0);
    }
}

/**
 * Focus and zoom in on a specific marker
 */
function focusMarker(recordIndex, coordsDb, key) {
    const marker = mapMarkers[recordIndex];
    const coord = coordsDb[key];
    
    if (coord && coord.lat && coord.lng) {
        map.flyTo([coord.lat, coord.lng], 16, {
            duration: 1.2
        });
        
        if (marker) {
            setTimeout(() => {
                marker.openPopup();
            }, 1200);
        }
    }
}

/**
 * Helper: Parse date string "YY/MM/DD" to timestamp
 */
function parseDateString(dateStr) {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const year = parseInt(parts[0]) + 2000;
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        return new Date(year, month, day);
    }
    return new Date(dateStr);
}
