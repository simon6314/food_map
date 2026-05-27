/* ==========================================================================
   Our Food Map - Core Application Controller (app.js)
   Manages CSV data parsing, state overrides, search, UI rendering, and CRUD operations.
   ========================================================================== */

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

// Sheet source URL key in LocalStorage
const STORAGE_SHEET_URL_KEY = 'food_map_sheet_url';
const STORAGE_GAS_URL_KEY = 'food_map_gas_url';
const STORAGE_OVERRIDES_KEY = 'food_map_overrides';
const STORAGE_COORDS_OVERRIDES_KEY = 'food_map_coords_overrides';

// Default CSV path (pointing directly to your live Google Sheet)
const DEFAULT_CSV_PATH = 'https://docs.google.com/spreadsheets/d/1Kxl_tLb3vDVVk4AAAW4n7qm_OWE5d9YCU6AMttpnAvQ/export?format=csv';
const DEFAULT_COORDS_PATH = 'coords_db.json';

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Leaflet Map
    const savedTheme = localStorage.getItem('food_map_theme') || 'light';
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
});

/**
 * Load Coordinates Database
 */
async function loadCoordsDb() {
    try {
        const response = await fetch(DEFAULT_COORDS_PATH);
        coordsDb = await response.json();
        
        // Merge with local coordinates overrides
        const savedCoords = localStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY);
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
    // 1. Get Google Sheets Apps Script URL or Published URL or fallback to local file
    const customGasUrl = localStorage.getItem(STORAGE_GAS_URL_KEY);
    const customSheetUrl = localStorage.getItem(STORAGE_SHEET_URL_KEY);
    
    // 2. Load LocalStorage Overrides
    const savedOverrides = localStorage.getItem(STORAGE_OVERRIDES_KEY);
    if (savedOverrides) {
        try {
            localOverrides = JSON.parse(savedOverrides);
        } catch (e) {
            console.error("Failed to parse local overrides:", e);
        }
    }
    
    try {
        if (customGasUrl) {
            console.log(`Fetching real-time JSON from GAS API: ${customGasUrl}`);
            const response = await fetch(customGasUrl);
            baseRecords = await response.json();
            console.log(`Loaded ${baseRecords.length} real-time records from Google Sheets.`);
        } else {
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
    // 1. Apply Year & Search Filters
    let filtered = activeRecords.filter(rec => {
        // Year filter
        if (activeYear !== 'all') {
            const yearStr = rec.date.split('/')[0];
            const targetYearTwoDigits = activeYear.slice(-2);
            if (yearStr !== targetYearTwoDigits) return false;
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
    
    records.forEach(rec => {
        const key = `${rec.location}|${rec.food}`;
        const coord = coordsDb[key];
        const isHome = rec.location.includes("家");
        const homeClass = isHome ? 'home-tag' : '';
        const homeIcon = isHome ? '<i data-lucide="home" style="width:0.85rem;height:0.85rem;"></i>' : '<i data-lucide="map-pin" style="width:0.85rem;height:0.85rem;"></i>';
        
        // Clean restaurant name and check for comments in parentheses
        let shopName = rec.food;
        let noteText = '';
        
        // Extract note in bracket e.g. "陶板屋（精靈生日）" -> Note is "精靈生日"
        const bracketMatch = rec.food.match(/[\uff08\u0028]([^\uff09\u0029]*)[\uff09\u0029]/);
        if (bracketMatch) {
            noteText = `<span class="card-note">${bracketMatch[1]}</span>`;
            shopName = rec.food.replace(bracketMatch[0], "").trim();
        }
        
        // Setup direct Google Maps Link
        const cleanShop = shopName.split(/[，,]/)[0].trim();
        const searchLoc = isHome ? rec.location : `${rec.location} ${cleanShop}`;
        const gmapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchLoc)}`;
        
        const addressText = coord && coord.address ? 
            `<div class="card-address"><i data-lucide="compass"></i> <span>${coord.address}</span></div>` : '';
            
        // Build card HTML
        const card = document.createElement('div');
        card.className = 'food-card';
        card.id = `card-rec-${rec.index}`;
        card.innerHTML = `
            <div class="card-header-row">
                <div class="card-badges">
                    <span class="date-badge">20${rec.date}</span>
                    <span class="location-tag ${homeClass}">
                        ${homeIcon} <span>${rec.location}</span>
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
            focusMarker(rec.index, coordsDb, key);
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
function highlightTimelineCard(recordIndex) {
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
}

/**
 * Save Overrides to Local Storage and re-render
 */
function saveOverridesAndRender() {
    localStorage.setItem(STORAGE_OVERRIDES_KEY, JSON.stringify(localOverrides));
    mergeRecords();
    applyFiltersAndRender(false); // don't animate line path on minor CRUD update to prevent flickering
}

/**
 * Delete a food record
 */
window.deleteRecord = function(recordIndex) {
    if (!confirm("確定要刪除這筆美食足跡嗎？")) return;
    
    if (recordIndex.startsWith('added-')) {
        // Deleting a newly added record
        const localIdx = parseInt(recordIndex.split('-')[1]);
        localOverrides.added.splice(localIdx, 1);
    } else {
        // Deleting a base record
        const idx = parseInt(recordIndex);
        if (!localOverrides.deleted.includes(idx)) {
            localOverrides.deleted.push(idx);
        }
        // Remove from edits if it was there
        if (localOverrides.edited[idx]) {
            delete localOverrides.edited[idx];
        }
    }
    
    saveOverridesAndRender();
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
            document.getElementById('form-date').value = rec.date;
            document.getElementById('form-location').value = rec.location;
            document.getElementById('form-food').value = rec.food;
            
            // Pre-fill custom coordinates if they exist in coordsDb
            const key = `${rec.location}|${rec.food}`;
            const homeCoords = getHomeCoordinates(rec.location);
            if (homeCoords) {
                document.getElementById('form-coords').value = `${homeCoords.lat.toFixed(6)}, ${homeCoords.lng.toFixed(6)}`;
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
        localStorage.setItem('food_map_theme', newTheme);
        setMapTheme(newTheme);
    });
    
    // 2. Year Pill Filter Tabs
    const tabs = document.querySelectorAll('.tab-pill');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeYear = tab.getAttribute('data-year');
            applyFiltersAndRender(true); // Animate path when switching years
        });
    });
    
    // 3. Instant Search Input
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
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
                    // Save in current memory
                    coordsDb[key] = {
                        lat: lat,
                        lng: lng,
                        address: "手動校正位置",
                        type: "restaurant"
                    };
                    
                    // Save in LocalStorage overrides
                    const savedOverrides = JSON.parse(localStorage.getItem(STORAGE_COORDS_OVERRIDES_KEY) || '{}');
                    savedOverrides[key] = coordsDb[key];
                    localStorage.setItem(STORAGE_COORDS_OVERRIDES_KEY, JSON.stringify(savedOverrides));
                    console.log(`Saved manual coordinates override for: ${key} -> ${lat}, ${lng}`);
                    
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

        
        const customGasUrl = localStorage.getItem(STORAGE_GAS_URL_KEY);
        
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
                    localStorage.setItem(STORAGE_OVERRIDES_KEY, JSON.stringify(localOverrides));
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
    
    // 8. Sync Spreadsheet Dialog Trigger
    document.getElementById('btn-open-sync').addEventListener('click', () => {
        const modal = document.getElementById('modal-sync');
        
        // Pre-fill sheet and GAS URL inputs
        const savedSheetUrl = localStorage.getItem(STORAGE_SHEET_URL_KEY) || '';
        const savedGasUrl = localStorage.getItem(STORAGE_GAS_URL_KEY) || '';
        document.getElementById('sheet-url').value = savedSheetUrl;
        document.getElementById('gas-url').value = savedGasUrl;
        
        // Generate Export CSV Text Block
        generateExportCSVText();
        
        modal.classList.add('active');
    });
    
    document.getElementById('btn-close-sync-modal').addEventListener('click', () => {
        document.getElementById('modal-sync').classList.remove('active');
    });
    
    // 9. Sync Tabs switcher
    const tabLoad = document.getElementById('tab-btn-load');
    const tabExport = document.getElementById('tab-btn-export');
    const panelLoad = document.getElementById('panel-load');
    const panelExport = document.getElementById('panel-export');
    
    tabLoad.addEventListener('click', () => {
        tabLoad.classList.add('sync-tabactive');
        tabExport.classList.remove('sync-tabactive');
        panelLoad.classList.remove('hidden');
        panelExport.classList.add('hidden');
    });
    
    tabExport.addEventListener('click', () => {
        tabExport.classList.add('sync-tabactive');
        tabLoad.classList.remove('sync-tabactive');
        panelExport.classList.remove('hidden');
        panelLoad.classList.add('hidden');
        
        // Re-generate CSV text block
        generateExportCSVText();
    });
    
    // 10. Save custom sheet URL
    document.getElementById('btn-save-sheet').addEventListener('click', () => {
        const sheetUrl = document.getElementById('sheet-url').value.trim();
        const gasUrl = document.getElementById('gas-url').value.trim();
        
        if (sheetUrl) {
            localStorage.setItem(STORAGE_SHEET_URL_KEY, sheetUrl);
        } else {
            localStorage.removeItem(STORAGE_SHEET_URL_KEY);
        }
        
        if (gasUrl) {
            localStorage.setItem(STORAGE_GAS_URL_KEY, gasUrl);
        } else {
            localStorage.removeItem(STORAGE_GAS_URL_KEY);
        }
        
        document.getElementById('modal-sync').classList.remove('active');
        loadDataAndRender(); // reload with new source
    });
    
    document.getElementById('btn-reset-sheet').addEventListener('click', () => {
        localStorage.removeItem(STORAGE_SHEET_URL_KEY);
        localStorage.removeItem(STORAGE_GAS_URL_KEY);
        document.getElementById('sheet-url').value = '';
        document.getElementById('gas-url').value = '';
        document.getElementById('modal-sync').classList.remove('active');
        loadDataAndRender();
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
        // 13. Setup clickable statistics details listeners
        setupStatsDetails();
    });
}

/**
 * Generate Raw CSV String representing current unified database
 */
function generateExportCSVText() {
    const csvRows = [["時間", "地點", "餐廳/美食", "Full Address", "Latitude", "Longitude"]];
    
    // Iterate base records + overrides in logical sorted index order
    // To restore original layout sequence, sort active database by date ascending
    const chronologicalAll = [...activeRecords].sort((a,b) => {
        return parseDate(a.date) - parseDate(b.date);
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
    
    const records = window.currentFilteredRecords || activeRecords;
    const yearLabel = activeYear === 'all' ? '歷年全部' : `${activeYear} 年`;
    
    contentEl.innerHTML = '';
    
    if (activeDetailsTab === 'locations') {
        titleEl.innerHTML = `<i data-lucide="map-pin" style="width:1.1rem;height:1.1rem;color:var(--primary);"></i> 踏足地區清單 (${yearLabel})`;
        
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
            const homeClass = isHome ? 'home-tag' : '';
            const iconName = isHome ? 'home' : 'map-pin';
            
            const item = document.createElement('div');
            item.className = `details-tag ${homeClass}`;
            item.innerHTML = `
                <span style="display:flex;align-items:center;gap:0.3rem;">
                    <i data-lucide="${iconName}" style="width:0.75rem;height:0.75rem;"></i>
                    <span>${loc}</span>
                </span>
                <span class="details-tag-count">${count}次</span>
            `;
            grid.appendChild(item);
        });
        
        contentEl.appendChild(grid);
        
    } else if (activeDetailsTab === 'meals') {
        titleEl.innerHTML = `<i data-lucide="utensils" style="width:1.1rem;height:1.1rem;color:var(--primary);"></i> 美食分析清單 (${yearLabel})`;
        
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
            
            const card = document.createElement('div');
            card.className = 'details-food-card';
            card.innerHTML = `
                <div class="details-food-header">
                    <span class="details-food-label" style="color: ${config.textColor}">
                        <i data-lucide="${config.icon}"></i>
                        <span>${config.name}</span>
                    </span>
                    <span class="details-food-count">${count} 次 (${percent}%)</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${percent}%; background-color: ${config.textColor}"></div>
                </div>
            `;
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
