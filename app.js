/* ==========================================================================
   Our Food Map - Core Application Controller (app.js)
   Manages CSV data parsing, state overrides, search, UI rendering, and CRUD operations.
   ========================================================================== */

// Safe LocalStorage Fallback for Incognito / file:// protocol
let localStorageInstance = null;
try {
    localStorageInstance = window.localStorage;
    const testKey = '__storage_test__';
    localStorageInstance.setItem(testKey, testKey);
    localStorageInstance.removeItem(testKey);
} catch (e) {
    console.warn("LocalStorage is blocked by browser security (Incognito or file://). Using in-memory fallback.");
    const memoryStorage = {};
    localStorageInstance = {
        getItem(key) {
            return memoryStorage[key] !== undefined ? memoryStorage[key] : null;
        },
        setItem(key, value) {
            memoryStorage[key] = String(value);
        },
        removeItem(key) {
            delete memoryStorage[key];
        },
        clear() {
            for (const key in memoryStorage) delete memoryStorage[key];
        }
    };
}
const safeStorage = localStorageInstance;

// Base records loaded from CSV
let baseRecords = [];
// Overrides saved in Local Storage (to merge with base records)
// Format: { added: [rec], edited: { index: rec }, deleted: [index] }
let localOverrides = { added: [], edited: {}, deleted: [] };
// Unified records after merging
let activeRecords = [];
// Coordinates lookup database
let coordsDb = {};

// Active Filter States
let activeYear = 'all';
let searchQuery = '';
let isDescending = true; // Default: newest first
let activeCategory = null; // Filter by food category name


// Sheet source URL key in LocalStorage
const STORAGE_SHEET_URL_KEY = 'food_map_sheet_url';
const STORAGE_GAS_URL_KEY = 'food_map_gas_url';
const STORAGE_OVERRIDES_KEY = 'food_map_overrides';
const STORAGE_COORDS_OVERRIDES_KEY = 'food_map_coords_overrides';

// Default CSV path (pointing directly to your live Google Sheet)
const DEFAULT_CSV_PATH = 'https://docs.google.com/spreadsheets/d/1Kxl_tLb3vDVVk4AAAW4n7qm_OWE5d9YCU6AMttpnAvQ/export?format=csv';
const DEFAULT_COORDS_PATH = 'coords_db.json';

// Hardcoded Google Apps Script Web App API URL (for phone-to-sheet sync)
// 請在此填入您的 Google Apps Script 網頁應用程式網址，格式為：https://script.google.com/macros/s/xxxx/exec
const HARDCODED_GAS_URL = 'https://script.google.com/macros/s/AKfycbxzj9GLRhG0nfx5c_Smewdz4FiOpfdzyQE6GOi5Yh5y1-uE0JCIUh4PLceAeliygiQO/exec';


// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Leaflet Map
    const savedTheme = safeStorage.getItem('food_map_theme') || 'light';
    document.body.className = savedTheme + '-mode';
    initMap(savedTheme);
    
    // 2. Load Coordinates Database
    await loadCoordsDb();
    
    // 3. Load Data & Render
    await loadDataAndRender();
    
    // 4. Setup Event Listeners
    setupEventListeners();
    
    // 5. Initialize Lucide Icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    // 6. Trigger background auto-fix for historic coordinates addresses
    autoFixCoordsAddresses();
});

/**
 * Load Coordinates Database
 */
async function loadCoordsDb() {
    try {
        const response = await fetch(DEFAULT_COORDS_PATH);
        coordsDb = await response.json();
        
        // Merge with local coordinates overrides
        const savedCoords = safeStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY);
        if (savedCoords) {
            try {
                const overrides = JSON.parse(savedCoords);
                coordsDb = { ...coordsDb, ...overrides };
                console.log(`Loaded ${Object.keys(overrides).length} custom coordinate overrides.`);
            } catch (err) {
                console.error("Failed to parse custom coordinates overrides:", err);
            }
        }
        console.log(`Loaded coordinates database with ${Object.keys(coordsDb).length} locations.`);
    } catch (e) {
        console.error("Failed to load coordinates database:", e);
    }
}

/**
 * Main Data Loader and Renderer
 */
async function loadDataAndRender() {
    // 1. Get Google Sheets Apps Script URL (hardcoded has priority, fallback to local storage)
    const customGasUrl = (HARDCODED_GAS_URL && HARDCODED_GAS_URL !== '您的_GOOGLE_APPS_SCRIPT_API_網址') 
        ? HARDCODED_GAS_URL 
        : (safeStorage.getItem(STORAGE_GAS_URL_KEY) || '');
        
    const customSheetUrl = safeStorage.getItem(STORAGE_SHEET_URL_KEY);
    
    // 2. Load LocalStorage Overrides
    const savedOverrides = safeStorage.getItem(STORAGE_OVERRIDES_KEY);
    if (savedOverrides) {
        try {
            localOverrides = JSON.parse(savedOverrides);
        } catch (e) {
            console.error("Failed to parse local overrides:", e);
        }
    }
    
    try {
        let loadedFromGas = false;
        
        if (customGasUrl) {
            try {
                console.log(`Fetching real-time JSON from GAS API: ${customGasUrl}`);
                const response = await fetch(customGasUrl);
                baseRecords = await response.json();
                console.log(`Loaded ${baseRecords.length} real-time records from Google Sheets.`);
                loadedFromGas = true;
            } catch (gasErr) {
                console.warn("GAS API fetch failed or redirected. Falling back to static/published CSV:", gasErr);
            }
        }
        
        if (!loadedFromGas) {
            let csvUrl = customSheetUrl || DEFAULT_CSV_PATH;
            
            // Automatically convert a standard Google Sheets browser URL to a raw CSV export link
            if (csvUrl && csvUrl.includes('docs.google.com/spreadsheets')) {
                const match = csvUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
                if (match) {
                    csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
                    console.log(`Formatted Google Sheet URL to CSV export link: ${csvUrl}`);
                }
            }
            
            console.log(`Fetching data from CSV: ${csvUrl}`);
            const response = await fetch(csvUrl);
            const rawCsvText = await response.text();
            
            // Parse CSV to JSON
            baseRecords = parseCSV(rawCsvText);
            console.log(`Parsed ${baseRecords.length} CSV records.`);
        }
        
        // 3. Merge base records with Local Storage Overrides
        mergeRecords();
        
        // 4. Apply Filters and Render Page
        applyFiltersAndRender(true); // Animate path on initial load
        
    } catch (e) {
        console.error("Error loading record data:", e);
        // Fallback: If fetch fails (e.g. offline), try to render using overrides only
        mergeRecords();
        applyFiltersAndRender(true);
    }
}

/**
 * Parse standard CSV string to Array of Objects
 */
function parseCSV(text) {
    const lines = [];
    let row = [""];
    let inQuotes = false;
    
    // Custom robust CSV parser to handle nested commas and quotes correctly
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i+1];
        
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') i++;
            lines.push(row);
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    
    if (lines.length < 2) return [];
    
    const headers = lines[0].map(h => h.trim());
    const records = [];
    
    for (let idx = 1; idx < lines.length; idx++) {
        const line = lines[idx];
        if (line.length < 3 || !line[0].trim()) continue;
        
        const record = {};
        headers.forEach((header, colIdx) => {
            let fieldName = header;
            if (header === '時間') fieldName = 'date';
            else if (header === '地點') fieldName = 'location';
            else if (header === '餐廳/美食') fieldName = 'food';
            else if (header === '緯度' || header.toLowerCase() === 'latitude' || header.toLowerCase() === 'lat') fieldName = 'lat';
            else if (header === '經度' || header.toLowerCase() === 'longitude' || header.toLowerCase() === 'lng' || header.toLowerCase() === 'lon') fieldName = 'lng';
            
            record[fieldName] = line[colIdx] ? line[colIdx].trim() : '';
        });
        
        // Add index for state tracking
        record.index = idx - 1;
        records.push(record);
    }
    
    return records;
}

/**
 * Merge base records with Local Storage Overrides
 */
function mergeRecords() {
    activeRecords = [];
    
    // 1. Process base records (applying edits and deletions)
    baseRecords.forEach((rec, idx) => {
        // Skip deleted
        if (localOverrides.deleted.includes(idx)) return;
        
        // Check for edit override
        if (localOverrides.edited[idx]) {
            activeRecords.push({
                ...rec,
                ...localOverrides.edited[idx],
                index: idx,
                source: 'base-edited'
            });
        } else {
            activeRecords.push({
                ...rec,
                index: idx,
                source: 'base'
            });
        }
    });
    
    // 2. Append new additions
    localOverrides.added.forEach((rec, localIdx) => {
        // Add pseudo-index for additions
        activeRecords.push({
            ...rec,
            index: `added-${localIdx}`,
            source: 'added'
        });
    });
}

/**
 * Filter, Sort and Render both the List UI and the Map polyline
 */
function applyFiltersAndRender(animatePath = false) {
    // 1. Apply Year, Search & Category Filters
    let filtered = activeRecords.filter(rec => {
        // Year filter
        if (activeYear !== 'all') {
            const yearStr = rec.date.split('/')[0];
            const targetYearTwoDigits = activeYear.slice(-2);
            if (yearStr !== targetYearTwoDigits) return false;
        }
        
        // Category filter
        if (activeCategory) {
            const cat = classifyFoodCategory(rec.location, rec.food);
            if (cat.name !== activeCategory) return false;
        }
        
        // Search query filter (matches date, location, or food/restaurant)
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const dateMatch = rec.date.toLowerCase().includes(q);
            const locMatch = rec.location.toLowerCase().includes(q);
            const foodMatch = rec.food.toLowerCase().includes(q);
            if (!dateMatch && !locMatch && !foodMatch) return false;
        }
        
        return true;
    });
    
    // 2. Sort Records
    filtered.sort((a, b) => {
        const timeA = parseDate(a.date).getTime();
        const timeB = parseDate(b.date).getTime();
        return isDescending ? timeB - timeA : timeA - timeB;
    });
    
    // Save filtered records globally for details drawer
    window.currentFilteredRecords = filtered;

    // 3. Render Stats counters based on filtered records
    renderStats(filtered);
    
    // 4. Render Cards List in DOM
    renderCardsList(filtered);
    
    // 5. Render Map polyline path and markers
    updateMapTrail(filtered, coordsDb, animatePath);
    
    // 6. Update Stats Details drawer if open
    updateStatsDetails();
}

/**
 * Helper: Parse YY/MM/DD to Javascript Date object
 */
function parseDate(dateStr) {
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

/**
 * Helper: Format any date string to clean YYYY/MM/DD display format.
 * Prevents GMT or long timestamp strings from cluttering the UI.
 */
function formatDateToDisplay(dateStr) {
    if (!dateStr) return '';
    
    const trimmed = dateStr.trim();
    // Check if it's already in clean yy/mm/dd or yyyy/mm/dd format and has no GMT/alphabetic chars
    const cleanPattern = /^\d{2,4}\/\d{2}\/\d{2}$/;
    if (cleanPattern.test(trimmed)) {
        if (trimmed.length === 8) {
            return `20${trimmed}`;
        }
        return trimmed;
    }
    
    const dateObj = parseDate(trimmed);
    if (isNaN(dateObj.getTime()) || dateObj.getTime() === 0) {
        return trimmed;
    }
    
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
}

/**
 * Render Header Statistics Dashboard
 */
function renderStats(records) {
    const targetRecords = records || activeRecords;
    
    if (targetRecords.length === 0) {
        document.getElementById('stat-days').innerText = "0 天";
        document.getElementById('stat-locations').innerText = "0 個地區";
        document.getElementById('stat-meals').innerText = "0 次";
        return;
    }
    
    // Calculate dates spread
    const dates = targetRecords.map(r => parseDate(r.date)).sort((a,b) => a-b);
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const daysTogether = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calculate unique locations
    const uniqueLocs = new Set();
    targetRecords.forEach(r => {
        // Clean up location name (e.g. "竹南家" and "竹南" can be grouped, or keep them exact)
        const cleanLoc = r.location.replace("家", "").trim();
        if (cleanLoc) uniqueLocs.add(cleanLoc);
    });
    
    // Update elements
    document.getElementById('stat-days').innerText = `${daysTogether} 天`;
    document.getElementById('stat-locations').innerText = `${uniqueLocs.size} 個地區`;
    document.getElementById('stat-meals').innerText = `${targetRecords.length} 次`;
}

/**
 * Render Timeline Food Cards in the DOM
 */
function renderCardsList(records) {
    const container = document.getElementById('cards-container');
    const noResults = document.getElementById('no-results');
    
    container.innerHTML = '';
    
    if (records.length === 0) {
        noResults.classList.remove('hidden');
        return;
    }
    noResults.classList.add('hidden');
    
    // Find absolute champion location in the entire activeRecords dataset to mark with a crown
    const locCounts = {};
    activeRecords.forEach(r => {
        const cleanLoc = r.location.trim();
        if (cleanLoc) {
            locCounts[cleanLoc] = (locCounts[cleanLoc] || 0) + 1;
        }
    });
    const sortedActiveLocs = Object.keys(locCounts).sort((a,b) => locCounts[b] - locCounts[a]);
    const championLoc = sortedActiveLocs[0];
    const maxVisits = championLoc ? locCounts[championLoc] : 0;
    
    records.forEach(rec => {
        const key = `${rec.location}|${rec.food}`;
        const coord = coordsDb[key];
        const isHome = rec.location.includes("家");
        const homeClass = isHome ? 'home-tag' : '';
        const homeIcon = isHome ? '<i data-lucide="home" style="width:0.85rem;height:0.85rem;"></i>' : '<i data-lucide="map-pin" style="width:0.85rem;height:0.85rem;"></i>';
        
        // Show golden crown if this location is the champion spot (with more than 1 visit)
        const isChampion = rec.location === championLoc && maxVisits > 1;
        const crownHtml = isChampion ? '<span style="color:#eab308;margin-left:0.25rem;" title="冠軍踩點熱點！👑">👑</span>' : '';
        
        // Clean restaurant name and check for comments in parentheses
        let shopName = rec.food;
        let noteText = '';
        
        // Extract note in bracket e.g. "陶板屋（精靈生日）" -> Note is "精靈生日"
        const bracketMatch = rec.food.match(/[\uff08\u0028]([^\uff09\u0029]*)[\uff09\u0029]/);
        if (bracketMatch) {
            noteText = `<span class="card-note">${bracketMatch[1]}</span>`;
            shopName = rec.food.replace(bracketMatch[0], "").trim();
        }
        
        // Find accurate coordinates for this record card (home calibrated, sheet direct coords, or coordsDb)
        let lat = null;
        let lng = null;
        let address = "";
        
        const homeCoords = getHomeCoordinates(rec.location);
        if (homeCoords) {
            lat = homeCoords.lat;
            lng = homeCoords.lng;
            address = homeCoords.address;
        } else if (rec.lat && rec.lng) {
            lat = parseFloat(rec.lat);
            lng = parseFloat(rec.lng);
            address = "Google 試算表直接定位";
        } else if (coord) {
            lat = coord.lat;
            lng = coord.lng;
            address = coord.address || "";
        }
        
        // Setup direct Google Maps Link
        const cleanShop = shopName.split(/[，,]/)[0].trim();
        const searchLoc = isHome ? rec.location : `${rec.location} ${cleanShop}`;
        const gmapsLink = (lat && lng) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchLoc)}`;
        
        const cleanAddress = formatAddressUniform(rec.location, lat, lng, address);
        const addressText = cleanAddress ? 
            `<div class="card-address"><i data-lucide="compass"></i> <span>${cleanAddress}</span></div>` : '';
            
        // Build card HTML
        const card = document.createElement('div');
        card.className = 'food-card';
        card.id = `card-rec-${rec.index}`;
        card.innerHTML = `
            <div class="card-header-row">
                <div class="card-badges">
                    <span class="date-badge">${formatDateToDisplay(rec.date)}</span>
                    <span class="location-tag ${homeClass}">
                        ${homeIcon} <span>${rec.location}${crownHtml}</span>
                    </span>
                </div>
            </div>
            <div class="card-content">
                <h3>${shopName}</h3>
                ${noteText}
                ${addressText}
            </div>
            <div class="card-actions">
                <a href="${gmapsLink}" target="_blank" class="btn-card-action btn-gmaps" title="在 Google Maps 中查看導航">
                    <i data-lucide="map"></i> <span>導航</span>
                </a>
                <button class="btn-card-action btn-edit" onclick="event.stopPropagation(); openEditModal('${rec.index}')" title="編輯足跡">
                    <i data-lucide="edit-3"></i> <span>編輯</span>
                </button>
                <button class="btn-card-action btn-delete" onclick="event.stopPropagation(); deleteRecord('${rec.index}')" title="刪除足跡">
                    <i data-lucide="trash-2"></i> <span>刪除</span>
                </button>
            </div>
        `;
        
        // Add card interaction triggers (highlights marker on card hover)
        card.addEventListener('mouseenter', () => {
            highlightMapMarker(rec.index, true);
        });
        card.addEventListener('mouseleave', () => {
            highlightMapMarker(rec.index, false);
        });
        
        // Focus on map point on click
        card.addEventListener('click', () => {
            focusMarker(rec.index, lat, lng);
            // Visual highlight active card
            document.querySelectorAll('.food-card').forEach(c => c.classList.remove('active-highlight'));
            card.classList.add('active-highlight');
        });
        
        container.appendChild(card);
    });
    
    // Refresh icons inside dynamically appended cards
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Scroll and highlight timeline card when a map marker is clicked
 */
window.highlightTimelineCard = function(recordIndex) {
    // 1. Remove highlight classes from all cards
    document.querySelectorAll('.food-card').forEach(c => c.classList.remove('active-highlight'));
    
    
    
    // 2. Select card and scroll to it smoothly
    const card = document.getElementById(`card-rec-${recordIndex}`);
    if (card) {
        card.classList.add('active-highlight');
        card.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }
};

/**
 * Save Overrides to Local Storage and re-render
 */
function saveOverridesAndRender() {
    safeStorage.setItem(STORAGE_OVERRIDES_KEY, JSON.stringify(localOverrides));
    mergeRecords();
    applyFiltersAndRender(false); // don't animate line path on minor CRUD update to prevent flickering
}

/**
 * Delete a food record
 */
window.deleteRecord = async function(recordIndex) {
    if (!confirm("確定要刪除這筆美食足跡嗎？")) return;
    
    const customGasUrl = (HARDCODED_GAS_URL && HARDCODED_GAS_URL !== '您的_GOOGLE_APPS_SCRIPT_API_網址') 
        ? HARDCODED_GAS_URL 
        : (safeStorage.getItem(STORAGE_GAS_URL_KEY) || '');
        
    if (recordIndex.startsWith('added-')) {
        // Deleting a newly added local record
        const localIdx = parseInt(recordIndex.split('-')[1]);
        localOverrides.added.splice(localIdx, 1);
        saveOverridesAndRender();
    } else {
        // Deleting a base record
        const idx = parseInt(recordIndex);
        const rec = baseRecords.find(r => r.index === idx);
        
        if (customGasUrl && rec) {
            try {
                console.log(`Deleting record from Google Sheets via GAS index: ${idx}`, rec);
                const payload = {
                    action: "delete",
                    index: idx,
                    date: rec.date,
                    location: rec.location,
                    food: rec.food
                };
                
                const response = await fetch(customGasUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                
                console.log("Delete request sent successfully to Google Sheets!");
                
                // Clear any local overrides for this record
                if (localOverrides.edited[idx]) {
                    delete localOverrides.edited[idx];
                }
                
                // Fetch live data immediately from Google Sheets
                await loadDataAndRender();
                alert("🎉 成功！美食足跡已從您的 Google 試算表中刪除！");
                return;
            } catch (err) {
                console.error("Failed to delete from Google Sheets:", err);
                alert("⚠️ 連線更新 Google 試算表失敗，已改為先在您的本機網頁快取中刪除！");
            }
        }
        
        // Fallback local deletion
        if (!localOverrides.deleted.includes(idx)) {
            localOverrides.deleted.push(idx);
        }
        if (localOverrides.edited[idx]) {
            delete localOverrides.edited[idx];
        }
        saveOverridesAndRender();
    }
};

/**
 * Open Add/Edit Modal
 */
window.openEditModal = function(recordIndex) {
    const modal = document.getElementById('modal-card');
    const form = document.getElementById('form-card');
    const modalTitle = document.getElementById('modal-title');
    
    // Clear form
    form.reset();
    document.getElementById('form-edit-index').value = recordIndex || '';
    
    // Populate dropdown known locations
    populateLocationDropdown();
    
    if (recordIndex) {
        // Edit mode
        modalTitle.innerHTML = '<i data-lucide="edit" class="modal-icon"></i> 編輯美食足跡';
        
        let rec;
        if (recordIndex.startsWith('added-')) {
            const localIdx = parseInt(recordIndex.split('-')[1]);
            rec = localOverrides.added[localIdx];
        } else {
            const idx = parseInt(recordIndex);
            rec = localOverrides.edited[idx] || baseRecords.find(r => r.index === idx);
        }
        
        if (rec) {
            // Clean date format for input field (convert YYYY/MM/DD to YY/MM/DD)
            const displayD = formatDateToDisplay(rec.date);
            document.getElementById('form-date').value = displayD.startsWith("20") ? displayD.substring(2) : displayD;
            document.getElementById('form-location').value = rec.location;
            document.getElementById('form-food').value = rec.food;
            
            // Pre-fill custom coordinates if they exist in record or coordsDb
            const key = `${rec.location}|${rec.food}`;
            const homeCoords = getHomeCoordinates(rec.location);
            if (homeCoords) {
                document.getElementById('form-coords').value = `${homeCoords.lat.toFixed(6)}, ${homeCoords.lng.toFixed(6)}`;
            } else if (rec.lat && rec.lng) {
                document.getElementById('form-coords').value = `${parseFloat(rec.lat).toFixed(6)}, ${parseFloat(rec.lng).toFixed(6)}`;
            } else {
                const coord = coordsDb[key];
                if (coord && coord.lat && coord.lng) {
                    document.getElementById('form-coords').value = `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`;
                } else {
                    document.getElementById('form-coords').value = '';
                }
            }

        }
    } else {
        // Add mode
        modalTitle.innerHTML = '<i data-lucide="plus-circle" class="modal-icon"></i> 新增美食足跡';
        
        // Auto-fill today's date in YY/MM/DD format
        const today = new Date();
        const yy = String(today.getFullYear()).slice(-2);
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('form-date').value = `${yy}/${mm}/${dd}`;
        document.getElementById('form-coords').value = '';
    }
    
    modal.classList.add('active');
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
};

/**
 * Fill datalist with 32 unique location names
 */
function populateLocationDropdown() {
    const dl = document.getElementById('known-locations');
    dl.innerHTML = '';
    
    const uniqueLocs = new Set();
    activeRecords.forEach(r => uniqueLocs.add(r.location));
    
    // Add default common ones just in case
    ["竹南家", "頭份", "新竹", "新竹家", "高雄", "台南", "台北", "日本", "台中", "大溪家"].forEach(l => uniqueLocs.add(l));
    
    Array.from(uniqueLocs).sort().forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        dl.appendChild(option);
    });
}

/**
 * Setup UI Event Listeners
 */
function setupEventListeners() {
    // 1. Theme Toggle Button
    const btnTheme = document.getElementById('btn-theme-toggle');
    btnTheme.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark-mode');
        const newTheme = isDark ? 'light' : 'dark';
        document.body.className = newTheme + '-mode';
        safeStorage.setItem('food_map_theme', newTheme);
        setMapTheme(newTheme);
    });
    
    // 2. Year Pill Filter Tabs
    const tabs = document.querySelectorAll('.tab-pill');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeYear = tab.getAttribute('data-year');
            activeCategory = null; // Clear category filter when year changes
            applyFiltersAndRender(true); // Animate path when switching years
        });
    });
    
    // 3. Instant Search Input
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        activeCategory = null; // Reset category filter on manual search input
        if (searchQuery) {
            searchClear.classList.remove('hidden');
        } else {
            searchClear.classList.add('hidden');
        }
        applyFiltersAndRender(false);
    });
    
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        activeCategory = null; // Also clear category filter
        searchClear.classList.add('hidden');
        applyFiltersAndRender(false);
    });
    
    // 4. Sort Toggle
    const btnSort = document.getElementById('btn-sort');
    const sortDesc = document.querySelector('.icon-sort-desc');
    const sortAsc = document.querySelector('.icon-sort-asc');
    const sortText = document.getElementById('sort-text');
    
    btnSort.addEventListener('click', () => {
        isDescending = !isDescending;
        if (isDescending) {
            sortDesc.classList.remove('hidden');
            sortAsc.classList.add('hidden');
            sortText.innerText = "最新優先";
        } else {
            sortDesc.classList.add('hidden');
            sortAsc.classList.remove('hidden');
            sortText.innerText = "最舊優先";
        }
        applyFiltersAndRender(false);
    });
    
    // 5. Open Add Footprint Modal
    document.getElementById('btn-add-card').addEventListener('click', () => {
        openEditModal(null);
    });
    
    // 6. Close Modal Buttons
    document.getElementById('btn-close-card-modal').addEventListener('click', () => {
        document.getElementById('modal-card').classList.remove('active');
    });
    document.getElementById('btn-cancel-card').addEventListener('click', () => {
        document.getElementById('modal-card').classList.remove('active');
    });
    
    // 7. Form Submission (Add/Edit Card)
    const formCard = document.getElementById('form-card');
    formCard.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const recordIndex = document.getElementById('form-edit-index').value;
        const newRec = {
            date: document.getElementById('form-date').value.trim(),
            location: document.getElementById('form-location').value.trim(),
            food: document.getElementById('form-food').value.trim()
        };
        
        // Simple validation check
        if (!newRec.date || !newRec.location || !newRec.food) return;
        
        // Check for manual coordinates override
        const coordsInput = document.getElementById('form-coords').value.trim();
        const key = `${newRec.location}|${newRec.food}`;
        
        const homeCoords = getHomeCoordinates(newRec.location);
        if (homeCoords) {
            // Force calibrated home coordinates
            newRec.lat = homeCoords.lat;
            newRec.lng = homeCoords.lng;
            coordsDb[key] = homeCoords;
                } else if (coordsInput) {
            const coordParts = coordsInput.split(/[，,]/);
            if (coordParts.length === 2) {
                const lat = parseFloat(coordParts[0].trim());
                const lng = parseFloat(coordParts[1].trim());
                if (!isNaN(lat) && !isNaN(lng)) {
                    // Determine initial address (using instant local lookup fallback)
                    const initialAddress = localReverseGeocode(lat, lng);
                    
                    // Save in current memory
                    coordsDb[key] = {
                        lat: lat,
                        lng: lng,
                        address: initialAddress,
                        type: "restaurant"
                    };
                    
                    // Save in LocalStorage overrides
                    const savedOverrides = JSON.parse(safeStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY) || '{}');
                    savedOverrides[key] = coordsDb[key];
                    safeStorage.setItem(STORAGE_COORDS_OVERRIDES_KEY, JSON.stringify(savedOverrides));
                    console.log(`Saved manual coordinates override for: ${key} -> ${lat}, ${lng} -> ${initialAddress}`);
                    
                    // Asynchronously fetch and refine to precise online Nominatim address
                    (async () => {
                        const onlineAddress = await reverseGeocode(lat, lng);
                        if (onlineAddress) {
                            // Reload overrides from LocalStorage to avoid overwriting newer overrides
                            const latestOverrides = JSON.parse(safeStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY) || '{}');
                            if (latestOverrides[key]) {
                                latestOverrides[key].address = onlineAddress;
                                safeStorage.setItem(STORAGE_COORDS_OVERRIDES_KEY, JSON.stringify(latestOverrides));
                                
                                // Update in-memory coordsDb
                                if (coordsDb[key]) {
                                    coordsDb[key].address = onlineAddress;
                                }
                                console.log(`Asynchronously refined coordinate address to: ${onlineAddress}`);
                                applyFiltersAndRender(false);
                            }
                        }
                    })();
                    
                    // Put coordinates into newRec for posting to Google Sheets!
                    newRec.lat = lat;
                    newRec.lng = lng;
                }
            }
        } else {
            // Geocode coordinates on save if we don't have them in our local DB
            saveNewCoordsIfMissing(newRec.location, newRec.food);
            
            // Automatically pull coordinates from coordsDb if present
            if (coordsDb[key]) {
                newRec.lat = coordsDb[key].lat;
                newRec.lng = coordsDb[key].lng;
            }
        }

        
        const customGasUrl = (HARDCODED_GAS_URL && HARDCODED_GAS_URL !== '您的_GOOGLE_APPS_SCRIPT_API_網址') 
            ? HARDCODED_GAS_URL 
            : (safeStorage.getItem(STORAGE_GAS_URL_KEY) || '');
        
        // If we have Apps Script URL, sync to Google Sheet (either ADD or EDIT of a base record)
        if (customGasUrl && (!recordIndex || !recordIndex.startsWith('added-'))) {
            const submitBtn = formCard.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" style="width:1.1rem;height:1.1rem;margin-right:0.5rem;display:inline-block;animation:spin 1s linear infinite;"></i> <span>連線寫入 Google Sheet...</span>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            
            // Prepare payload with action and index
            const payload = {
                ...newRec,
                action: recordIndex ? "edit" : "add",
                index: recordIndex ? parseInt(recordIndex) : undefined
            };
            
            try {
                console.log(`Posting record to Google Sheets via GAS:`, payload);
                const response = await fetch(customGasUrl, {
                    method: 'POST',
                    mode: 'no-cors', // standard for GAS web apps cross-origin posting
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                
                console.log("Record synced successfully to Google Sheets!");
                
                // Clear any local edit override since it is now saved in the sheet
                if (recordIndex) {
                    delete localOverrides.edited[parseInt(recordIndex)];
                    safeStorage.setItem(STORAGE_OVERRIDES_KEY, JSON.stringify(localOverrides));
                }
                
                // Reset save button and close modal
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
                document.getElementById('modal-card').classList.remove('active');
                
                // Fetch live data immediately from Google Sheets
                await loadDataAndRender();
                alert(recordIndex ? "🎉 成功！美食足跡編輯已同步更新至您的 Google 試算表！" : "🎉 成功！美食足跡已即時同步寫入您的 Google 試算表！");
                return;
            } catch (err) {
                console.error("Failed to post to Google Sheets:", err);
                alert("⚠️ 連線更新 Google 試算表失敗，已改為先儲存在您的本機快取中！");
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        }
        
        if (!customGasUrl) {
            alert("⚠️ 溫馨提示：您尚未在右上角 ⚙️「同步試算表」中設定 Google Apps Script API 網址，因此此筆足跡【目前僅儲存在您這台手機/電腦的本機網頁快取中】，尚未同步寫入您的 Google 試算表！\n\n如需即時同步寫入試算表，請部署並設定您的 API 網址！");
        }
        
        if (recordIndex) {
            // EDIT Mode (fallback local storage)
            if (recordIndex.startsWith('added-')) {
                const localIdx = parseInt(recordIndex.split('-')[1]);
                localOverrides.added[localIdx] = newRec;
            } else {
                const idx = parseInt(recordIndex);
                localOverrides.edited[idx] = newRec;
            }
        } else {
            // ADD Mode (fallback local storage)
            localOverrides.added.push(newRec);
        }
        
        saveOverridesAndRender();
        document.getElementById('modal-card').classList.remove('active');
    });
    
    // 8. Backup & Export Spreadsheet Dialog Trigger
    document.getElementById('btn-open-sync').addEventListener('click', () => {
        const modal = document.getElementById('modal-sync');
        
        // Generate Export CSV Text Block
        generateExportCSVText();
        
        modal.classList.add('active');
    });
    
    document.getElementById('btn-close-sync-modal').addEventListener('click', () => {
        document.getElementById('modal-sync').classList.remove('active');
    });
    
    // 11. Download updated CSV locally
    document.getElementById('btn-download-csv').addEventListener('click', () => {
        const csvContent = document.getElementById('export-csv-text').value;
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' }); // perfect BOM UTF-8 for Excel
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "food_map_adjusted_sync.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
    
    // 12. Copy CSV to Clipboard
    document.getElementById('btn-copy-csv').addEventListener('click', () => {
        const csvArea = document.getElementById('export-csv-text');
        csvArea.select();
        navigator.clipboard.writeText(csvArea.value);
        alert("📋 已經成功複製 CSV 內容到您的剪貼簿！\n現在您可以打開 Google Sheet，整段貼上覆蓋即可同步。");
    });
    
    // 13. Setup clickable statistics details listeners
    setupStatsDetails();
    
    // 14. Auto-prefill coordinates when location name is typed or selected in the modal
    const inputLoc = document.getElementById('form-location');
    const inputCoords = document.getElementById('form-coords');
    
    if (inputLoc && inputCoords) {
        const handleLocationInput = () => {
            const val = inputLoc.value.trim();
            if (!val) return;
            
            // A. Check cozy home location
            const homeCoords = getHomeCoordinates(val);
            if (homeCoords) {
                inputCoords.value = `${homeCoords.lat.toFixed(6)}, ${homeCoords.lng.toFixed(6)}`;
                return;
            }
            
            // B. Apply brief mappings
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
            
            let targetName = val;
            if (briefMappings[val]) {
                targetName = briefMappings[val];
            }
            
            // C. Search TAIWAN_CITIES for match
            if (typeof TAIWAN_CITIES !== 'undefined') {
                // Exact match first
                let found = TAIWAN_CITIES.find(city => city.name === targetName);
                if (!found) {
                    // Try exact match with normalized traditional characters (臺 vs 台)
                    const normTarget = targetName.replace(/台/g, "臺");
                    const normTarget2 = targetName.replace(/臺/g, "台");
                    found = TAIWAN_CITIES.find(city => city.name.replace(/台/g, "臺") === normTarget || city.name.replace(/臺/g, "台") === normTarget2);
                }
                if (!found) {
                    // Partial match (e.g. "公館" matches "苗栗縣公館鄉")
                    found = TAIWAN_CITIES.find(city => city.name.includes(targetName) || targetName.includes(city.name));
                }
                if (!found) {
                    // Partial match with normalized characters
                    const normTarget = targetName.replace(/台/g, "臺");
                    found = TAIWAN_CITIES.find(city => city.name.replace(/台/g, "臺").includes(normTarget));
                }
                
                if (found) {
                    inputCoords.value = `${found.lat.toFixed(6)}, ${found.lng.toFixed(6)}`;
                    return;
                }
            }
            
            // D. Search WORLD_CITIES for match
            if (typeof WORLD_CITIES !== 'undefined') {
                let found = WORLD_CITIES.find(city => city.name === targetName || city.name.includes(targetName) || targetName.includes(city.name));
                if (found) {
                    inputCoords.value = `${found.lat.toFixed(6)}, ${found.lng.toFixed(6)}`;
                    return;
                }
            }
        };
        
        inputLoc.addEventListener('input', handleLocationInput);
        inputLoc.addEventListener('change', handleLocationInput);
    }
    
    // 15. Online coordinate search handler when clicking "🔍 搜尋線上定位"
    const btnSearchOnline = document.getElementById('btn-search-online-coords');
    if (btnSearchOnline) {
        btnSearchOnline.addEventListener('click', async () => {
            const locVal = document.getElementById('form-location').value.trim();
            const foodVal = document.getElementById('form-food').value.trim();
            
            if (!locVal) {
                alert("⚠️ 請先在上方填寫「地點/地區」名稱！(例如：竹南、頭份、台中)");
                return;
            }
            if (!foodVal) {
                alert("⚠️ 請先填寫「餐廳名稱 / 美食細節」名稱，以便進行精準定位！");
                return;
            }
            
            // Clean up notes in brackets/parentheses and commas
            let cleanFood = foodVal.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
            cleanFood = cleanFood.split(/[，,]/)[0].trim();
            
            // Exclude fuzzy "家" suffix from location name to improve search accuracy
            let cleanLoc = locVal;
            if (cleanLoc.includes("家")) {
                const homeCoords = getHomeCoordinates(cleanLoc);
                if (homeCoords) {
                    document.getElementById('form-coords').value = `${homeCoords.lat.toFixed(6)}, ${homeCoords.lng.toFixed(6)}`;
                    alert(`🎉 溫馨的家定位成功！\n\n對應名稱：${cleanLoc}\n經緯度：${homeCoords.lat.toFixed(6)}, ${homeCoords.lng.toFixed(6)}`);
                    return;
                }
                cleanLoc = cleanLoc.replace("家", "").trim();
            }
            
            // B. Check custom landmarks database (for places not in OpenStreetMap like 桐遊柿界)
            const CUSTOM_LANDMARKS = {
                "桐遊柿界": { lat: 24.498424, lng: 120.852951, address: "苗栗縣公館鄉館東村12鄰166-6號 (桐遊柿界)" },
                "桐遊世界": { lat: 24.498424, lng: 120.852951, address: "苗栗縣公館鄉館東村12鄰166-6號 (桐遊柿界 - 諧音校正)" }
            };
            
            if (CUSTOM_LANDMARKS[cleanFood]) {
                const landmark = CUSTOM_LANDMARKS[cleanFood];
                document.getElementById('form-coords').value = `${landmark.lat.toFixed(6)}, ${landmark.lng.toFixed(6)}`;
                alert(`🎉 成功尋找到最佳線上定位！\n\n對應名稱：${landmark.address}\n座標：${landmark.lat.toFixed(6)}, ${landmark.lng.toFixed(6)}`);
                return;
            }
            
            // Apply brief mappings to expand abbreviation (e.g. "公館" -> "苗栗縣公館鄉", "嘉義" -> "嘉義市東區")
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
                "嘉義": "嘉義市東區"
            };
            if (briefMappings[cleanLoc]) {
                cleanLoc = briefMappings[cleanLoc];
            }
            
            const query = `${cleanLoc} ${cleanFood}`.trim();
            
            const originalHtml = btnSearchOnline.innerHTML;
            btnSearchOnline.disabled = true;
            btnSearchOnline.innerHTML = '<i data-lucide="loader" class="animate-spin" style="width:0.85rem; height:0.85rem; display:inline-block; animation:spin 1s linear infinite;"></i> <span>搜尋中...</span>';
            if (typeof lucide !== 'undefined') lucide.createIcons({ node: btnSearchOnline });
            
            try {
                console.log(`Searching online coordinates for: "${query}"`);
                
                let foundCoords = null;
                let foundAddress = "";
                
                // 1. Try Premium Google Maps Geocoding via Google Apps Script (GAS) if URL is configured!
                const hasGasUrl = (HARDCODED_GAS_URL && HARDCODED_GAS_URL !== '您的_GOOGLE_APPS_SCRIPT_API_網址' && !HARDCODED_GAS_URL.includes("xxxx"));
                if (hasGasUrl) {
                    try {
                        const gasGeocodeUrl = `${HARDCODED_GAS_URL}?action=geocode&query=${encodeURIComponent(query)}`;
                        console.log(`Querying premium Google Maps geocoding via Apps Script bridge: ${gasGeocodeUrl}`);
                        const gasRes = await fetch(gasGeocodeUrl);
                        if (gasRes.ok) {
                            const gasData = await gasRes.json();
                            if (gasData && gasData.success) {
                                foundCoords = { lat: gasData.lat, lng: gasData.lng };
                                foundAddress = gasData.address || query;
                                console.log(`Successfully geocoded via Google Maps: ${foundAddress} -> [${foundCoords.lat}, ${foundCoords.lng}]`);
                            }
                        }
                    } catch (gasErr) {
                        console.warn("Google Apps Script Geocoding failed, falling back to open maps:", gasErr);
                    }
                }
                
                // 2. Fallback to OpenStreetMap (Nominatim) if Google geocoder was not available or failed
                if (!foundCoords) {
                    // Determine if it is a foreign search (Japan, Korea, etc.)
                    const isForeign = locVal.includes("日本") || locVal.includes("韓國") || locVal.includes("國外") || locVal.includes("大阪") || locVal.includes("東京") || locVal.includes("京都") || locVal.includes("首爾") || locVal.includes("釜山");
                    
                    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&accept-language=zh-TW`;
                    if (!isForeign) {
                        url += `&countrycodes=tw`; // Force results to be inside Taiwan!
                    }
                    
                    const response = await fetch(url, {
                        headers: {
                            'Accept-Language': 'zh-TW',
                            'User-Agent': 'OurFoodMap/2.5 (simon)'
                        }
                    });
                    
                    if (!response.ok) throw new Error("Nominatim server returned error status");
                    let data = await response.json();
                    
                    // Homophone Auto-Correction Fallback (e.g. "世界" -> "柿界" for "桐遊柿界")
                    if ((!data || data.length === 0) && query.includes("世界")) {
                        const correctedQuery = query.replace(/世界/g, "柿界");
                        console.log(`No results for "${query}". Trying homophone auto-correction fallback: "${correctedQuery}"`);
                        const correctedUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(correctedQuery)}&format=json&limit=3&accept-language=zh-TW` + (!isForeign ? '&countrycodes=tw' : '');
                        const correctedRes = await fetch(correctedUrl, {
                            headers: {
                                'Accept-Language': 'zh-TW',
                                'User-Agent': 'OurFoodMap/2.5 (simon)'
                            }
                        });
                        if (correctedRes.ok) {
                            const correctedData = await correctedRes.json();
                            if (correctedData && correctedData.length > 0) {
                                data = correctedData;
                            }
                        }
                    }
                    
                    if (data && data.length > 0) {
                        const firstResult = data[0];
                        foundCoords = { lat: parseFloat(firstResult.lat), lng: parseFloat(firstResult.lon) };
                        foundAddress = firstResult.display_name.split(',')[0] || query;
                    }
                }
                
                // 3. Apply coordinates if found
                if (foundCoords) {
                    document.getElementById('form-coords').value = `${foundCoords.lat.toFixed(6)}, ${foundCoords.lng.toFixed(6)}`;
                    
                    const displayName = foundAddress.split(',')[0] || query;
                    alert(`🎉 成功尋找到最佳線上定位！\n\n對應名稱：${displayName}\n座標：${foundCoords.lat.toFixed(6)}, ${foundCoords.lng.toFixed(6)}`);
                } else {
                    // Fallback search: search just the location name
                    console.log(`No results for full query. Trying fallback search for: "${cleanLoc}"`);
                    const fallbackUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanLoc)}&format=json&limit=1&accept-language=zh-TW`;
                    const fallbackRes = await fetch(fallbackUrl, {
                        headers: {
                            'Accept-Language': 'zh-TW',
                            'User-Agent': 'OurFoodMap/2.4 (simon)'
                        }
                    });
                    const fallbackData = await fallbackRes.json();
                    
                    if (fallbackData && fallbackData.length > 0) {
                        const firstResult = fallbackData[0];
                        const lat = parseFloat(firstResult.lat);
                        const lng = parseFloat(firstResult.lon);
                        
                        document.getElementById('form-coords').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                        alert(`⚠️ 無法找到「${query}」的精準定位。\n已自動為您預填「${cleanLoc}」區域中心的座標：\n\n座標：${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                    } else {
                        alert(`⚠️ 線上資料庫中未找到與「${query}」相符的座標。\n請確認名稱拼字，或開啟 Google Maps 手動複製經緯度填入。`);
                    }
                }
            } catch (err) {
                console.error("Online geocoding search failed:", err);
                alert("⚠️ 線上地標搜尋連線失敗，請檢查網路連線或稍後再試。");
            } finally {
                btnSearchOnline.disabled = false;
                btnSearchOnline.innerHTML = originalHtml;
                if (typeof lucide !== 'undefined') lucide.createIcons({ node: btnSearchOnline });
            }
        });
    }
    
    // 16. Back to Top Button Scroll and Click Events
    const contentPanel = document.querySelector('.content-panel');
    const btnBackToTop = document.getElementById('btn-back-to-top');
    if (btnBackToTop) {
        const handleScroll = () => {
            const scrollTop = contentPanel ? contentPanel.scrollTop : 0;
            const windowScrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const currentScroll = Math.max(scrollTop, windowScrollTop);
            
            if (currentScroll > 150) {
                btnBackToTop.classList.remove('hidden');
            } else {
                btnBackToTop.classList.add('hidden');
            }
        };
        
        // Initialize visibility on page load
        handleScroll();
        
        if (contentPanel) {
            contentPanel.addEventListener('scroll', handleScroll);
        }
        window.addEventListener('scroll', handleScroll);
        
        btnBackToTop.addEventListener('click', () => {
            if (contentPanel) {
                contentPanel.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
        
        // Mobile Bottom Sheet toggle and swipe functionality
        const contentPanelElement = document.querySelector('.content-panel');
        const sheetHandle = document.getElementById('bottomSheetHandle');
        if (sheetHandle && contentPanelElement) {
            // Set initial state to collapsed on load for mobile
            contentPanelElement.classList.add('sheet-collapsed');
            
            // 1. Toggle on click
            sheetHandle.addEventListener('click', () => {
                if (contentPanelElement.classList.contains('sheet-expanded')) {
                    contentPanelElement.classList.remove('sheet-expanded');
                    contentPanelElement.classList.add('sheet-collapsed');
                } else {
                    contentPanelElement.classList.remove('sheet-collapsed');
                    contentPanelElement.classList.add('sheet-expanded');
                }
            });
            
            // 2. Swipe detection (up/down) on drag handle
            let touchStartY = 0;
            let touchEndY = 0;
            
            sheetHandle.addEventListener('touchstart', (e) => {
                touchStartY = e.touches[0].clientY;
            }, { passive: true });
            
            sheetHandle.addEventListener('touchend', (e) => {
                touchEndY = e.changedTouches[0].clientY;
                const diffY = touchEndY - touchStartY;
                if (Math.abs(diffY) > 30) { // Threshold for swipe gesture
                    if (diffY > 0) {
                        // Swipe down -> Collapse
                        contentPanelElement.classList.remove('sheet-expanded');
                        contentPanelElement.classList.add('sheet-collapsed');
                    } else {
                        // Swipe up -> Expand
                        contentPanelElement.classList.remove('sheet-collapsed');
                        contentPanelElement.classList.add('sheet-expanded');
                    }
                }
            }, { passive: true });
        }
    }
}

/**
 * Generate Raw CSV String representing current unified database
 */
function generateExportCSVText() {
    const csvRows = [["時間", "地點", "餐廳/美食", "Full Address", "Latitude", "Longitude"]];
    
    // Sort active database by date descending so the newest records are at the top
    const chronologicalAll = [...activeRecords].sort((a,b) => {
        return parseDate(b.date) - parseDate(a.date);
    });
    
    chronologicalAll.forEach(rec => {
        // Enclose in quotes if field contains commas to comply with CSV standard
        const cleanFood = rec.food.includes(',') || rec.food.includes('，') ? `"${rec.food}"` : rec.food;
        
        // Find coordinates from record or fallback to coordsDb
        const key = `${rec.location}|${rec.food}`;
        let lat = '';
        let lng = '';
        
        const homeCoords = getHomeCoordinates(rec.location);
        if (homeCoords) {
            lat = homeCoords.lat;
            lng = homeCoords.lng;
        } else if (rec.lat && rec.lng) {
            lat = rec.lat;
            lng = rec.lng;
        } else {
            const coord = coordsDb[key];
            if (coord && coord.lat && coord.lng) {
                lat = coord.lat;
                lng = coord.lng;
            }
        }

        
        // Create full address by combining location and food, and escape commas if needed
        const rawAddress = `${rec.location} ${rec.food}`;
        const cleanAddress = rawAddress.includes(',') || rawAddress.includes('，') ? `"${rawAddress}"` : rawAddress;
        
        csvRows.push([rec.date, rec.location, cleanFood, cleanAddress, lat, lng]);
    });
    
    const csvContent = csvRows.map(row => row.join(',')).join('\n');
    document.getElementById('export-csv-text').value = csvContent;
}

/**
 * Dynamic fallback geocoding inside the browser for newly added custom spots
 */
function saveNewCoordsIfMissing(loc, food) {
    const key = `${loc}|${food}`;
    if (coordsDb[key]) return; // already exists
    
    // If it's a cozy home location
    const homeCoords = getHomeCoordinates(loc);
    if (homeCoords) {
        coordsDb[key] = homeCoords;
        return;
    }

    
    // Otherwise fallback to city center coordinates
    const cities = {
        "竹南": { lat: 24.6853, lng: 120.8753, address: "苗栗縣竹南鎮" },
        "頭份": { lat: 24.6897, lng: 120.9118, address: "苗栗縣頭份市" },
        "新竹": { lat: 24.8036, lng: 120.9686, address: "新竹市" },
        "新竹市": { lat: 24.8036, lng: 120.9686, address: "新竹市" },
        "竹北": { lat: 24.8398, lng: 121.0094, address: "新竹縣竹北市" },
        "高雄": { lat: 22.6273, lng: 120.3014, address: "高雄市" },
        "台南": { lat: 22.9997, lng: 120.2270, address: "台南市" },
        "台北": { lat: 25.0330, lng: 121.5654, address: "台北市" },
        "日本": { lat: 34.6937, lng: 135.5023, address: "日本大阪" }
    };
    
    // Try to find matching city key
    let cityCoords = { lat: 24.6853, lng: 120.8753, address: "台灣" }; // default to Zhunan
    for (const ck in cities) {
        if (loc.includes(ck)) {
            cityCoords = cities[ck];
            break;
        }
    }
    
    coordsDb[key] = {
        lat: cityCoords.lat,
        lng: cityCoords.lng,
        address: `${cityCoords.address} (${food})`,
        type: "fallback"
    };
}

// Insights Active Year State
let insightsActiveYear = 'all';

/**
 * Classify a food name and location into culinary categories
 */
function classifyFoodCategory(location, food) {
    const text = (location + " " + food).toLowerCase();
    
    if (text.includes("火鍋") || text.includes("鍋") || text.includes("錢都") || text.includes("六扇門") || text.includes("石二鍋") || text.includes("薑母鴨") || text.includes("沙茶鍋") || text.includes("羊肉爐") || text.includes("吃到飽") || text.includes("饗食天堂")) {
        return { name: "暖胃火鍋 🍲", icon: "soup", color: "hsla(3, 85%, 60%, 0.15)", textColor: "hsl(3, 85%, 55%)" };
    }
    if (text.includes("燒肉") || text.includes("烤肉") || text.includes("屋馬") || text.includes("政宗") || text.includes("串燒") || text.includes("烤炸") || text.includes("鐵板燒") || text.includes("烤雞")) {
        return { name: "美味燒肉 🍖", icon: "flame", color: "hsla(28, 90%, 55%, 0.15)", textColor: "hsl(28, 90%, 50%)" };
    }
    if (text.includes("壽司") || text.includes("藏壽司") || text.includes("定食") || text.includes("豬排") || text.includes("勝牛") || text.includes("杏子") || text.includes("生魚片") || text.includes("拉麵") || text.includes("烏龍麵") || text.includes("丼飯") || text.includes("日式") || text.includes("章魚燒")) {
        return { name: "日式料理 🍣", icon: "shrub", color: "hsla(145, 60%, 45%, 0.15)", textColor: "hsl(145, 60%, 35%)" };
    }
    if (text.includes("義式") || text.includes("義大利麵") || text.includes("pizza") || text.includes("披薩") || text.includes("漢堡") || text.includes("牛排") || text.includes("得正") || text.includes("炸魚薯條") || text.includes("西餐") || text.includes("洋食")) {
        return { name: "西式異國 🍕", icon: "croissant", color: "hsla(210, 80%, 55%, 0.15)", textColor: "hsl(210, 80%, 50%)" };
    }
    if (text.includes("早餐") || text.includes("早午餐") || text.includes("burger") || text.includes("麥味登") || text.includes("qburger") || text.includes("三明治") || text.includes("吐司") || text.includes("彬彬") || text.includes("蛋餅") || text.includes("饅頭") || text.includes("鬆餅")) {
        return { name: "活力早午餐 🍳", icon: "egg", color: "hsla(45, 95%, 50%, 0.15)", textColor: "hsl(40, 85%, 45%)" };
    }
    if (text.includes("咖啡") || text.includes("甜點") || text.includes("冰") || text.includes("蛋糕") || text.includes("麻糬") || text.includes("星巴克") || text.includes("綠豆沙") || text.includes("茶") || text.includes("得正") || text.includes("下午茶") || text.includes("飲") || text.includes("橘子") || text.includes("鮮茶道")) {
        return { name: "甜點下午茶 ☕", icon: "coffee", color: "hsla(300, 60%, 60%, 0.15)", textColor: "hsl(300, 60%, 55%)" };
    }
    // Default fallback to Chinese / local snacks
    return { name: "地方特色小吃 🥢", icon: "utensils", color: "hsla(175, 77%, 26%, 0.15)", textColor: "hsl(175, 77%, 26%)" };
}

// Active Details Panel State
let activeDetailsTab = null; // 'locations', 'meals', or null

/**
 * Setup Click Listeners for Statistics Cards
 */
function setupStatsDetails() {
    const cardLocs = document.getElementById('card-stat-locations');
    const cardMeals = document.getElementById('card-stat-meals');
    const btnClose = document.getElementById('btn-close-stats-details');
    
    if (cardLocs) {
        cardLocs.addEventListener('click', () => {
            toggleStatsDetails('locations');
        });
    }
    
    if (cardMeals) {
        cardMeals.addEventListener('click', () => {
            toggleStatsDetails('meals');
        });
    }
    
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            closeStatsDetails();
        });
    }
}

/**
 * Toggle Stats Details Panel
 */
function toggleStatsDetails(tab) {
    const cardLocs = document.getElementById('card-stat-locations');
    const cardMeals = document.getElementById('card-stat-meals');
    
    if (activeDetailsTab === tab) {
        closeStatsDetails();
    } else {
        activeDetailsTab = tab;
        
        // Highlight active card
        if (tab === 'locations') {
            cardLocs.classList.add('active');
            cardMeals.classList.remove('active');
        } else {
            cardLocs.classList.remove('active');
            cardMeals.classList.add('active');
        }
        
        updateStatsDetails();
    }
}

/**
 * Close Stats Details Panel
 */
function closeStatsDetails() {
    activeDetailsTab = null;
    const cardLocs = document.getElementById('card-stat-locations');
    const cardMeals = document.getElementById('card-stat-meals');
    const container = document.getElementById('stats-details-container');
    
    if (cardLocs) cardLocs.classList.remove('active');
    if (cardMeals) cardMeals.classList.remove('active');
    if (container) container.classList.add('hidden');
}

/**
 * Render Details Content dynamically based on filtered records
 */
function updateStatsDetails() {
    const container = document.getElementById('stats-details-container');
    const titleEl = document.getElementById('stats-details-title');
    const contentEl = document.getElementById('stats-details-content');
    
    if (!activeDetailsTab) {
        if (container) container.classList.add('hidden');
        return;
    }
    
    if (container) container.classList.remove('hidden');
    
    // Filter records for stats drawer breakdown strictly by year & search query (ignoring activeCategory & activeRegion click)
    const records = activeRecords.filter(rec => {
        // Year filter
        if (activeYear !== 'all') {
            const yearStr = rec.date.split('/')[0];
            const targetYearTwoDigits = activeYear.slice(-2);
            if (yearStr !== targetYearTwoDigits) return false;
        }
        
        // Search query filter (ignore if it's a toggled region tag to prevent shrinking the drawer)
        if (searchQuery) {
            const isClickedLoc = activeRecords.some(r => r.location === searchQuery);
            if (!isClickedLoc) {
                const q = searchQuery.toLowerCase();
                const dateMatch = rec.date.toLowerCase().includes(q);
                const locMatch = rec.location.toLowerCase().includes(q);
                const foodMatch = rec.food.toLowerCase().includes(q);
                if (!dateMatch && !locMatch && !foodMatch) return false;
            }
        }
        return true;
    });
    
    const yearLabel = activeYear === 'all' ? '歷年全部' : `${activeYear} 年`;
    
    contentEl.innerHTML = '';
    
    if (activeDetailsTab === 'locations') {
        titleEl.innerHTML = `<i data-lucide="map-pin" style="width:1.1rem;height:1.1rem;color:var(--primary);"></i> 踏足地區清單 (${yearLabel}) <span style="font-size:0.75rem;font-weight:normal;color:var(--text-secondary);margin-left:0.5rem;">💡 點擊地區可篩選下方足跡</span>`;
        
        if (records.length === 0) {
            contentEl.innerHTML = '<div style="font-size:0.85rem;color:var(--text-secondary);text-align:center;padding:1rem;">該年度無足跡資料</div>';
            return;
        }
        
        // Count locations
        const locCounts = {};
        records.forEach(rec => {
            const cleanLoc = rec.location.trim();
            if (cleanLoc) {
                locCounts[cleanLoc] = (locCounts[cleanLoc] || 0) + 1;
            }
        });
        
        const sortedLocs = Object.keys(locCounts).sort((a,b) => locCounts[b] - locCounts[a]);
        
        const grid = document.createElement('div');
        grid.className = 'details-grid';
        
        sortedLocs.forEach(loc => {
            const count = locCounts[loc];
            const isHome = loc.includes("家");
            const isFilterActive = searchQuery === loc;
            const homeClass = isHome ? 'home-tag' : '';
            const iconName = isHome ? 'home' : 'map-pin';
            
            // First item in sortedLocs (which has max count) gets the champion crown in the details list
            const isChampion = (loc === sortedLocs[0] && count > 1);
            const crownHtml = isChampion ? '<span style="color:#eab308;margin-left:0.25rem;" title="冠軍足跡地點！👑">👑</span>' : '';
            
            const item = document.createElement('div');
            item.className = `details-tag ${homeClass} ${isFilterActive ? 'active' : ''}`;
            item.style = 'cursor: pointer;' + (isFilterActive ? 'border-color: var(--secondary) !important; background-color: var(--secondary-light) !important; box-shadow: 0 0 8px rgba(17, 118, 110, 0.2);' : '');
            item.innerHTML = `
                <span style="display:flex;align-items:center;gap:0.3rem;">
                    <i data-lucide="${iconName}" style="width:0.75rem;height:0.75rem;"></i>
                    <span>${loc}${crownHtml}</span>
                </span>
                <span class="details-tag-count">${count}次</span>
            `;
            
            item.addEventListener('click', () => {
                const searchInput = document.getElementById('search-input');
                const searchClear = document.getElementById('search-clear');
                
                // Clear category filter when switching to location filter
                activeCategory = null;
                
                if (searchQuery === loc) {
                    // Toggle off
                    searchInput.value = '';
                    searchQuery = '';
                    searchClear.classList.add('hidden');
                } else {
                    // Toggle on
                    searchInput.value = loc;
                    searchQuery = loc;
                    searchClear.classList.remove('hidden');
                }
                applyFiltersAndRender(false);
            });
            
            grid.appendChild(item);
        });
        
        contentEl.appendChild(grid);
        
    } else if (activeDetailsTab === 'meals') {
        titleEl.innerHTML = `<i data-lucide="utensils" style="width:1.1rem;height:1.1rem;color:var(--primary);"></i> 美食分析清單 (${yearLabel}) <span style="font-size:0.75rem;font-weight:normal;color:var(--text-secondary);margin-left:0.5rem;">💡 點擊美食類別可篩選下方足跡</span>`;
        
        if (records.length === 0) {
            contentEl.innerHTML = '<div style="font-size:0.85rem;color:var(--text-secondary);text-align:center;padding:1rem;">該年度無美食資料</div>';
            return;
        }
        
        // A. Food Category counts
        const catCounts = {};
        const catConfigs = {};
        records.forEach(rec => {
            const cat = classifyFoodCategory(rec.location, rec.food);
            catCounts[cat.name] = (catCounts[cat.name] || 0) + 1;
            catConfigs[cat.name] = cat;
        });
        
        const sortedCats = Object.keys(catCounts).sort((a,b) => catCounts[b] - catCounts[a]);
        
        const foodGrid = document.createElement('div');
        foodGrid.className = 'details-food-grid';
        
        sortedCats.forEach(catName => {
            const count = catCounts[catName];
            const percent = Math.round((count / records.length) * 100);
            const config = catConfigs[catName];
            const isActive = activeCategory === catName;
            
            // Custom highlight style using the category's natural color
            const activeStyle = isActive ? `border-color: ${config.textColor} !important; background-color: ${config.color} !important; box-shadow: 0 0 10px ${config.color}; cursor: pointer;` : 'cursor: pointer;';
            
            const card = document.createElement('div');
            card.className = `details-food-card ${isActive ? 'active' : ''}`;
            card.style = activeStyle;
            card.innerHTML = `
                <div class="details-food-header">
                    <span class="details-food-label" style="color: ${config.textColor}">
                        <i data-lucide="${config.icon}"></i>
                        <span>${config.name}</span>
                    </span>
                    <span class="details-food-count" style="font-weight: 700; color: ${config.textColor}">${count} 次 (${percent}%)</span>
                </div>
                <div class="progress-track" style="background-color: ${isActive ? 'rgba(255,255,255,0.4)' : ''}">
                    <div class="progress-fill" style="width: ${percent}%; background-color: ${config.textColor}"></div>
                </div>
            `;
            
            card.addEventListener('click', () => {
                // Clear search query when switching to category filter
                const searchInput = document.getElementById('search-input');
                const searchClear = document.getElementById('search-clear');
                searchInput.value = '';
                searchQuery = '';
                searchClear.classList.add('hidden');
                
                if (activeCategory === catName) {
                    activeCategory = null;
                } else {
                    activeCategory = catName;
                }
                applyFiltersAndRender(false);
            });
            
            foodGrid.appendChild(card);
        });
        
        contentEl.appendChild(foodGrid);
    }
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({
            attrs: { class: ['lucide'] },
            node: contentEl
        });
        lucide.createIcons({
            attrs: { class: ['lucide'] },
            node: titleEl
        });
    }
}



/**
 * Helper to extract clean county/township/district name from Nominatim address object
 */
function extractAreaName(addrObj) {
    if (!addrObj) return "";
    
    const county = addrObj.county || addrObj.state || ""; // e.g. "苗栗縣"
    const city = addrObj.city || ""; // e.g. "新竹市"
    const district = addrObj.town || addrObj.suburb || addrObj.city_district || addrObj.district || addrObj.village || "";
    
    let region = "";
    if (county) {
        region += county;
    } else if (city) {
        region += city;
    }
    
    if (district) {
        region += district;
    }
    
    // Clean up country or postcode
    region = region.replace("台灣", "").replace("臺灣", "").trim();
    
    return region || addrObj.road || "未知區域";
}

/**
 * Online Reverse Geocoding using Nominatim
 */
async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-TW`;
        const response = await fetch(url, {
            headers: {
                'Accept-Language': 'zh-TW'
            }
        });
        if (!response.ok) throw new Error('Nominatim request failed');
        const data = await response.json();
        if (data && data.address) {
            return extractAreaName(data.address);
        }
    } catch (err) {
        console.error("Reverse geocoding failed:", err);
    }
    return null;
}

/**
 * Scan and retroactively fix historical coordinates overrides
 */
async function autoFixCoordsAddresses() {
    const savedCoordsStr = safeStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY);
    if (!savedCoordsStr) return;
    
    let overridesChanged = false;
    let overrides = {};
    try {
        overrides = JSON.parse(savedCoordsStr);
    } catch (e) {
        return;
    }
    
    const keysToFix = [];
    
    for (const key in overrides) {
        const item = overrides[key];
        const locationName = key.split('|')[0];
        const isHome = locationName.includes("家");
        const homeCoords = getHomeCoordinates(locationName);
        
        // Check if address needs fixing (if it contains "手動" or is generic/missing)
        const needsFix = !item.address || 
                          item.address === "手動校正位置" || 
                          item.address === "手動定位" || 
                          item.address.includes("手動");
        
        if (needsFix) {
            if (isHome && homeCoords) {
                // Fix with home calibrated address
                overrides[key] = {
                    ...item,
                    address: homeCoords.address,
                    type: "home"
                };
                overridesChanged = true;
                coordsDb[key] = overrides[key];
            } else if (item.lat && item.lng) {
                // Apply instant local reverse geocode to coordsDb in memory first so it displays instantly
                const localAddr = localReverseGeocode(item.lat, item.lng);
                coordsDb[key].address = localAddr;
                
                // Add to online queue for precise details
                keysToFix.push({ key, lat: item.lat, lng: item.lng });
            }
        }
    }
    
    if (overridesChanged) {
        safeStorage.setItem(STORAGE_COORDS_OVERRIDES_KEY, JSON.stringify(overrides));
    }
    
    // Process online reverse geocoding queue with rate limiting
    if (keysToFix.length > 0) {
        console.log(`Queueing ${keysToFix.length} historical coords for online geocoding...`);
        for (let i = 0; i < keysToFix.length; i++) {
            const { key, lat, lng } = keysToFix[i];
            
            // Wait 1.5 seconds between requests to comply with Nominatim policy
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const realAddress = await reverseGeocode(lat, lng);
            if (realAddress) {
                // Reload overrides to prevent race conditions
                const currentOverrides = JSON.parse(safeStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY) || '{}');
                if (currentOverrides[key]) {
                    currentOverrides[key].address = realAddress;
                    safeStorage.setItem(STORAGE_COORDS_OVERRIDES_KEY, JSON.stringify(currentOverrides));
                    
                    // Update in-memory database
                    if (coordsDb[key]) {
                        coordsDb[key].address = realAddress;
                    }
                    
                    console.log(`Retroactively resolved coordinate address for: ${key} -> ${realAddress}`);
                }
            }
        }
        // Apply filters and re-render map so updated addresses display immediately without refresh!
        if (typeof applyFiltersAndRender === 'function') {
            applyFiltersAndRender(false);
        }
    }
}
