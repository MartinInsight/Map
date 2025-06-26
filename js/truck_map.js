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
        const colorValue = this.currentMode === 'inbound'
            ? data.inboundColor
            : data.outboundColor;

        const level = this.getCongestionLevelByTruckValue(colorValue);
        const fillColor = this.getColor(level);

        return {
            fillColor: fillColor,
            weight: 1,
            opacity: 1,
            color: 'white', // Default border color is white
            fillOpacity: 0.7
        };
    }

    /**
     * Determines the congestion level string based on the truck data color value.
     * Maps the -3 to 3 scale to 5 congestion levels.
     * @param {number} value - The inboundColor or outboundColor value (-3 to 3).
     * @returns {string} Congestion level string.
     */
    getCongestionLevelByTruckValue(value) {
        if (value == null || isNaN(value)) return 'Unknown';
        // Mapping -3 to 3 to 5 congestion levels
        // -3: Most delayed -> Very High
        // -2: Highly delayed -> High
        // -1: Moderately delayed -> Average
        // 0: Near average -> Average
        // 1: Slightly below average -> Low
        // 2: Moderately below average -> Low
        // 3: Significantly below average -> Very Low
        if (value === -3) return 'Very High';
        if (value === -2) return 'High';
        if (value === -1 || value === 0) return 'Average';
        if (value === 1 || value === 2) return 'Low';
        if (value === 3) return 'Very Low';
        return 'Unknown'; // Fallback for unexpected values
    }

    /**
     * Returns color based on congestion level for polygons or text.
     * This function is consistent with Ocean and Air maps.
     * @param {string} level - Congestion level string.
     * @param {boolean} [isText=false] - Whether to return text color.
     * @returns {string} CSS color code.
     */
    getColor(level, isText = false) {
        // Colors matched to RailCongestionMap's scheme:
        // Very Low: Blue, Low: Light Blue, Average: Gray, High: Orange, Very High: Red
        const circleColors = {
            'Very High': '#E53935',  // Red
            'High': '#FFB300',       // Orange
            'Average': '#9E9E9E',    // Gray
            'Low': '#90CAF9',        // Light Blue
            'Very Low': '#42A5F5',   // Blue
            'Unknown': '#cccccc'     // Default gray for unknown
        };

        // Text colors for better contrast
        const textColors = {
            'Very High': '#b71c1c',  // Darker red
            'High': '#e65100',       // Darker orange
            'Average': '#616161',    // Darker gray
            'Low': '#2196F3',        // Darker light blue
            'Very Low': '#1976D2',   // Darker blue
            'Unknown': '#5e5e5e'     // Darker default gray
        };

        return isText ? textColors[level] : circleColors[level];
    }

    /**
     * Determines the marker radius based on the truck data color value.
     * Lower value (more delayed) means larger radius.
     * @param {number} value - The inboundColor or outboundColor value (-3 to 3).
     * @returns {number} Marker radius (in pixels).
     */
    getRadiusByTruckValue(value) {
        if (value == null || isNaN(value)) return 10; // Default size for unknown/null
        // Radii inversely proportional to "goodness" of value (lower value = larger marker)
        if (value === -3) return 20; // Very High Congestion
        if (value === -2) return 18; // High Congestion
        if (value === -1 || value === 0) return 15; // Average Congestion
        if (value === 1 || value === 2) return 12; // Low Congestion
        if (value === 3) return 10; // Very Low Congestion
        return 10; // Default
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
                    weight: 2, // Thicker border on hover
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

        const format = (v) => isNaN(Number(v)) ? 'N/A' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.dwellOutbound;
        const colorValue = isInbound ? data.inboundColor : data.outboundColor; // Get the raw color value
        const congestionLevel = this.getCongestionLevelByTruckValue(colorValue);
        const levelColor = this.getColor(congestionLevel, true); // Get text color for the level

        const content = `
            <h4>${data.name || 'Unknown State'}</h4>
            <p><strong>Congestion Level (${this.currentMode.toUpperCase()}):</strong>
                <span style="color: ${levelColor}; font-weight: bold;">
                    ${congestionLevel}
                </span>
            </p>
            <div>
                <strong>Truck Movement Delay:</strong>
                <p style="color: ${delay >= 0 ? this.getColor('Very High', true) : this.getColor('Very Low', true)};">
                    ${delay >= 0 ? '↑' : '↓'} ${format(delay)}%
                    <span style="color: ${this.getColor('Average', true)};"> ${delay >= 0 ? 'above' : 'below'} 2-week avg</span>
                </p>
            </div>
            <div>
                <strong>Dwell Time:</strong>
                <p style="color: ${dwellValue >= 0 ? this.getColor('Very High', true) : this.getColor('Very Low', true)};">
                    ${dwellValue >= 0 ? '↑' : '↓'} ${format(dwellValue)}%
                    <span style="color: ${this.getColor('Average', true)};"> ${dwellValue >= 0 ? 'above' : 'below'} 2-week avg</span>
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
