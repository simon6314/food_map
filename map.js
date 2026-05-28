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
 * Get calibrated coordinates for home locations.
 * If the location contains "家", it maps to a specific home or defaults to "竹南家".
 * Returns null if the location does not contain "家".
 */
function getHomeCoordinates(location) {
    if (!location || !location.includes("家")) return null;
    
    let homeKey = "竹南家";
    if (location.includes("新竹")) homeKey = "新竹家";
    else if (location.includes("大溪")) homeKey = "大溪家";
    else if (location.includes("三峽") || location.includes("阿嬤") || location.includes("阿罵")) homeKey = "精靈阿嬤家";
    
    const homes = {
        "竹南家": { lat: 24.679919, lng: 120.868691, address: "竹南家 (苗栗縣竹南鎮真如路561巷)", type: "home" },
        "新竹家": { lat: 24.78359, lng: 121.022661, address: "新竹家 (新竹市東區關東路78號)", type: "home" },
        "大溪家": { lat: 24.877811, lng: 121.259996, address: "大溪家 (桃園市大溪區員林路三段257巷35弄)", type: "home" },
        "精靈阿嬤家": { lat: 24.9358, lng: 121.3735, address: "精靈阿嬤家 (新北市三峽區大同路220號)", type: "home" }
    };
    return homes[homeKey];
}


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
function createCustomIcon(type, isHighlighted = false, frequency = 1, isChampion = false) {
    const highlightClass = isHighlighted ? 'highlighted' : '';
    const championClass = isChampion ? 'champion' : '';
    
    // Calculate dynamic parameters based on frequency (Capped at 50, even more compact sizing)
    const f = Math.min(Math.max(1, frequency), 50);
    const scale = Math.min(0.6 + Math.log10(f) * 0.5, 1.4);
    const opacity = Math.min(0.35 + Math.log10(f) * 0.35, 0.95); // slightly higher base opacity for static glow
    const coreSize = Math.min(6 + Math.log10(f) * 4, 12);
    
    // Set custom CSS variables for keyframes and core size
    const styleString = `
        --freq-scale: ${scale};
        --freq-opacity: ${opacity};
        --freq-core-size: ${coreSize}px;
    `;
    
    const crownHtml = isChampion ? '<div class="marker-crown">👑</div>' : '';
    
    return L.divIcon({
        html: `
            <div class="custom-pulsing-marker ${highlightClass} ${championClass}" style="${styleString}">
                ${crownHtml}
                <div class="marker-glow-area ${type}"></div>
                <div class="marker-core ${type}"></div>
            </div>
        `,
        className: 'custom-marker-container',
        iconSize: [48, 48],
        iconAnchor: [24, 24]
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
    
    // Group records by unique coordinate rounded to 5 decimal places
    const locationGroups = {};
    records.forEach((rec) => {
        let lat = null;
        let lng = null;
        let address = "";
        let type = "restaurant";
        
        const isHomeLocation = rec.location.includes("家");
        const homeCoords = getHomeCoordinates(rec.location);
        
        if (isHomeLocation && homeCoords) {
            lat = homeCoords.lat;
            lng = homeCoords.lng;
            address = homeCoords.address + (rec.food ? ` (${rec.food})` : "");
            type = "home";
        } else if (rec.lat && rec.lng) {
            lat = parseFloat(rec.lat);
            lng = parseFloat(rec.lng);
            address = "Google 試算表直接定位";
            type = "restaurant";
        } else {
            const key = `${rec.location}|${rec.food}`;
            const coord = coordsDb[key];
            if (coord && coord.lat && coord.lng) {
                lat = coord.lat;
                lng = coord.lng;
                address = coord.address || "";
                type = coord.type || "restaurant";
            }
        }
        
        if (lat && lng) {
            const coordKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
            if (!locationGroups[coordKey]) {
                locationGroups[coordKey] = {
                    lat: lat,
                    lng: lng,
                    location: rec.location,
                    type: type,
                    address: address,
                    records: []
                };
            }
            locationGroups[coordKey].records.push(rec);
        }
    });
    
    const validMarkers = [];
    
    // Find the maximum frequency among all coordinate groups to identify the champion
    let maxFreq = 0;
    let championLocationName = "";
    Object.values(locationGroups).forEach((group) => {
        const freq = group.records.length;
        if (freq > maxFreq) {
            maxFreq = freq;
            championLocationName = group.location;
        }
    });
    
    // Plot one marker per unique coordinate group
    Object.values(locationGroups).forEach((group) => {
        const frequency = group.records.length;
        // Only make it a champion if they have visited more than once
        const isChampion = (group.location === championLocationName && frequency > 1);
        
        // Create L.marker
        const marker = L.marker([group.lat, group.lng], {
            icon: createCustomIcon(group.type, false, frequency, isChampion),
            title: `${group.location} - 共 ${frequency} 次足跡`
        });
        
        // Store metadata on marker object for highlighted toggle
        marker.recordFrequency = frequency;
        marker.isChampionLocation = isChampion;
        
        // Map all records in this group to this marker
        group.records.forEach((rec) => {
            mapMarkers[rec.index] = marker;
        });
        
        // Build rich beautiful popup
        let popupContent = "";
        if (group.records.length === 1) {
            const rec = group.records[0];
            const cleanFood = rec.food.split(/[，,]/)[0].trim().replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "");
            const noteText = rec.food.includes("（") || rec.food.includes("(") ? 
                `<div class="card-note" style="margin-top: 0.25rem;">${rec.food.match(/[\uff08\u0028]([^\uff09\u0029]*)[\uff09\u0029]/)[1]}</div>` : '';
            
            const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.location + " " + cleanFood)}`;
            
            popupContent = `
                <div class="map-popup-title">${cleanFood}</div>
                <div class="map-popup-meta">
                    <span>🗓️ ${rec.date}</span>
                    <span>📍 ${rec.location}</span>
                </div>
                ${noteText}
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top:0.4rem; border-top:1px solid rgba(0,0,0,0.05); padding-top:0.3rem;">
                    🏢 ${group.address || rec.location}
                </div>
                <a href="${mapsLink}" target="_blank" class="map-popup-link">
                    <i data-lucide="map"></i> <span>在 Google 地圖中開啟</span>
                </a>
            `;
        } else {
            // Sort records in group by date descending
            const sortedGroupRecords = [...group.records].sort((a, b) => parseDateString(b.date) - parseDateString(a.date));
            
            let listHtml = "";
            sortedGroupRecords.forEach((rec) => {
                const cleanFood = rec.food.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
                const noteText = rec.food.includes("（") || rec.food.includes("(") ? 
                    `<span class="card-note" style="font-size:0.7rem; padding:0.05rem 0.25rem; margin-left:0.25rem;">${rec.food.match(/[\uff08\u0028]([^\uff09\u0029]*)[\uff09\u0029]/)[1]}</span>` : '';
                
                listHtml += `
                    <div class="popup-list-item" onclick="highlightTimelineCard('${rec.index}')" style="padding: 0.35rem 0; border-bottom: 1px dashed rgba(0,0,0,0.05); transition: background 0.2s;">
                        <div style="display:flex; justify-content:space-between; font-size:0.72rem; color: var(--text-secondary);">
                            <span>🗓️ ${rec.date}</span>
                        </div>
                        <div style="font-weight:700; font-size:0.78rem; color:var(--text-primary); margin-top:0.1rem;">
                            ${cleanFood} ${noteText}
                        </div>
                    </div>
                `;
            });
            
            const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(group.location)}`;
            
            popupContent = `
                <div class="map-popup-title" style="border-bottom:1px solid rgba(0,0,0,0.08); padding-bottom:0.3rem; margin-bottom:0.3rem;">
                    📍 ${group.location} <span style="font-size:0.75rem; font-weight:normal; color:var(--text-secondary);">(${group.records.length} 次足跡)</span>
                </div>
                <div style="max-height: 140px; overflow-y: auto; margin-top:0.4rem; padding-right:0.25rem;" class="custom-scrollbar">
                    ${listHtml}
                </div>
                <div style="font-size: 0.68rem; color: var(--text-light); margin-top:0.4rem; text-align:center; border-top:1px solid rgba(0,0,0,0.03); padding-top:0.3rem;">
                    💡 點擊項目可平滑滑動至下方卡片
                </div>
                <a href="${mapsLink}" target="_blank" class="map-popup-link" style="margin-top:0.3rem; display:inline-flex;">
                    <i data-lucide="map"></i> <span>在 Google 地圖中搜尋</span>
                </a>
            `;
        }
        
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
        
        // Map bidirection interaction (marker click highlights timeline card of the latest visit)
        marker.on('click', () => {
            const sortedGroupRecords = [...group.records].sort((a, b) => parseDateString(b.date) - parseDateString(a.date));
            if (sortedGroupRecords.length > 0) {
                highlightTimelineCard(sortedGroupRecords[0].index);
            }
        });
        
        markersLayer.addLayer(marker);
        validMarkers.push(marker);
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
    const frequency = marker.recordFrequency || 1;
    const isChampion = marker.isChampionLocation || false;
    
    marker.setIcon(createCustomIcon(type, isHighlighted, frequency, isChampion));
    
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
    const loc = key.split('|')[0];
    
    let coord = null;
    const homeCoords = getHomeCoordinates(loc);
    if (homeCoords) {
        coord = homeCoords;
    } else {
        coord = coordsDb[key];
    }
    
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
