/**
 * TruckCongestionMap manages the truck traffic congestion map using Leaflet.
 */
class TruckCongestionMap {
    /**
     * Constructor for TruckCongestionMap.
     * @param {string} mapElementId - ID of the HTML element where the map will be rendered.
     */
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.stateLayer = null;
        this.currentMode = 'inbound';
        this.metricData = null;
        this.geoJsonData = null;
        this.initialized = false;
        this.controlDiv = null;
        this.errorControl = null;

        // Change map tile layer to CartoDB Light All for consistent English place names
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            if (currentZoom < this.map.getMinZoom()) {
                this.map.setZoom(this.map.getMinZoom());
            }
        });

        this.init();
    }

    /**
     * Initializes the map by loading GeoJSON and truck data.
     */
    async init() {
        try {
            const [geoJson, sheetData] = await Promise.all([
                fetch('data/us-states.json').then(res => {
                    if (!res.ok) throw new Error("GeoJSON fetch error");
                    return res.json();
                }),
                this.fetchSheetData()
            ]);

            this.geoJsonData = geoJson;
            this.metricData = sheetData;

            this.renderMap();
            this.addToggleControls(); // INBOUND/OUTBOUND toggle buttons (top center)
            this.addRightControls();  // Reset button and filter dropdown (top right)
            this.initialized = true;
        } catch (err) {
            console.error("Initialization failed:", err);
            this.showError("Failed to load truck data. Please try again later.");
        }
    }

    /**
     * Fetches truck data from `data/us-truck.json`. Provides fallback data on failure.
     * @returns {Object} Parsed truck data.
     */
    async fetchSheetData() {
        try {
            const res = await fetch('data/us-truck.json');
            if (!res.ok) throw new Error("Truck data fetch error");
            return await res.json();
        } catch (err) {
            console.warn("Truck data fetch failed, using fallback data.");
            return {
                'AL': { name: 'Alabama', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 },
                'TN': { name: 'Tennessee', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 }
            };
        }
    }

    /**
     * Renders or re-renders the GeoJSON layer on the map.
     */
    renderMap() {
        if (this.stateLayer) this.map.removeLayer(this.stateLayer);

        this.stateLayer = L.geoJSON(this.geoJsonData, {
            style: this.getStyle.bind(this),
            onEachFeature: this.bindEvents.bind(this)
        }).addTo(this.map);
    }

    /**
     * Determines the style (fill color, border) for each state polygon based on current mode and data.
     * @param {Object} feature - GeoJSON feature object.
     * @returns {Object} Leaflet style object.
     */
    getStyle(feature) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};
        // Use the delay percentage for congestion level determination
        const delayValue = this.currentMode === 'inbound'
            ? data.inboundDelay
            : data.outboundDelay;

        const congestionLevel = this.getCongestionLevelByTruckValue(delayValue);
        const fillColor = this.getColor(congestionLevel); // Use unified color scheme

        // Determine border weight based on congestion level for visual emphasis
        const weight = this.getRadiusByTruckValue(delayValue); // Using radius function to determine border weight

        return {
            fillColor: fillColor,
            weight: weight,
            opacity: 1,
            color: 'white', // Default border color is white
            fillOpacity: 0.7
        };
    }

    /**
     * Determines the congestion level string based on the truck data delay percentage.
     * Maps the delay percentage to 9 distinct congestion levels as per user's request.
     * @param {number} delayPercentage - The inboundDelay or outboundDelay value (percentage).
     * @returns {string} Congestion level string.
     */
    getCongestionLevelByTruckValue(delayPercentage) {
        if (delayPercentage == null || isNaN(delayPercentage)) return 'Unknown';

        // Volume Decrease (Higher Congestion)
        if (delayPercentage <= -15) return 'Extremely High Congestion';
        if (delayPercentage > -15 && delayPercentage <= -11) return 'Very High Congestion';
        if (delayPercentage > -11 && delayPercentage <= -6) return 'High Congestion';
        if (delayPercentage > -6 && delayPercentage < 0) return 'Moderate Congestion';

        // No Change (Neutral)
        if (delayPercentage === 0) return 'No Change (Steady)';

        // Volume Increase (Lower Congestion / Optimal Flow)
        if (delayPercentage > 0 && delayPercentage <= 5) return 'Low Congestion';
        if (delayPercentage > 5 && delayPercentage <= 10) return 'Very Low Congestion';
        if (delayPercentage > 10 && delayPercentage <= 15) return 'Minimal Congestion';
        if (delayPercentage > 15) return 'Optimal Flow (Highly Clear)';

        return 'Unknown';
    }

    /**
     * Returns the fill color based on the conceptual congestion level (9 levels).
     * Uses a diverging Blue-Gray-Red scale. Blue signifies good flow (volume increase),
     * Gray signifies no change, and Red signifies congestion (volume decrease).
     * @param {string} level - Congestion level string.
     * @returns {string} CSS color code.
     */
    getColor(level) {
        const fillColors = {
            'Extremely High Congestion': '#d73027', // Strong Red
            'Very High Congestion': '#fc8d59',      // Red-Orange
            'High Congestion': '#fdae61',           // Orange
            'Moderate Congestion': '#fee08b',       // Yellow-Orange
            'No Change (Steady)': '#9e9e9e',        // Gray (Consistent with Average in other maps)
            'Low Congestion': '#90CAF9',            // Light Blue
            'Very Low Congestion': '#64B5F6',       // Medium Blue
            'Minimal Congestion': '#42A5F5',        // Blue
            'Optimal Flow (Highly Clear)': '#2196F3', // Darker Blue
            'Unknown': '#cccccc'                    // Default grey
        };
        return fillColors[level] || '#cccccc';
    }

    /**
     * Returns a text color based on the conceptual congestion level for readability in tooltips.
     * @param {string} level - Congestion level string.
     * @returns {string} CSS color code for text.
     */
    getTextColorForLevel(level) {
        // Text colors adjusted for contrast on new background colors.
        const textColors = {
            'Extremely High Congestion': '#7f0000',  // Darker Red
            'Very High Congestion': '#b71c1c',       // Darker red
            'High Congestion': '#e65100',            // Darker orange
            'Moderate Congestion': '#616161',        // Darker gray (for yellow/orange backgrounds)
            'No Change (Steady)': '#333333',         // Darker gray for gray background
            'Low Congestion': '#1976D2',             // Darker blue
            'Very Low Congestion': '#1565C0',        // Darker blue
            'Minimal Congestion': '#0D47A1',         // Darker blue
            'Optimal Flow (Highly Clear)': '#0A3B8B', // Even Darker Blue
            'Unknown': '#5e5e5e'                      // Darker default gray
        };
        return textColors[level] || '#5e5e5e';
    }

    /**
     * Determines the border weight (acting as radius equivalent for polygon)
     * based on the truck data delay percentage. Higher congestion means thicker border.
     * @param {number} delayPercentage - The inboundDelay or outboundDelay value (percentage).
     * @returns {number} Border weight (in pixels).
     */
    getRadiusByTruckValue(delayPercentage) {
        if (delayPercentage == null || isNaN(delayPercentage)) return 1; // Default thin border

        // Border weights are inversely proportional to "goodness" of value (more negative % means thicker border)
        if (delayPercentage <= -15) return 4; // Extremely High Congestion
        if (delayPercentage > -15 && delayPercentage <= -11) return 3.5; // Very High Congestion
        if (delayPercentage > -11 && delayPercentage <= -6) return 3;   // High Congestion
        if (delayPercentage > -6 && delayPercentage < 0) return 2.5;   // Moderate Congestion
        if (delayPercentage === 0) return 2;                           // No Change (Steady)
        if (delayPercentage > 0 && delayPercentage <= 5) return 1.5;   // Low Congestion
        if (delayPercentage > 5 && delayPercentage <= 10) return 1.2;  // Very Low Congestion
        if (delayPercentage > 10 && delayPercentage <= 15) return 1;   // Minimal Congestion
        if (delayPercentage > 15) return 0.8;                         // Optimal Flow (Highly Clear)
        return 1; // Default
    }


    /**
     * Binds mouse events (mouseover, mouseout, click) to each state layer.
     * @param {Object} feature - GeoJSON feature object.
     * @param {L.Layer} layer - Leaflet layer for the feature.
     */
    bindEvents(feature, layer) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};

        layer.on({
            mouseover: (e) => {
                const center = layer.getBounds().getCenter();
                this.showTooltip(center, data);
                layer.setStyle({
                    weight: this.getRadiusByTruckValue(this.currentMode === 'inbound' ? data.inboundDelay : data.outboundDelay) + 1, // Make border slightly thicker on hover
                    color: 'white', // White border color on hover
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                this.map.closePopup();
                this.stateLayer.resetStyle(layer); // Revert to original style
            },
            click: () => this.zoomToState(feature)
        });
    }

    /**
     * Displays a tooltip popup for the given state data.
     * @param {L.LatLng} latlng - Latitude and longitude for the popup position.
     * @param {Object} data - State data to display in the tooltip.
     */
    showTooltip(latlng, data) {
        if (!this.initialized) return;

        const format = (v) => isNaN(Number(v)) ? 'N/A' : Number(v).toFixed(2); // Keep sign for display
        const isInbound = this.currentMode === 'inbound';
        const delayPercentage = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.dwellOutbound;
        
        const congestionLevel = this.getCongestionLevelByTruckValue(delayPercentage);
        const levelColor = this.getTextColorForLevel(congestionLevel);

        const content = `
            <h4>${data.name || 'Unknown State'}</h4>
            <p><strong>Congestion Level (${this.currentMode === 'inbound' ? 'Inbound' : 'Outbound'}):</strong>
                <span style="color: ${levelColor}; font-weight: bold;">
                    ${congestionLevel}
                </span>
            </p>
            <div>
                <strong>${isInbound ? 'Inbound Delay' : 'Outbound Delay'}:</strong>
                <p style="color: ${delayPercentage <= 0 ? this.getTextColorForLevel('Extremely High Congestion') : this.getTextColorForLevel('Optimal Flow (Highly Clear)')};">
                    ${delayPercentage >= 0 ? '↑' : '↓'} ${Math.abs(delayPercentage).toFixed(2)}%
                    <span style="color: ${this.getTextColorForLevel('No Change (Steady)')};"> compared to 2-week avg</span>
                </p>
            </div>
            <div>
                <strong>${isInbound ? 'Dwell Inbound' : 'Dwell Outbound'}:</strong>
                <p style="color: ${dwellValue >= 0 ? this.getTextColorForLevel('Extremely High Congestion') : this.getTextColorForLevel('Optimal Flow (Highly Clear)')};">
                    ${dwellValue >= 0 ? '↑' : '↓'} ${Math.abs(dwellValue).toFixed(2)}%
                    <span style="color: ${this.getTextColorForLevel('No Change (Steady)')};"> compared to 2-week avg</span>
                </p>
            </div>
        `;

        L.popup({
            className: 'truck-tooltip-container',
            maxWidth: 300,
            autoClose: false,
            closeButton: false,
            closeOnClick: false,
            offset: L.point(0, -10)
        })
        .setLatLng(latlng)
        .setContent(content)
        .openOn(this.map);
    }

    /**
     * Zooms the map to the bounding box of a selected state.
     * @param {Object} feature - GeoJSON feature object for the state.
     */
    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        const center = bounds.getCenter();
        const fixedZoomLevel = 7; // Apply a consistent zoom level for all states

        this.map.setView(center, fixedZoomLevel);
    }

    /**
     * Adds INBOUND/OUTBOUND toggle buttons to the top center of the map.
     */
    addToggleControls() {
        const centeredToggleDiv = L.DomUtil.create('div', 'map-control-container truck-toggle-map-control');
        this.map.getContainer().appendChild(centeredToggleDiv); // Append directly to map's DOM element for centering

        this.controlDiv = centeredToggleDiv; // Set reference to this div
        this.renderToggleButtons();

        // Prevent map events from propagating on the control
        L.DomEvent.disableClickPropagation(centeredToggleDiv);
        L.DomEvent.disableScrollPropagation(centeredToggleDiv);
    }

    /**
     * Renders the INBOUND/OUTBOUND toggle buttons and attaches event listeners.
     */
    renderToggleButtons() {
        this.controlDiv.innerHTML = `
            <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">INBOUND</button>
            <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUTBOUND</button>
        `;

        this.controlDiv.querySelectorAll('.truck-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentMode = btn.dataset.mode;
                this.renderToggleButtons(); // Update toggle button state
                this.stateLayer.setStyle(this.getStyle.bind(this)); // Re-style map based on new mode
                this.map.closePopup(); // Close any open popup when mode changes
            });
        });
    }

    /**
     * Adds reset button and state filter dropdown to the top right of the map.
     */
    addRightControls() {
        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            // Add state filter dropdown
            const states = this.geoJsonData.features
                .map(f => ({
                    id: f.id,
                    name: f.properties.name
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `
                <select class="state-filter">
                    <option value="">Select State</option>
                    ${states.map(state =>
                        `<option value="${state.id}">${state.name}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml); // Add dropdown first

            // Add reset button
            const resetButtonHtml = `
                <button class="truck-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml); // Add reset button after dropdown

            // Add event listeners (after elements are added to DOM)
            div.querySelector('.truck-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = ''; // Reset dropdown
                this.map.closePopup(); // Close any open popup
            });

            div.querySelector('.state-filter').addEventListener('change', (e) => {
                const stateId = e.target.value;
                if (!stateId) {
                    this.map.setView([37.8, -96], 4);
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    const bounds = L.geoJSON(state).getBounds();
                    const center = bounds.getCenter();
                    const fixedZoomLevel = 7; // Fixed zoom level for consistency

                    this.map.setView(center, fixedZoomLevel);
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control; // Now this becomes the grouped control
            return div;
        };
        control.addTo(this.map);
    }

    /**
     * Displays a temporary error message on the map.
     * @param {string} message - The error message to display.
     */
    showError(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const errorControl = L.control({ position: 'topleft' });
        errorControl.onAdd = function() {
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = message;
            return div;
        };
        errorControl.addTo(this.map);
        this.errorControl = errorControl;

        // Automatically remove message after 5 seconds
        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

window.TruckCongestionMap = TruckCongestionMap;
