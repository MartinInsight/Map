class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = [];
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null; // Ensure errorControl is initialized

        // 지도 타일 레이어를 CartoDB Light All로 변경하여 영어 지명 통일
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

        // this.addControls(); // Old call, removed
        this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();

            this.currentData = rawData.map(item => ({
                ...item,
                lat: item.lat || item.Latitude,
                lng: item.lng || item.Longitude,
                Yard: item.location || 'Unknown'
            })).filter(item => item.lat && item.lng && item.Yard);

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers();
            this.addLastUpdatedText();
            // Call the new combined controls method after data is loaded
            this.addRightControls(); // Now combines filter and reset
        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
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
                radius: this.getRadiusByIndicator(item.indicator),
                fillColor: this.getColor(item.congestion_level),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.on({
                mouseover: (e) => {
                    this.map.closePopup();
                    const popup = L.popup({
                        closeButton: false,
                        autoClose: true,
                        closeOnClick: true
                    })
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup();
                },
                click: (e) => {
                    this.map.closePopup();
                    this.map.setView(e.latlng, 8);

                    L.popup({
                        closeButton: true,
                        autoClose: false,
                        closeOnClick: false
                    })
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                }
            });

            marker.addTo(this.map);
            this.markers.push(marker);
        });
    }

    // New combined method for right-side controls (Filter and Reset)
    addRightControls() {
        if (this.filterControlInstance) { // Using filterControlInstance for the whole group
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right'); // Use the grouping class

            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            // Select Yard dropdown (added first)
            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="">Select Yard</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml); // Insert dropdown

            // Reset View button (added second)
            const resetButtonHtml = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml); // Insert reset button

            // Event Listeners (after elements are in the DOM)
            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (!yardName) {
                    this.map.setView([37.8, -96], 4);
                    this.renderMarkers(this.currentData);
                    return;
                }

                const yardData = this.currentData.filter(item => item.Yard === yardName);
                if (yardData.length > 0) {
                    const center = this.getYardCenter(yardData);
                    this.map.setView(center, 8); // Use fixed zoom level 8 for consistency
                    this.renderMarkers(this.currentData); // Keep all markers visible
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) yardFilter.value = '';
                this.renderMarkers(this.currentData); // Ensure all markers are rendered on reset
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control; // Store the whole combined control
            return div;
        };

        control.addTo(this.map);
    }


    getYardCenter(yardData) {
        if (!yardData || yardData.length === 0) return [37.8, -96];

        const lats = yardData.map(item => item.lat);
        const lngs = yardData.map(item => item.lng);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
    }

    getRadiusByIndicator(indicator) {
        if (indicator > 2) return 20;
        if (indicator > 1) return 16;
        if (indicator > -1) return 12;
        if (indicator > -2) return 8;
        return 5;
    }

    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#5fa9f6',
            'Very Low': '#004fc0',
            'Average': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e'
        };

        return isText ? textColors[level] : circleColors[level];
    }

    createPopupContent(data) {
        const level = data.congestion_level || 'Unknown';

        return `
            <h4>${data.location || 'Unknown Location'}</h4>
            <p><strong>Company:</strong> ${data.company || 'Unknown'}</p>
            <p><strong>Congestion Level:</strong>
                <span style="color: ${this.getColor(level, true)}">
                    ${level}
                </span>
            </p>
            <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
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

window.RailCongestionMap = RailCongestionMap;
