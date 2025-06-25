class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = [];
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.lastUpdatedControl = null;

        // Initialize MarkerClusterGroup
        // chunkedLoading: 대량의 마커를 점진적으로 로드하여 성능 향상
        // maxClusterRadius: 클러스터링을 위한 마커 검색 반경 (픽셀). 낮을수록 더 많은 클러스터가 생성됨.
        // disableClusteringAtZoom: 이 줌 레벨 이상에서는 클러스터링이 비활성화되고 개별 마커가 표시됨.
        this.markerClusterGroup = L.markerClusterGroup({
            chunkedLoading: true,
            maxClusterRadius: 80, // Adjust as needed for cluster density
            disableClusteringAtZoom: 9, // At zoom level 9 and higher, clustering stops and individual markers appear
            iconCreateFunction: this._createClusterIcon.bind(this) // Custom function for cluster icon styling
        });
        this.map.addLayer(this.markerClusterGroup); // Add the cluster group to the map

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

        // Add cluster click listener for aggregated popup
        this.markerClusterGroup.on('clusterclick', (a) => {
            const cluster = a.layer; // The clicked cluster layer
            const childMarkers = cluster.getAllChildMarkers(); // Get all markers within this cluster
            let aggregatedContent = `<h4>Clustered Locations (${childMarkers.length})</h4><div style="max-height: 200px; overflow-y: auto;">`;

            // Aggregate information from all child markers
            childMarkers.forEach(marker => {
                const item = marker.options._rawData; // Access original data stored on the marker
                if (item) {
                    aggregatedContent += `
                        <p style="margin-bottom: 5px;">
                            <strong>${item.location || 'Unknown'}:</strong>
                            <span style="color: ${this.getColor(item.congestion_level, true)}">${item.congestion_level || 'N/A'}</span>,
                            ${item.congestion_score?.toFixed(1) || 'N/A'} hours
                        </p>
                    `;
                }
            });
            aggregatedContent += `</div>`;

            // Open a popup at the cluster's location with aggregated content
            L.popup({
                closeButton: true,
                autoClose: false, // Keep open until manually closed
                closeOnClick: false, // Don't close when clicking on map
                maxHeight: 250 // Limit max height for scrollability
            })
            .setLatLng(cluster.getLatLng()) // Use cluster's center for popup position
            .setContent(aggregatedContent)
            .openOn(this.map);
        });

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
            this.addRightControls();
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
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            });

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
        this.markerClusterGroup.clearLayers(); // Clear all markers from the cluster group before re-rendering
        this.markers = []; // Clear internal array for fresh markers

        data.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getRadiusByIndicator(item.indicator),
                fillColor: this.getColor(item.congestion_level),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8,
                _rawData: item // Store original data directly on the marker options
            });

            // Bind mouseover/mouseout/click events for individual markers (when not clustered)
            marker.on({
                mouseover: (e) => {
                    this.map.closePopup();
                    L.popup({ closeButton: false, autoClose: true, closeOnClick: true })
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup();
                },
                click: (e) => {
                    this.map.closePopup();
                    // Zoom in to a fixed level if the current zoom is less than 8
                    this.map.setView(e.latlng, Math.max(this.map.getZoom(), 8));
                    L.popup({ closeButton: true, autoClose: false, closeOnClick: false })
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                }
            });

            this.markerClusterGroup.addLayer(marker); // Add marker to the cluster group
            this.markers.push(marker); // Keep reference in the internal array
        });
    }

    // Helper to rank congestion levels from lowest (1) to highest (5)
    _getCongestionRank(level) {
        switch (level) {
            case 'Very Low': return 1;
            case 'Low': return 2;
            case 'Average': return 3;
            case 'High': return 4;
            case 'Very High': return 5;
            default: return 0; // For 'Unknown' or other cases
        }
    }

    // Custom icon creation function for marker clusters
    _createClusterIcon(cluster) {
        const childMarkers = cluster.getAllChildMarkers();
        let highestRank = 0;
        let mostCongestedLevel = 'Average'; // Default to Average if no data or unknown levels

        // Find the most congested level among all child markers
        childMarkers.forEach(marker => {
            const markerData = marker.options._rawData; // Access original data
            if (markerData && markerData.congestion_level) {
                const currentRank = this._getCongestionRank(markerData.congestion_level);
                if (currentRank > highestRank) {
                    highestRank = currentRank;
                    mostCongestedLevel = markerData.congestion_level;
                }
            }
        });

        // Get the color for the most congested level
        const backgroundColor = this.getColor(mostCongestedLevel);
        const childCount = cluster.getChildCount(); // Number of markers in this cluster
        const iconSize = 40; // Fixed medium size for cluster icon

        // Return a custom divIcon for the cluster
        return L.divIcon({
            html: `
                <div style="
                    background-color: ${backgroundColor};
                    width: ${iconSize}px;
                    height: ${iconSize}px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white; /* Text color */
                    font-weight: bold;
                    font-size: 16px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1); /* Consistent shadow for individual elements */
                ">
                    <span>${childCount}</span>
                </div>
            `,
            className: 'marker-cluster-custom', // Custom class for additional styling if needed
            iconSize: [iconSize, iconSize] // Set icon size
        });
    }

    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="">Select Yard</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            const resetButtonHtml = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

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
                    this.map.setView(center, 8);
                    // When a filter is applied, we want to re-render ALL current data,
                    // but the view will be focused on the filtered item.
                    // Marker clustering will handle showing only relevant markers or clusters.
                    this.renderMarkers(this.currentData);
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

            this.filterControlInstance = control;
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
        if (indicator == null) return 5; // Default radius for null indicator
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
            'Average': '#bcbcbc',
            'Unknown': '#cccccc' // Added for unknown levels
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e',
            'Unknown': '#5e5e5e' // Added for unknown levels
        };

        return isText ? textColors[level] || textColors['Unknown'] : circleColors[level] || circleColors['Unknown'];
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
