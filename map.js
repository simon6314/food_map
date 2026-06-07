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


const TAIWAN_CITIES = [
    { name: "臺北市中正區", lat: 25.04214, lng: 121.51987 },
    { name: "臺北市大同區", lat: 25.06272, lng: 121.51131 },
    { name: "臺北市中山區", lat: 25.07920, lng: 121.54271 },
    { name: "臺北市松山區", lat: 25.05416, lng: 121.56386 },
    { name: "臺北市大安區", lat: 25.02494, lng: 121.54338 },
    { name: "臺北市萬華區", lat: 25.02629, lng: 121.49703 },
    { name: "臺北市信義區", lat: 25.04092, lng: 121.57201 },
    { name: "臺北市士林區", lat: 25.09505, lng: 121.52461 },
    { name: "臺北市北投區", lat: 25.13415, lng: 121.50021 },
    { name: "臺北市內湖區", lat: 25.06894, lng: 121.59090 },
    { name: "臺北市南港區", lat: 25.03123, lng: 121.61119 },
    { name: "臺北市文山區", lat: 24.99292, lng: 121.57125 },
    { name: "基隆市仁愛區", lat: 25.11872, lng: 121.74519 },
    { name: "基隆市信義區", lat: 25.12843, lng: 121.78223 },
    { name: "基隆市中正區", lat: 25.14900, lng: 121.77368 },
    { name: "基隆市中山區", lat: 25.15259, lng: 121.72525 },
    { name: "基隆市安樂區", lat: 25.14741, lng: 121.70244 },
    { name: "基隆市暖暖區", lat: 25.08362, lng: 121.74804 },
    { name: "基隆市七堵區", lat: 25.11439, lng: 121.68534 },
    { name: "新北市萬里區", lat: 25.16760, lng: 121.63972 },
    { name: "新北市金山區", lat: 25.22236, lng: 121.63678 },
    { name: "新北市板橋區", lat: 25.01141, lng: 121.46184 },
    { name: "新北市汐止區", lat: 25.06161, lng: 121.63972 },
    { name: "新北市深坑區", lat: 25.00338, lng: 121.61690 },
    { name: "新北市石碇區", lat: 25.00987, lng: 121.64528 },
    { name: "新北市瑞芳區", lat: 25.10305, lng: 121.82210 },
    { name: "新北市平溪區", lat: 25.02483, lng: 121.74087 },
    { name: "新北市雙溪區", lat: 24.99718, lng: 121.82210 },
    { name: "新北市貢寮區", lat: 25.01688, lng: 121.94598 },
    { name: "新北市新店區", lat: 24.97828, lng: 121.53948 },
    { name: "新北市坪林區", lat: 24.93508, lng: 121.71076 },
    { name: "新北市烏來區", lat: 24.86637, lng: 121.54978 },
    { name: "新北市永和區", lat: 25.01033, lng: 121.51454 },
    { name: "新北市中和區", lat: 24.99622, lng: 121.48531 },
    { name: "新北市土城區", lat: 24.96837, lng: 121.43803 },
    { name: "新北市三峽區", lat: 24.93586, lng: 121.37449 },
    { name: "新北市樹林區", lat: 24.98156, lng: 121.41986 },
    { name: "新北市鶯歌區", lat: 24.96150, lng: 121.34273 },
    { name: "新北市三重區", lat: 25.06145, lng: 121.48671 },
    { name: "新北市新莊區", lat: 25.02660, lng: 121.41783 },
    { name: "新北市泰山區", lat: 25.05816, lng: 121.43279 },
    { name: "新北市林口區", lat: 25.07901, lng: 121.38814 },
    { name: "新北市蘆洲區", lat: 25.08689, lng: 121.47152 },
    { name: "新北市五股區", lat: 25.08483, lng: 121.43866 },
    { name: "新北市八里區", lat: 25.14439, lng: 121.39830 },
    { name: "新北市淡水區", lat: 25.17198, lng: 121.44337 },
    { name: "新北市三芝區", lat: 25.25935, lng: 121.50243 },
    { name: "新北市石門區", lat: 25.29083, lng: 121.56714 },
    { name: "連江縣南竿鄉", lat: 26.15344, lng: 119.93069 },
    { name: "連江縣北竿鄉", lat: 26.22458, lng: 119.99826 },
    { name: "連江縣莒光鄉", lat: 25.96048, lng: 119.97233 },
    { name: "連江縣東引鄉", lat: 26.36570, lng: 120.49048 },
    { name: "宜蘭縣宜蘭市", lat: 24.75911, lng: 121.75374 },
    { name: "宜蘭縣壯圍鄉", lat: 24.76957, lng: 121.79932 },
    { name: "宜蘭縣頭城鎮", lat: 24.85761, lng: 121.82347 },
    { name: "宜蘭縣礁溪鄉", lat: 24.82142, lng: 121.76970 },
    { name: "宜蘭縣員山鄉", lat: 24.73813, lng: 121.66253 },
    { name: "宜蘭縣羅東鎮", lat: 24.67559, lng: 121.77082 },
    { name: "宜蘭縣三星鄉", lat: 24.66645, lng: 121.65245 },
    { name: "宜蘭縣大同鄉", lat: 24.54982, lng: 121.51416 },
    { name: "宜蘭縣五結鄉", lat: 24.68876, lng: 121.80501 },
    { name: "宜蘭縣冬山鄉", lat: 24.63192, lng: 121.75374 },
    { name: "宜蘭縣蘇澳鎮", lat: 24.59423, lng: 121.85333 },
    { name: "宜蘭縣南澳鄉", lat: 24.40660, lng: 121.67394 },
    { name: "宜蘭縣釣魚臺", lat: 24.72947, lng: 121.76446 },
    { name: "新竹市東區", lat: 24.79206, lng: 120.99338 },
    { name: "新竹市北區", lat: 24.82387, lng: 120.94747 },
    { name: "新竹市香山區", lat: 24.77982, lng: 120.93026 },
    { name: "新竹縣寶山鄉", lat: 24.74279, lng: 120.99910 },
    { name: "新竹縣竹北市", lat: 24.83469, lng: 120.99337 },
    { name: "新竹縣湖口鄉", lat: 24.88145, lng: 121.04498 },
    { name: "新竹縣新豐鄉", lat: 24.91329, lng: 120.99910 },
    { name: "新竹縣新埔鎮", lat: 24.84961, lng: 121.09083 },
    { name: "新竹縣關西鎮", lat: 24.80449, lng: 121.14813 },
    { name: "新竹縣芎林鄉", lat: 24.76579, lng: 121.10802 },
    { name: "新竹縣竹東鎮", lat: 24.77492, lng: 121.04498 },
    { name: "新竹縣五峰鄉", lat: 24.62982, lng: 121.11946 },
    { name: "新竹縣橫山鄉", lat: 24.71130, lng: 121.13667 },
    { name: "新竹縣尖石鄉", lat: 24.57607, lng: 121.30841 },
    { name: "新竹縣北埔鄉", lat: 24.66314, lng: 121.06791 },
    { name: "新竹縣峨眉鄉", lat: 24.67884, lng: 120.99910 },
    { name: "桃園市中壢區", lat: 24.97215, lng: 121.20540 },
    { name: "桃園市平鎮區", lat: 24.92960, lng: 121.20540 },
    { name: "桃園市龍潭區", lat: 24.84449, lng: 121.20540 },
    { name: "桃園市楊梅區", lat: 24.92421, lng: 121.13667 },
    { name: "桃園市新屋區", lat: 24.98266, lng: 121.06791 },
    { name: "桃園市觀音區", lat: 25.03594, lng: 121.11375 },
    { name: "桃園市桃園區", lat: 24.99341, lng: 121.29697 },
    { name: "桃園市龜山區", lat: 25.01991, lng: 121.36560 },
    { name: "桃園市八德區", lat: 24.94691, lng: 121.29125 },
    { name: "桃園市大溪區", lat: 24.86584, lng: 121.29697 },
    { name: "桃園市復興區", lat: 24.70909, lng: 121.37703 },
    { name: "桃園市大園區", lat: 25.04926, lng: 121.19394 },
    { name: "桃園市蘆竹區", lat: 25.07844, lng: 121.29697 },
    { name: "苗栗縣竹南鎮", lat: 24.70092, lng: 120.87860 },
    { name: "苗栗縣頭份市", lat: 24.68844, lng: 120.90248 },
    { name: "苗栗縣三灣鄉", lat: 24.63053, lng: 120.93026 },
    { name: "苗栗縣南庄鄉", lat: 24.58029, lng: 121.01057 },
    { name: "苗栗縣獅潭鄉", lat: 24.52387, lng: 120.93026 },
    { name: "苗栗縣後龍鎮", lat: 24.61443, lng: 120.79060 },
    { name: "苗栗縣通霄鎮", lat: 24.48926, lng: 120.68038 },
    { name: "苗栗縣苑裡鎮", lat: 24.40983, lng: 120.67751 },
    { name: "苗栗縣苗栗市", lat: 24.57115, lng: 120.81544 },
    { name: "苗栗縣造橋鄉", lat: 24.62481, lng: 120.86138 },
    { name: "苗栗縣頭屋鄉", lat: 24.57659, lng: 120.85454 },
    { name: "苗栗縣公館鄉", lat: 24.51114, lng: 120.82118 },
    { name: "苗栗縣大湖鄉", lat: 24.39810, lng: 120.87286 },
    { name: "苗栗縣泰安鄉", lat: 24.38320, lng: 121.03351 },
    { name: "苗栗縣銅鑼鄉", lat: 24.44819, lng: 120.79246 },
    { name: "苗栗縣三義鄉", lat: 24.38926, lng: 120.76948 },
    { name: "苗栗縣西湖鄉", lat: 24.52738, lng: 120.76086 },
    { name: "苗栗縣卓蘭鎮", lat: 24.31130, lng: 120.82549 },
    { name: "臺中市中區", lat: 24.14026, lng: 120.68182 },
    { name: "臺中市東區", lat: 24.14277, lng: 120.69442 },
    { name: "臺中市南區", lat: 24.12084, lng: 120.66241 },
    { name: "臺中市西區", lat: 24.14306, lng: 120.66313 },
    { name: "臺中市北區", lat: 24.15732, lng: 120.68326 },
    { name: "臺中市北屯區", lat: 24.18152, lng: 120.68610 },
    { name: "臺中市西屯區", lat: 24.17698, lng: 120.64243 },
    { name: "臺中市南屯區", lat: 24.14712, lng: 120.60848 },
    { name: "臺中市太平區", lat: 24.12407, lng: 120.71707 },
    { name: "臺中市大里區", lat: 24.10469, lng: 120.68121 },
    { name: "臺中市霧峰區", lat: 24.04432, lng: 120.73500 },
    { name: "臺中市烏日區", lat: 24.10779, lng: 120.63809 },
    { name: "臺中市豐原區", lat: 24.25212, lng: 120.72348 },
    { name: "臺中市后里區", lat: 24.30888, lng: 120.72237 },
    { name: "臺中市石岡區", lat: 24.27424, lng: 120.77716 },
    { name: "臺中市東勢區", lat: 24.25999, lng: 120.82721 },
    { name: "臺中市和平區", lat: 24.32073, lng: 121.30841 },
    { name: "臺中市新社區", lat: 24.18672, lng: 120.81544 },
    { name: "臺中市潭子區", lat: 24.21636, lng: 120.70625 },
    { name: "臺中市大雅區", lat: 24.22250, lng: 120.65450 },
    { name: "臺中市神岡區", lat: 24.24991, lng: 120.68176 },
    { name: "臺中市大肚區", lat: 24.13587, lng: 120.56245 },
    { name: "臺中市沙鹿區", lat: 24.23779, lng: 120.58547 },
    { name: "臺中市龍井區", lat: 24.21012, lng: 120.50578 },
    { name: "臺中市梧棲區", lat: 24.24908, lng: 120.53865 },
    { name: "臺中市清水區", lat: 24.27548, lng: 120.57133 },
    { name: "臺中市大甲區", lat: 24.37882, lng: 120.64875 },
    { name: "臺中市外埔區", lat: 24.33177, lng: 120.65332 },
    { name: "臺中市大安區", lat: 24.37024, lng: 120.59122 },
    { name: "彰化縣彰化市", lat: 24.07166, lng: 120.56245 },
    { name: "彰化縣芬園鄉", lat: 24.01356, lng: 120.62840 },
    { name: "彰化縣花壇鄉", lat: 24.02885, lng: 120.56245 },
    { name: "彰化縣秀水鄉", lat: 24.03486, lng: 120.51064 },
    { name: "彰化縣鹿港鎮", lat: 24.07551, lng: 120.44728 },
    { name: "彰化縣福興鄉", lat: 24.03770, lng: 120.42424 },
    { name: "彰化縣線西鄉", lat: 24.13167, lng: 120.46220 },
    { name: "彰化縣和美鎮", lat: 24.11229, lng: 120.49840 },
    { name: "彰化縣伸港鄉", lat: 24.15817, lng: 120.49827 },
    { name: "彰化縣員林市", lat: 23.95957, lng: 120.58547 },
    { name: "彰化縣社頭鄉", lat: 23.89920, lng: 120.58272 },
    { name: "彰化縣永靖鄉", lat: 23.92023, lng: 120.54518 },
    { name: "彰化縣埔心鄉", lat: 23.94300, lng: 120.55929 },
    { name: "彰化縣溪湖鎮", lat: 23.95833, lng: 120.49336 },
    { name: "彰化縣大村鄉", lat: 23.98907, lng: 120.56622 },
    { name: "彰化縣埔鹽鄉", lat: 23.98981, lng: 120.44728 },
    { name: "彰化縣田中鎮", lat: 23.85254, lng: 120.58547 },
    { name: "彰化縣北斗鎮", lat: 23.86921, lng: 120.53367 },
    { name: "彰化縣田尾鄉", lat: 23.90385, lng: 120.52215 },
    { name: "彰化縣埤頭鄉", lat: 23.87766, lng: 120.47033 },
    { name: "彰化縣溪州鄉", lat: 23.82478, lng: 120.51639 },
    { name: "彰化縣竹塘鄉", lat: 23.84483, lng: 120.42424 },
    { name: "彰化縣二林鎮", lat: 23.91414, lng: 120.40119 },
    { name: "彰化縣大城鄉", lat: 23.84836, lng: 120.30895 },
    { name: "彰化縣芳苑鄉", lat: 23.94559, lng: 120.35508 },
    { name: "彰化縣二水鄉", lat: 23.81152, lng: 120.61607 },
    { name: "南投縣南投市", lat: 23.91796, lng: 120.67751 },
    { name: "南投縣中寮鄉", lat: 23.90587, lng: 120.78097 },
    { name: "南投縣草屯鎮", lat: 23.99338, lng: 120.72350 },
    { name: "南投縣國姓鄉", lat: 24.05644, lng: 120.87286 },
    { name: "南投縣埔里鎮", lat: 23.99329, lng: 120.96469 },
    { name: "南投縣仁愛鄉", lat: 24.02137, lng: 121.12521 },
    { name: "南投縣名間鄉", lat: 23.85378, lng: 120.67751 },
    { name: "南投縣集集鎮", lat: 23.82799, lng: 120.79250 },
    { name: "南投縣水里鄉", lat: 23.79195, lng: 120.86138 },
    { name: "南投縣魚池鄉", lat: 23.87539, lng: 120.91878 },
    { name: "南投縣信義鄉", lat: 23.66798, lng: 120.98763 },
    { name: "南投縣竹山鎮", lat: 23.71220, lng: 120.68901 },
    { name: "南投縣鹿谷鄉", lat: 23.73484, lng: 120.78097 },
    { name: "嘉義市西區", lat: 23.48040, lng: 120.42424 },
    { name: "嘉義市東區", lat: 23.48533, lng: 120.47609 },
    { name: "嘉義縣番路鄉", lat: 23.44074, lng: 120.60848 },
    { name: "嘉義縣梅山鄉", lat: 23.54102, lng: 120.68901 },
    { name: "嘉義縣竹崎鄉", lat: 23.50497, lng: 120.60848 },
    { name: "嘉義縣阿里山鄉", lat: 23.43547, lng: 120.78097 },
    { name: "嘉義縣中埔鄉", lat: 23.39959, lng: 120.55094 },
    { name: "嘉義縣大埔鄉", lat: 23.30402, lng: 120.59698 },
    { name: "嘉義縣水上鄉", lat: 23.42874, lng: 120.40017 },
    { name: "嘉義縣鹿草鄉", lat: 23.41926, lng: 120.30895 },
    { name: "嘉義縣太保市", lat: 23.49645, lng: 120.38371 },
    { name: "嘉義縣朴子市", lat: 23.44642, lng: 120.25704 },
    { name: "嘉義縣東石鄉", lat: 23.47019, lng: 120.17048 },
    { name: "嘉義縣六腳鄉", lat: 23.52983, lng: 120.28733 },
    { name: "嘉義縣新港鄉", lat: 23.53812, lng: 120.35508 },
    { name: "嘉義縣民雄鄉", lat: 23.52036, lng: 120.44041 },
    { name: "嘉義縣大林鎮", lat: 23.60407, lng: 120.45420 },
    { name: "嘉義縣溪口鄉", lat: 23.59256, lng: 120.40119 },
    { name: "嘉義縣義竹鄉", lat: 23.35301, lng: 120.21665 },
    { name: "嘉義縣布袋鎮", lat: 23.36279, lng: 120.17048 },
    { name: "雲林縣斗南鎮", lat: 23.67714, lng: 120.47608 },
    { name: "雲林縣大埤鄉", lat: 23.65191, lng: 120.42424 },
    { name: "雲林縣虎尾鎮", lat: 23.71622, lng: 120.42424 },
    { name: "雲林縣土庫鎮", lat: 23.68826, lng: 120.35508 },
    { name: "雲林縣褒忠鄉", lat: 23.69444, lng: 120.31032 },
    { name: "雲林縣東勢鄉", lat: 23.69326, lng: 120.25704 },
    { name: "雲林縣臺西鄉", lat: 23.72297, lng: 120.19357 },
    { name: "雲林縣崙背鄉", lat: 23.76016, lng: 120.35317 },
    { name: "雲林縣麥寮鄉", lat: 23.74853, lng: 120.25627 },
    { name: "雲林縣斗六市", lat: 23.70779, lng: 120.54091 },
    { name: "雲林縣林內鄉", lat: 23.76188, lng: 120.60848 },
    { name: "雲林縣古坑鄉", lat: 23.64498, lng: 120.56374 },
    { name: "雲林縣莿桐鄉", lat: 23.77693, lng: 120.53942 },
    { name: "雲林縣西螺鎮", lat: 23.77553, lng: 120.44728 },
    { name: "雲林縣二崙鄉", lat: 23.81558, lng: 120.40622 },
    { name: "雲林縣北港鎮", lat: 23.59586, lng: 120.28588 },
    { name: "雲林縣水林鄉", lat: 23.56281, lng: 120.23973 },
    { name: "雲林縣口湖鄉", lat: 23.57759, lng: 120.17048 },
    { name: "雲林縣四湖鄉", lat: 23.63708, lng: 120.19357 },
    { name: "雲林縣元長鄉", lat: 23.62888, lng: 120.33202 },
    { name: "臺南市中西區", lat: 22.99482, lng: 120.19645 },
    { name: "臺南市東區", lat: 22.98133, lng: 120.22242 },
    { name: "臺南市南區", lat: 22.95635, lng: 120.18779 },
    { name: "臺南市北區", lat: 23.00852, lng: 120.20800 },
    { name: "臺南市安平區", lat: 22.99342, lng: 120.16471 },
    { name: "臺南市安南區", lat: 23.05853, lng: 120.13583 },
    { name: "臺南市永康區", lat: 23.02118, lng: 120.26279 },
    { name: "臺南市歸仁區", lat: 22.95193, lng: 120.28588 },
    { name: "臺南市新化區", lat: 23.02809, lng: 120.33202 },
    { name: "臺南市左鎮區", lat: 23.03008, lng: 120.42424 },
    { name: "臺南市玉井區", lat: 23.10608, lng: 120.47033 },
    { name: "臺南市楠西區", lat: 23.18202, lng: 120.51639 },
    { name: "臺南市南化區", lat: 23.10791, lng: 120.56245 },
    { name: "臺南市仁德區", lat: 22.94726, lng: 120.25118 },
    { name: "臺南市關廟區", lat: 22.96371, lng: 120.33202 },
    { name: "臺南市龍崎區", lat: 22.95400, lng: 120.37814 },
    { name: "臺南市官田區", lat: 23.19488, lng: 120.35508 },
    { name: "臺南市麻豆區", lat: 23.17634, lng: 120.23973 },
    { name: "臺南市佳里區", lat: 23.16945, lng: 120.17048 },
    { name: "臺南市西港區", lat: 23.12579, lng: 120.19934 },
    { name: "臺南市七股區", lat: 23.11952, lng: 120.10118 },
    { name: "臺南市將軍區", lat: 23.20549, lng: 120.10118 },
    { name: "臺南市學甲區", lat: 23.25538, lng: 120.17048 },
    { name: "臺南市北門區", lat: 23.28660, lng: 120.12429 },
    { name: "臺南市新營區", lat: 23.31196, lng: 120.30895 },
    { name: "臺南市後壁區", lat: 23.36651, lng: 120.35508 },
    { name: "臺南市白河區", lat: 23.33364, lng: 120.45881 },
    { name: "臺南市東山區", lat: 23.28250, lng: 120.44728 },
    { name: "臺南市六甲區", lat: 23.24268, lng: 120.33202 },
    { name: "臺南市下營區", lat: 23.22929, lng: 120.26858 },
    { name: "臺南市柳營區", lat: 23.28070, lng: 120.35508 },
    { name: "臺南市鹽水區", lat: 23.26223, lng: 120.23973 },
    { name: "臺南市善化區", lat: 23.14026, lng: 120.30895 },
    { name: "臺南市新市區", lat: 23.07803, lng: 120.29192 },
    { name: "臺南市大內區", lat: 23.14220, lng: 120.40119 },
    { name: "臺南市山上區", lat: 23.08931, lng: 120.37237 },
    { name: "臺南市安定區", lat: 23.09079, lng: 120.23344 },
    { name: "高雄市新興區", lat: 22.62839, lng: 120.30607 },
    { name: "高雄市前金區", lat: 22.62525, lng: 120.29535 },
    { name: "高雄市苓雅區", lat: 22.62688, lng: 120.32625 },
    { name: "高雄市鹽埕區", lat: 22.62352, lng: 120.28374 },
    { name: "高雄市鼓山區", lat: 22.64959, lng: 120.26858 },
    { name: "高雄市旗津區", lat: 22.61418, lng: 120.26594 },
    { name: "高雄市前鎮區", lat: 22.59708, lng: 120.31472 },
    { name: "高雄市三民區", lat: 22.64834, lng: 120.32625 },
    { name: "高雄市楠梓區", lat: 22.71754, lng: 120.30319 },
    { name: "高雄市小港區", lat: 22.55532, lng: 120.36085 },
    { name: "高雄市左營區", lat: 22.68774, lng: 120.29165 },
    { name: "高雄市仁武區", lat: 22.70580, lng: 120.34236 },
    { name: "高雄市大社區", lat: 22.73771, lng: 120.36085 },
    { name: "高雄市東沙群島", lat: 23.90369, lng: 121.07937 },
    { name: "高雄市南沙群島", lat: 10.72328, lng: 115.82647 },
    { name: "高雄市岡山區", lat: 22.80165, lng: 120.28588 },
    { name: "高雄市路竹區", lat: 22.84940, lng: 120.26281 },
    { name: "高雄市阿蓮區", lat: 22.87786, lng: 120.33202 },
    { name: "高雄市田寮區", lat: 22.86335, lng: 120.40119 },
    { name: "高雄市燕巢區", lat: 22.78237, lng: 120.37814 },
    { name: "高雄市橋頭區", lat: 22.75390, lng: 120.30896 },
    { name: "高雄市梓官區", lat: 22.74861, lng: 120.25704 },
    { name: "高雄市彌陀區", lat: 22.78322, lng: 120.24550 },
    { name: "高雄市永安區", lat: 22.81127, lng: 120.23973 },
    { name: "高雄市湖內區", lat: 22.89542, lng: 120.22242 },
    { name: "高雄市鳳山區", lat: 22.61136, lng: 120.34932 },
    { name: "高雄市大寮區", lat: 22.58448, lng: 120.40119 },
    { name: "高雄市林園區", lat: 22.49868, lng: 120.40119 },
    { name: "高雄市鳥松區", lat: 22.66021, lng: 120.37237 },
    { name: "高雄市大樹區", lat: 22.70837, lng: 120.42424 },
    { name: "高雄市旗山區", lat: 22.87025, lng: 120.47033 },
    { name: "高雄市美濃區", lat: 22.88538, lng: 120.55094 },
    { name: "高雄市六龜區", lat: 23.00262, lng: 120.65450 },
    { name: "高雄市內門區", lat: 22.95601, lng: 120.47033 },
    { name: "高雄市杉林區", lat: 23.00079, lng: 120.56245 },
    { name: "高雄市甲仙區", lat: 23.11459, lng: 120.63149 },
    { name: "高雄市桃源區", lat: 23.22808, lng: 120.84989 },
    { name: "高雄市那瑪夏區", lat: 23.27430, lng: 120.73500 },
    { name: "高雄市茂林區", lat: 22.93194, lng: 120.73500 },
    { name: "高雄市茄萣區", lat: 22.87635, lng: 120.21088 },
    { name: "澎湖縣馬公市", lat: 23.57063, lng: 119.57746 },
    { name: "澎湖縣西嶼鄉", lat: 23.60546, lng: 119.51367 },
    { name: "澎湖縣望安鄉", lat: 23.38333, lng: 119.5 },
    { name: "澎湖縣七美鄉", lat: 23.20878, lng: 119.43534 },
    { name: "澎湖縣白沙鄉", lat: 23.66404, lng: 119.59485 },
    { name: "澎湖縣湖西鄉", lat: 23.57737, lng: 119.66151 },
    { name: "金門縣金沙鎮", lat: 24.48111, lng: 118.42799 },
    { name: "金門縣金湖鎮", lat: 24.43769, lng: 118.42799 },
    { name: "金門縣金寧鄉", lat: 24.45658, lng: 118.30585 },
    { name: "金門縣金城鎮", lat: 24.43206, lng: 118.31551 },
    { name: "金門縣烈嶼鄉", lat: 24.42886, lng: 118.24755 },
    { name: "金門縣烏坵鄉", lat: 24.99178, lng: 119.45130 },
    { name: "屏東縣屏東市", lat: 22.65584, lng: 120.47033 },
    { name: "屏東縣三地門鄉", lat: 22.81331, lng: 120.68901 },
    { name: "屏東縣霧臺鄉", lat: 22.75099, lng: 120.78097 },
    { name: "屏東縣瑪家鄉", lat: 22.69036, lng: 120.63788 },
    { name: "屏東縣九如鄉", lat: 22.74161, lng: 120.47033 },
    { name: "屏東縣里港鄉", lat: 22.79624, lng: 120.51639 },
    { name: "屏東縣高樹鄉", lat: 22.82549, lng: 120.60038 },
    { name: "屏東縣鹽埔鄉", lat: 22.74368, lng: 120.56245 },
    { name: "屏東縣長治鄉", lat: 22.70083, lng: 120.56245 },
    { name: "屏東縣麟洛鄉", lat: 22.65065, lng: 120.52721 },
    { name: "屏東縣竹田鄉", lat: 22.59391, lng: 120.53267 },
    { name: "屏東縣內埔鄉", lat: 22.61513, lng: 120.56632 },
    { name: "屏東縣萬丹鄉", lat: 22.59152, lng: 120.47033 },
    { name: "屏東縣潮州鎮", lat: 22.52942, lng: 120.56245 },
    { name: "屏東縣泰武鄉", lat: 22.57795, lng: 120.63480 },
    { name: "屏東縣來義鄉", lat: 22.49217, lng: 120.62472 },
    { name: "屏東縣萬巒鄉", lat: 22.58405, lng: 120.60848 },
    { name: "屏東縣崁頂鄉", lat: 22.51476, lng: 120.51403 },
    { name: "屏東縣新埤鄉", lat: 22.48176, lng: 120.58547 },
    { name: "屏東縣南州鄉", lat: 22.47473, lng: 120.51639 },
    { name: "屏東縣林邊鄉", lat: 22.43470, lng: 120.51473 },
    { name: "屏東縣東港鎮", lat: 22.46288, lng: 120.47033 },
    { name: "屏東縣琉球鄉", lat: 22.34042, lng: 120.37151 },
    { name: "屏東縣佳冬鄉", lat: 22.42708, lng: 120.53942 },
    { name: "屏東縣新園鄉", lat: 22.47740, lng: 120.44215 },
    { name: "屏東縣枋寮鄉", lat: 22.39607, lng: 120.58547 },
    { name: "屏東縣枋山鄉", lat: 22.26064, lng: 120.65738 },
    { name: "屏東縣春日鄉", lat: 22.38518, lng: 120.68901 },
    { name: "屏東縣獅子鄉", lat: 22.24717, lng: 120.73500 },
    { name: "屏東縣車城鄉", lat: 22.08431, lng: 120.74649 },
    { name: "屏東縣牡丹鄉", lat: 22.15202, lng: 120.78097 },
    { name: "屏東縣恆春鎮", lat: 22.00083, lng: 120.74476 },
    { name: "屏東縣滿州鄉", lat: 22.04385, lng: 120.83841 },
    { name: "臺東縣臺東市", lat: 22.76132, lng: 121.14382 },
    { name: "臺東縣綠島鄉", lat: 22.65811, lng: 121.48561 },
    { name: "臺東縣蘭嶼鄉", lat: 22.04356, lng: 121.54842 },
    { name: "臺東縣延平鄉", lat: 22.93200, lng: 121.03351 },
    { name: "臺東縣卑南鄉", lat: 22.78482, lng: 121.08344 },
    { name: "臺東縣鹿野鄉", lat: 22.95805, lng: 121.15958 },
    { name: "臺東縣關山鎮", lat: 23.04956, lng: 121.16463 },
    { name: "臺東縣海端鄉", lat: 23.13056, lng: 121.17569 },
    { name: "臺東縣池上鄉", lat: 23.12073, lng: 121.21618 },
    { name: "臺東縣東河鄉", lat: 23.06917, lng: 121.28552 },
    { name: "臺東縣成功鎮", lat: 23.12615, lng: 121.36560 },
    { name: "臺東縣長濱鄉", lat: 23.34518, lng: 121.43419 },
    { name: "臺東縣太麻里鄉", lat: 22.61555, lng: 121.00761 },
    { name: "臺東縣金峰鄉", lat: 22.56041, lng: 120.87286 },
    { name: "臺東縣大武鄉", lat: 22.41420, lng: 120.90730 },
    { name: "臺東縣達仁鄉", lat: 22.39906, lng: 120.82692 },
    { name: "花蓮縣花蓮市", lat: 23.99107, lng: 121.61119 },
    { name: "花蓮縣新城鄉", lat: 24.03271, lng: 121.60437 },
    { name: "花蓮縣秀林鄉", lat: 24.22586, lng: 121.53700 },
    { name: "花蓮縣吉安鄉", lat: 23.97320, lng: 121.58418 },
    { name: "花蓮縣壽豐鄉", lat: 23.85934, lng: 121.55983 },
    { name: "花蓮縣鳳林鎮", lat: 23.74438, lng: 121.45704 },
    { name: "花蓮縣光復鄉", lat: 23.63506, lng: 121.42276 },
    { name: "花蓮縣豐濱鄉", lat: 23.58519, lng: 121.50274 },
    { name: "花蓮縣瑞穗鄉", lat: 23.52056, lng: 121.41133 },
    { name: "花蓮縣萬榮鄉", lat: 23.72457, lng: 121.30841 },
    { name: "花蓮縣玉里鎮", lat: 23.38982, lng: 121.37703 },
    { name: "花蓮縣卓溪鄉", lat: 23.40401, lng: 121.21685 },
    { name: "花蓮縣富里鄉", lat: 23.15442, lng: 121.28552 }
];

const WORLD_CITIES = [
    { name: "日本大阪", lat: 34.6937, lng: 135.5023 },
    { name: "日本東京", lat: 35.6762, lng: 139.6503 },
    { name: "日本京都", lat: 35.0116, lng: 135.7681 },
    { name: "日本沖繩", lat: 26.2124, lng: 127.6809 },
    { name: "日本北海道", lat: 43.0641, lng: 141.3469 },
    { name: "韓國首爾", lat: 37.5665, lng: 126.9780 },
    { name: "韓國釜山", lat: 35.1796, lng: 129.0756 }
];

function localReverseGeocode(lat, lng) {
    if (!lat || !lng) return "";
    let minDistance = Infinity;
    let nearestCity = "未知區域";
    
    TAIWAN_CITIES.forEach(city => {
        const dist = Math.sqrt(Math.pow(city.lat - lat, 2) + Math.pow(city.lng - lng, 2));
        if (dist < minDistance) {
            minDistance = dist;
            nearestCity = city.name;
        }
    });
    
    // Only return if it's reasonably close (e.g. within 0.25 degrees, which is ~25km)
    if (minDistance < 0.25) {
        return nearestCity;
    }
    return "台灣區域";
}

/**
 * Format address uniformly based on location name and coordinates
 */
function formatAddressUniform(location, lat, lng, rawAddress = "") {
    if (!location) return "";
    
    // 1. If it's a home location
    if (location.includes("家")) {
        const homeCoords = getHomeCoordinates(location);
        return homeCoords ? homeCoords.address : location;
    }
    
    // 2. If there are coordinates, reverse geocode them
    if (lat && lng) {
        // Check if coordinates are outside Taiwan's bounding box (international/abroad!)
        // Taiwan bounding box (including islands): Lat 21.8 to 26.4, Lng 118.0 to 122.1
        const isOutsideTaiwan = (lat < 21.5 || lat > 26.5 || lng < 118.0 || lng > 122.2);
        if (isOutsideTaiwan) {
            // Find nearest international city
            let minDistance = Infinity;
            let nearestWorldCity = "";
            WORLD_CITIES.forEach(city => {
                const dist = Math.sqrt(Math.pow(city.lat - lat, 2) + Math.pow(city.lng - lng, 2));
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestWorldCity = city.name;
                }
            });
            
            // If reasonably close to a major international hub (within 2.0 degrees, ~200km)
            if (minDistance < 2.0) {
                return nearestWorldCity;
            }
            
            // Country clues
            if (location.includes("日本")) return "日本區域";
            if (location.includes("韓國")) return "韓國區域";
            return location + " (國外)";
        }
        
        // Inside Taiwan - use the comprehensive 368 townships database!
        return localReverseGeocode(lat, lng);
    }
    
    // 3. If no coordinates, check if location includes country names
    if (location.includes("日本")) {
        if (location.includes("東京")) return "日本東京";
        if (location.includes("京都")) return "日本京都";
        if (location.includes("沖繩")) return "日本沖繩";
        if (location.includes("北海道")) return "日本北海道";
        return "日本大阪"; // default
    }
    if (location.includes("韓國")) {
        if (location.includes("釜山")) return "韓國釜山";
        return "韓國首爾"; // default
    }
    
    // 4. Check if rawAddress already has clean county/township/district resolved
    if (rawAddress && 
        rawAddress !== "手動校正位置" && 
        rawAddress !== "手動定位" && 
        !rawAddress.includes("手動") &&
        (rawAddress.includes("縣") || rawAddress.includes("市")) &&
        (rawAddress.includes("區") || rawAddress.includes("鎮") || rawAddress.includes("鄉") || rawAddress.includes("市"))) {
        
        // Extract the clean part (e.g. "苗栗縣竹南鎮" from "苗栗縣竹南鎮 (NU Pasta)")
        const match = rawAddress.match(/^([^(\s]+)/);
        if (match && match[1]) {
            return match[1].trim();
        }
        return rawAddress.split('(')[0].trim();
    }
    
    // 5. If no coordinates, apply clean brief mappings for standard location names
    const briefMappings = {
        "公館": "苗栗縣公館鄉",
        "竹南": "苗栗縣竹南鎮",
        "頭份": "苗栗縣頭份市",
        "新竹": "新竹市東區",
        "大溪": "桃園市大溪區",
        "新豐": "新竹縣新豐鄉",
        "竹北": "新竹縣竹北市",
        "三峽": "新北市三峽區",
        "中壢": "桃園市中壢區",
        "龍潭": "桃園市龍潭區",
        "玉井": "台南市玉井區",
        "楠梓": "高雄市楠梓區",
        "左鎮": "台南市左鎮區",
        "新屋": "桃園市新屋區",
        "大園": "桃園市大園區",
        "六甲": "台南市六甲區",
        "前金": "高雄市前金區",
        "鳳山": "高雄市鳳山區",
        "三民": "高雄市三民區",
        "嘉義": "嘉義市東區",
        "大阪": "日本大阪",
        "東京": "日本東京",
        "京都": "日本京都",
        "首爾": "韓國首爾",
        "釜山": "韓國釜山"
    };
    
    if (briefMappings[location]) {
        return briefMappings[location];
    }
    
    // 6. Fallback to location
    return location;
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
                    🏢 ${formatAddressUniform(group.location, group.lat, group.lng, group.address)}
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
            closeButton: false,
            autoPan: false
        });
        
        // Trigger popup Lucide icons refresh after opening
        marker.on('popupopen', () => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        });
        
        // Map bidirection interaction (marker click highlights timeline card of the latest visit)
        marker.on('click', () => {
            panToMarkerWithOffset(marker, group.lat, group.lng);
            
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
/**
 * Fly to marker and pan with vertical offset to center marker in lower half,
 * preventing popups from being cut off or pushing the marker out of view.
 */
function panToMarkerWithOffset(marker, lat, lng) {
    if (!map) return;
    
    const mapZoom = map.getZoom() < 14 ? 14 : map.getZoom();
    const targetLatLng = L.latLng(lat, lng);
    
    // Project latlng to container point at target zoom
    const targetPoint = map.project(targetLatLng, mapZoom);
    
    // Calculate offset (20% of map height) to shift center upwards
    // which positions the marker lower in the viewport
    const mapHeight = map.getSize().y;
    const verticalOffset = mapHeight * 0.20;
    
    targetPoint.y -= verticalOffset;
    
    const offsetLatLng = map.unproject(targetPoint, mapZoom);
    
    map.flyTo(offsetLatLng, mapZoom, {
        duration: 1.2
    });
}

function focusMarker(recordIndex, lat, lng) {
    const marker = mapMarkers[recordIndex];
    
    if (lat && lng) {
        panToMarkerWithOffset(marker, lat, lng);
        
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
