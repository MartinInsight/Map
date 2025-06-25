/**
 * AirCongestionMap manages the air traffic congestion map using Leaflet.
 */
class AirCongestionMap {
    /**
     * Constructor for AirCongestionMap.
     * @param {string} mapElementId - ID of the HTML element where the map will be rendered.
     */
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = [];
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.lastUpdatedControl = null;
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

        this.addControls();
        this.loadData();
    }

    /**
     * Loads air data asynchronously from `data/us-air.json`.
     * Normalizes data, renders markers, and adds/updates controls.
     */
    async loadData() {
        try {
            const response = await fetch('data/us-air.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();

            // --- CHANGE START ---
            // Add municipality and iso_region to the mapped data
            this.currentData = rawData.map(item => ({
                ...item,
                lat: item.lat || item.latitude_deg,
                lng: item.lng || item.longitude_deg,
                Airport: item.airport_code || 'Unknown',
                municipality: item.municipality || 'Unknown City', // Ensure municipality is mapped
                iso_region: item.iso_region || 'Unknown Region' // Ensure iso_region is mapped
            })).filter(item => item.lat && item.lng && item.Airport);
            // --- CHANGE END ---

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].last_updated;
            }

            this.renderMarkers();
            this.addLastUpdatedText();
            this.addFilterControl();
        } catch (error) {
            console.error("Failed to load air data:", error);
            this.displayErrorMessage("Failed to load air data. Please try again later.");
        }
    }

    /**
     * Determines marker color based on TXO (Taxi-Out) value.
     * @param {number} txo - Average TXO value (in minutes).
     * @returns {string} - Hex color code.
     */
    getColorByTXO(txo) {
        if (txo == null) return '#cccccc';
        if (txo >= 25) return '#d73027';
        if (txo >= 20) return '#fc8d59';
        if (txo >= 15) return '#fee08b';
        if (txo >= 10) return '#d9ef8b';
        return '#1a9850';
    }

    /**
     * Determines marker radius based on TXO (Taxi-Out) value.
     * @param {number} txo - Average TXO value (in minutes).
     * @returns {number} - Radius in pixels.
     */
    getRadiusByTXO(txo) {
        if (txo == null) return 6;
        if (txo >= 25) return 14;
        if (txo >= 20) return 12;
        if (txo >= 15) return 10;
        if (txo >= 10) return 8;
        return 6;
    }

    /**
     * Renders or updates markers on the map.
     * @param {Array<Object>} [data=this.currentData] - Air data array.
     */
    renderMarkers(data = this.currentData) {
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        data.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getRadiusByTXO(item.average_txo),
                fillColor: this.getColorByTXO(item.average_txo),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.on({
                mouseover: (e) => {
                    this.map.closePopup();
                    const popup = L.popup()
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup();
                },
                click: () => {
                    this.map.closePopup();
                }
            });

            marker.addTo(this.map);
            this.markers.push(marker);
        });
    }

    /**
     * Generates HTML content for marker popup using 'map-tooltip' class.
     * @param {Object} data - Data object for popup.
     * @returns {string} - HTML string.
     */
    createPopupContent(data) {
        // --- CHANGE START ---
        // Extract region code (e.g., US-CA -> CA)
        const regionCode = data.iso_region ? data.iso_region.split('-').pop() : 'N/A';

        return `
            <div class="map-tooltip">
                <h4>${data.Airport || 'Unknown Airport'}</h4>
                <p><strong>${data.municipality || 'Unknown City'}, ${regionCode}</strong></p>
                <p><strong>Avg TXO:</strong> ${data.average_txo?.toFixed(2) || 'N/A'} min</p>
                <p><strong>Scheduled:</strong> ${data.scheduled || 'N/A'}</p>
                <p><strong>Departed:</strong> ${data.departed || 'N/A'}</p>
                <p><strong>Completion:</strong> ${data.completion_factor || 'N/A'}%</p>
            </div>
        `;
        // --- CHANGE END ---
    }

    /**
     * Adds general controls (e.g., reset button) to the map.
     */
    addControls() {
        const controlContainer = L.control({ position: 'topright' });

        controlContainer.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-container');
            div.innerHTML = `
                <button class="air-reset-btn reset-btn">Reset View</button>
            `;

            div.querySelector('.air-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                this.renderMarkers(this.currentData);
                if (this.filterControlInstance) {
                    const airportFilter = this.filterControlInstance._container.querySelector('.airport-filter');
                    if (airportFilter) airportFilter.value = '';
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            return div;
        };

        controlContainer.addTo(this.map);
    }

    /**
     * Adds the airport filter control (select box) to the map.
     */
    addFilterControl() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'bottomright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'filter-control');

            const validAirports = this.currentData
                .filter(item => item.Airport && item.Airport.trim() !== '')
                .map(item => item.Airport);
            const airports = [...new Set(validAirports)].sort((a, b) => a.localeCompare(b));

            div.innerHTML = `
                <select class="airport-filter">
                    <option value="">Select Airport</option>
                    ${airports.map(airport =>
                        `<option value="${airport}">${airport}</option>`
                    ).join('')}
                </select>
            `;

            div.querySelector('.airport-filter').addEventListener('change', (e) => {
                const airportName = e.target.value;
                if (!airportName) {
                    this.map.setView([37.8, -96], 4);
                    this.renderMarkers(this.currentData);
                    return;
                }

                const airportData = this.currentData.filter(item => item.Airport === airportName);
                if (airportData.length > 0) {
                    const center = this.getAirportCenter(airportData);
                    this.map.setView(center, 8); // Set fixed zoom level 8
                    this.renderMarkers(airportData);
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            return div;
        };

        control.addTo(this.map);
        this.filterControlInstance = control;
    }

    /**
     * Calculates the central coordinates for a given set of airport data.
     * @param {Array<Object>} airportData - Array of airport data objects.
     * @returns {Array<number>} - [latitude, longitude] of the center.
     */
    getAirportCenter(airportData) {
        if (!airportData || airportData.length === 0) return [37.8, -96];

        const lats = airportData.map(item => item.lat);
        const lngs = airportData.map(item => item.lng);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
    }

    /**
     * Adds a control to the map displaying the last data update time.
     */
    addLastUpdatedText() {
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const infoControl = L.control({ position: 'bottomleft' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                const date = new Date(this.lastUpdated);
                const formattedDate = date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: false
                });
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl;
        }
    }

    /**
     * This method would add an air congestion legend to the map.
     * It is commented out as per user request to remove the legend.
     */
    // addAirLegend() {
    //     if (this.legendControl) {
    //         this.map.removeControl(this.legendControl);
    //     }

    //     const legend = L.control({ position: 'bottomright' });

    //     legend.onAdd = () => {
    //         const div = L.DomUtil.create('div', 'air-legend');
    //         const grades = [0, 10, 15, 20, 25];
    //         const labels = ['Very Smooth', 'Smooth', 'Moderate', 'Congested', 'Very Congested'];
    //         const colors = ['#1a9850', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027'];

    //         div.innerHTML += '<div class="air-legend-title">Congestion (Avg Taxi-Out Time)</div>';

    //         for (let i = 0; i < grades.length; i++) {
    //             div.innerHTML +=
    //                 '<div class="air-legend-item">' +
    //                 '<span class="air-legend-color" style="background:' + colors[i] + '"></span> ' +
    //                 labels[i] + (grades[i + 1] ? ' (' + grades[i] + '-' + (grades[i+1]-1) + 'min)' : ' (' + grades[i] + '+ min)') +
    //                 '</div>';
    //         }
    //         return div;
    //     };

    //     legend.addTo(this.map);
    //     this.legendControl = legend;
    // }


    /**
     * Displays an error message control on the map.
     * @param {string} message - The error message to display.
     */
    displayErrorMessage(message) {
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

window.AirCongestionMap = AirCongestionMap;
