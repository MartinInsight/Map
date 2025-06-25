class TruckCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.stateLayer = null;
        this.currentMode = 'inbound';
        this.metricData = null;
        this.geoJsonData = null;
        this.initialized = false;
        this.controlDiv = null;
        this.errorControl = null;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18,
            minZoom: 2
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
            this.addControls();
            this.addFilterControl();
            this.initialized = true;
        } catch (err) {
            console.error("Initialization failed:", err);
            this.showError("Failed to load truck data. Please try again later.");
        }
    }

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

    renderMap() {
        if (this.stateLayer) this.map.removeLayer(this.stateLayer);

        this.stateLayer = L.geoJSON(this.geoJsonData, {
            style: this.getStyle.bind(this),
            onEachFeature: this.bindEvents.bind(this)
        }).addTo(this.map);
    }

    getStyle(feature) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};
        const colorValue = this.currentMode === 'inbound'
            ? data.inboundColor
            : data.outboundColor;

        return {
            fillColor: this.getColor(colorValue),
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.7
        };
    }

    getColor(value) {
        const colors = {
            '-3': '#d73027',
            '-2': '#f46d43',
            '-1': '#fdae61',
            '0': '#ffffbf',
            '1': '#a6d96a',
            '2': '#66bd63',
            '3': '#1a9850'
        };
        return colors[value] || '#cccccc';
    }

    bindEvents(feature, layer) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};

        layer.on({
            mouseover: (e) => {
                const center = layer.getBounds().getCenter();
                this.showTooltip(center, data);
                layer.setStyle({
                    weight: 3,
                    color: '#666',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                this.map.closePopup();
                this.stateLayer.resetStyle(layer);
            },
            click: () => this.zoomToState(feature)
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized) return;

        const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.dwellOutbound;

        // --- CHANGE START (Tooltip Class Name) ---
        const content = `
            <div class="map-tooltip">
                <h4>${data.name || 'Unknown'}</h4>
                <div>
                    <strong>Truck Movement</strong>
                    <p class="${delay >= 0 ? 'truck-positive' : 'truck-negative'}">
                        ${delay >= 0 ? '↑' : '↓'} ${format(delay)}%
                        <span class="truck-normal-text">${delay >= 0 ? 'above' : 'below'} 2-week avg</span>
                    </p>
                </div>
                <div>
                    <strong>Dwell Time</strong>
                    <p class="${dwellValue >= 0 ? 'truck-positive' : 'truck-negative'}">
                        ${dwellValue >= 0 ? '↑' : '↓'} ${format(dwellValue)}%
                        <span class="truck-normal-text">${dwellValue >= 0 ? 'above' : 'below'} 2-week avg</span>
                    </p>
                </div>
            </div>
        `;
        // --- CHANGE END (Tooltip Class Name) ---

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

    // --- CHANGE START (Consistent Zoom) ---
    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        const center = bounds.getCenter();
        const fixedZoomLevel = 7; // Adjust this value for desired zoom consistency

        this.map.setView(center, fixedZoomLevel);
        // No need to call renderMap() here, as stateLayer already manages all states
        // and we only want to change the view.
    }
    // --- CHANGE END (Consistent Zoom) ---

    addControls() {
        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-container');
            this.controlDiv = div;
            this.renderControls();
            return div;
        };

        control.addTo(this.map);
    }

    renderControls() {
        this.controlDiv.innerHTML = `
            <div class="truck-toggle-container">
                <div class="truck-toggle-wrapper">
                    <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">INBOUND</button>
                    <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUTBOUND</button>
                </div>
                <button class="truck-reset-btn reset-btn">Reset View</button>
            </div>
        `;

        this.controlDiv.querySelectorAll('.truck-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentMode = btn.dataset.mode;
                this.renderControls();
                this.stateLayer.setStyle(this.getStyle.bind(this));
            });
        });

        this.controlDiv.querySelector('.truck-reset-btn').addEventListener('click', () => {
            this.map.setView([37.8, -96], 4);
            // Reset filter dropdown if it exists
            if (this.filterControlInstance) {
                const stateFilter = this.filterControlInstance._container.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
            }
        });
    }

    addFilterControl() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'bottomright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'filter-control');

            const states = this.geoJsonData.features
                .map(f => ({
                    id: f.id,
                    name: f.properties.name
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            div.innerHTML = `
                <select class="state-filter">
                    <option value="">Select State</option>
                    ${states.map(state =>
                        `<option value="${state.id}">${state.name}</option>`
                    ).join('')}
                </select>
            `;

            div.querySelector('.state-filter').addEventListener('change', (e) => {
                const stateId = e.target.value;
                if (!stateId) {
                    this.map.setView([37.8, -96], 4);
                    // No need to re-render all state layers here, they are always present.
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    // --- CHANGE START (Consistent Zoom for filter dropdown) ---
                    const bounds = L.geoJSON(state).getBounds();
                    const center = bounds.getCenter();
                    const fixedZoomLevel = 7; // Match the zoomToState fixed level

                    this.map.setView(center, fixedZoomLevel);
                    // --- CHANGE END (Consistent Zoom for filter dropdown) ---
                }
            });

            return div;
        };

        control.addTo(this.map);
        this.filterControlInstance = control;
    }

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
    }
}

window.TruckCongestionMap = TruckCongestionMap;
