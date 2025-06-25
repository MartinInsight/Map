class TruckCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = [];
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null; // Ensure errorControl is initialized

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

    async loadData() {
        try {
            const response = await fetch('data/us-truck.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();

            // Filter out items without valid lat/lng or name
            this.currentData = rawData.filter(item => item.Latitude && item.Longitude && item.Location).map(item => ({
                ...item,
                lat: item.Latitude,
                lng: item.Longitude,
                name: item.Location // Ensure 'name' property exists for consistency
            }));

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].Date;
            }

            this.renderMarkers();
            this.addLastUpdatedText();
            this.addFilterControl();

        } catch (error) {
            console.error("Failed to load truck data:", error);
            this.displayErrorMessage("Failed to load truck data. Please try again later.");
        }
    }

    addLastUpdatedText() {
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            const formattedDate = `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;

            const infoControl = L.control({ position: 'bottomleft' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl;
        }
    }

    renderMarkers(data = this.currentData) {
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        data.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getMarkerRadius(item.Volume),
                fillColor: this.getColor(item.Congestion),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.on({
                mouseover: (e) => {
                    this.map.closePopup(); // Close any existing popups before showing a new one
                    const popup = L.popup({
                        closeButton: false, // Don't show the close button on hover
                        autoClose: true, // Auto-close when mouse leaves
                        closeOnClick: false // Don't close if clicked
                    })
                        .setLatLng(e.latlng)
                        .setContent(this.showTooltip(item))
                        .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup(); // Close popup when mouse leaves
                },
                click: (e) => {
                    this.map.closePopup(); // Close existing popup
                    this.map.setView(e.latlng, 8); // Zoom in on click

                    // Show sticky popup on click
                    L.popup({
                        closeButton: true,
                        autoClose: false, // Keep open until manually closed
                        closeOnClick: false // Don't close when clicking on map
                    })
                        .setLatLng(e.latlng)
                        .setContent(this.showTooltip(item))
                        .openOn(this.map);
                }
            });

            marker.addTo(this.map);
            this.markers.push(marker);
        });
    }

    addControls() {
        const controlContainer = L.control({ position: 'topright' });

        controlContainer.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-container');
            div.innerHTML = `
                <button class="truck-reset-btn reset-btn">Reset View</button>
            `;

            div.querySelector('.truck-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                this.renderMarkers(this.currentData);
                 if (this.filterControlInstance) {
                    const locationFilter = this.filterControlInstance._container.querySelector('.location-filter');
                    if (locationFilter) locationFilter.value = '';
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            return div;
        };

        controlContainer.addTo(this.map);
    }

    addFilterControl() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'bottomright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'filter-control');

            const validLocations = this.currentData
                .filter(item => item.Location && item.Location.trim() !== '')
                .map(item => item.Location);

            const locations = [...new Set(validLocations)].sort((a, b) => a.localeCompare(b));

            div.innerHTML = `
                <select class="location-filter">
                    <option value="">Select Location</option>
                    ${locations.map(location =>
                        `<option value="${location}">${location}</option>`
                    ).join('')}
                </select>
            `;

            div.querySelector('.location-filter').addEventListener('change', (e) => {
                const locationName = e.target.value;
                if (!locationName) {
                    this.map.setView([37.8, -96], 4);
                    this.renderMarkers(this.currentData);
                    return;
                }

                const locationData = this.currentData.filter(item => item.Location === locationName);
                if (locationData.length > 0) {
                    const center = this.getLocationCenter(locationData);
                    this.map.setView(center, 8); // Use fixed zoom level 8 for consistency
                    this.renderMarkers(this.currentData); // Keep all markers visible
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            return div;
        };

        control.addTo(this.map);
        this.filterControlInstance = control;
    }

    getLocationCenter(locationData) {
        if (!locationData || locationData.length === 0) return [37.8, -96];

        const lats = locationData.map(item => item.Latitude);
        const lngs = locationData.map(item => item.Longitude);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
    }

    getMarkerRadius(volume) {
        if (volume > 500000) return 20;
        if (volume > 200000) return 16;
        if (volume > 100000) return 12;
        if (volume > 50000) return 8;
        return 5;
    }

    getColor(congestion) {
        if (congestion === 'Very High') return '#d62828';
        if (congestion === 'High') return '#f88c2b';
        if (congestion === 'Low') return '#5fa9f6';
        if (congestion === 'Very Low') return '#004fc0';
        return '#bcbcbc'; // Average or Unknown
    }

    getCongestionTextColor(congestion) {
        if (congestion === 'Very High') return '#6b1414';
        if (congestion === 'High') return '#7c4616';
        if (congestion === 'Low') return '#30557b';
        if (congestion === 'Very Low') return '#002860';
        return '#5e5e5e'; // Average or Unknown
    }

    showTooltip(data) {
        const congestionLevel = data.Congestion || 'N/A';
        const delay = data.DelayPercentage !== undefined ? data.DelayPercentage : 'N/A';
        const dwellValue = data.DwellTimePercentage !== undefined ? data.DwellTimePercentage : 'N/A';

        const format = (value) => {
            if (typeof value === 'number') {
                return value.toFixed(1);
            }
            return value;
        };

        // Removed the <div class="map-tooltip"> wrapper as requested
        return `
            <h4>${data.Location || 'Unknown'}</h4>
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
            <p><strong>Congestion Level:</strong> <span style="color: ${this.getCongestionTextColor(congestionLevel)}">${congestionLevel}</span></p>
        `;
    }

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

window.TruckCongestionMap = TruckCongestionMap;
