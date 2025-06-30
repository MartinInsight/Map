class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId, { zoomControl: false }).setView([37.8, -96], 4);

        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 9,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2,
            showCoverageOnHover: false,
            showCoverageOnClick: false,

            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average');

                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Average': return 2;
                        case 'Low': return 1;
                        case 'Very Low': return 0;
                        default: return -1;
                    }
                };
                
                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData;
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level);
                        }
                    }
                });

                const childCount = cluster.getChildCount();
                const size = 30 + Math.min(childCount * 0.5, 30);

                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom',
                    iconSize: new L.Point(size, size)
                });
            }
        });

        this.currentData = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.markerToOpenAfterMove = null;
        this.lastOpenedMarker = null;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        this.loadData();

        this.map.on('popupopen', (e) => {
            if (e.popup && e.popup._source && e.popup._source instanceof L.Marker) {
                this.lastOpenedMarker = e.popup._source;
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.Yard} opened.`);
            }
        });

        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.Yard : 'unknown'} closed.`);
            if (this.lastOpenedMarker === e.popup._source) {
                this.lastOpenedMarker = null;
            }
        });

        this.map.on('click', (e) => {
            if (this.lastOpenedMarker && this.lastOpenedMarker.getPopup().isOpen()) {
                console.log('Map click: A marker popup is already open. Ignoring.');
            }
            if (this.markerToOpenAfterMove) {
                console.log('Map click: Waiting to open a marker popup. Ignoring.');
                return;
            }
            console.log('Map background clicked. Closing any open popups.');
            this.map.closePopup();
            this.lastOpenedMarker = null;
        });

        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const yardName = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null;
                this.pollForMarkerAndOpenPopup(yardName);
            }
        });
    }

    pollForMarkerAndOpenPopup(yardName) {
        let targetMarker = null;
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                targetMarker = layer;
                return;
            }
        });

        if (!targetMarker) {
            console.warn(`pollForMarkerAndOpenPopup: Marker for yard '${yardName}' not found in current layers (might be in a cluster).`);
            return;
        }

        if (!targetMarker.getPopup()) {
            console.warn("pollForMarkerAndOpenPopup: Invalid marker or no popup associated.");
            return;
        }

        this.map.closePopup();

        let attempts = 0;
        const maxAttempts = 30;
        const retryInterval = 100;

        const checkAndOpen = () => {
            if (targetMarker._icon && targetMarker._map) {
                console.log(`Poll success for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup();

                if (!targetMarker.getPopup().isOpen()) {
                    console.warn(`Popup for ${targetMarker.options.itemData.Yard} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup());
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${targetMarker.options.itemData.Yard} after max polling attempts.`);
            }
        };

        setTimeout(checkAndOpen, 50);
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            let processedData = rawData.map(item => ({
                lat: item.lat,
                lng: item.lng,
                Yard: item.location,
                location: item.location,
                company: item.company,
                dwell_time: item.dwell_time,
                indicator: item.indicator,
                congestion_level: item.congestion_level,
                average_value: parseFloat(item.Average),
                date: item.date
            })).filter(item =>
                item.lat !== undefined && item.lng !== undefined && item.location && item.congestion_level
            );

            const coordinateMap = new Map();

            processedData.forEach(item => {
                const coordKey = `${item.lat},${item.lng}`;
                if (!coordinateMap.has(coordKey)) {
                    coordinateMap.set(coordKey, []);
                }
                coordinateMap.get(coordKey).push(item);
            });

            const jitteredData = [];
            coordinateMap.forEach(itemsAtCoord => {
                if (itemsAtCoord.length > 1) {
                    const baseLat = itemsAtCoord[0].lat;
                    const baseLng = itemsAtCoord[0].lng;

                    const offsetScale = 0.15;

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        const jitterLat = baseLat + (Math.cos(angle) * offsetScale * Math.random());
                        const jitterLng = baseLng + (Math.sin(angle) * offsetScale * Math.random());

                        item.lat = jitterLat;
                        item.lng = jitterLng;
                        jitteredData.push(item);
                    });
                } else {
                    jitteredData.push(itemsAtCoord[0]);
                }
            });

            this.currentData = jitteredData;

            this.renderMarkers();
            this.addRightControls();

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }

    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty. Clearing map layers.");
            this.allMarkers.clearLayers();
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers);
            }
            return;
        }

        this.allMarkers.clearLayers();

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker);
        });

        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers);
        }

        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });
    }

    createSingleMarker(item) {
        const level = item.congestion_level || 'Average';
        const color = this.getColor(level);
        const radius = this.getRadiusByIndicator(item.indicator);

        const iconHtml = `
            <div style="
                background-color: ${color};
                width: ${radius * 2}px;
                height: ${radius * 2}px;
                border-radius: 50%;
                border: 1.5px solid white;
                box-shadow: 0 0 3px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
            "></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        });

        const marker = L.marker([item.lat, item.lng], {
            icon: customIcon,
            itemData: item
        });

        const popupOptions = {
            closeButton: true,
            autoClose: true,
            closeOnClick: true,
            maxHeight: 300,
            maxWidth: 300,
            className: 'single-marker-popup'
        };

        marker.bindPopup(this.createPopupContent([item]), popupOptions);

        marker.on('mouseover', (e) => {
            this.map.closePopup();
            e.target.openPopup();
        });

        marker.on('mouseout', (e) => {
            if (e.target.getPopup().isOpen()) {
                e.target.closePopup();
            }
        });

        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} just opened.`);
            e.popup.getElement().style.zIndex = 10000;
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
            this.lastOpenedMarker = e.target;
        });

        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} just closed.`);
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null;
            }
        });

        marker.on('click', (e) => {
            console.log(`Clicked/Tapped marker: ${item.Yard}. Current popup state: ${marker.getPopup().isOpen()}`);

            this.map.closePopup();

            if (this.allMarkers.hasLayer(marker)) {
                this.allMarkers.zoomToShowLayer(marker, () => {
                    marker.openPopup();
                    console.log(`Popup for ${item.Yard} opened after zoomToShowLayer.`);
                });
            } else {
                marker.openPopup();
                console.log(`Popup for ${item.Yard} opened directly.`);
            }
        });

        return marker;
    }

    createPopupContent(items) {
        const safeItems = Array.isArray(items) ? items : [items];
        let content = '';

        if (safeItems.length === 0) {
            return '<p>No valid data to display for this location.</p>';
        }

        const isMultiple = safeItems.length > 1;

        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                                <h4>${safeItems.length} Locations</h4>
                                <p>Showing individual details:</p>
                               </div>
                               <div class="cluster-popup-content">`;
        }

        safeItems.forEach(item => {
            if (!item || typeof item !== 'object' || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item in popup content:", item);
                return;
            }

            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            const dwellTime = (typeof item.dwell_time === 'number' && !isNaN(item.dwell_time)) ? item.dwell_time.toFixed(1) : 'N/A';
            const averageValue = (typeof item.average_value === 'number' && !isNaN(item.average_value)) ? item.average_value.toFixed(1) : 'N/A';


            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${dwellTime} hours</p>
                    <p><strong>Average:</strong> ${averageValue} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });

        if (isMultiple) {
            content += '</div>';
        }

        return content || '<p>No valid data to display for this location.</p>';
    }

    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }
        
        const control = L.control({ position: 'topright' });
        
        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');
            
            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);
            
            zoomControl.querySelector('.leaflet-control-zoom-in').addEventListener('click', (e) => {
                e.preventDefault();
                this.map.zoomIn();
            });
            
            zoomControl.querySelector('.leaflet-control-zoom-out').addEventListener('click', (e) => {
                e.preventDefault();
                this.map.zoomOut();
            });

            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `);
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);


            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (yardName === "All") {
                    console.log("Filter: All Yards selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup();
                    this.markerToOpenAfterMove = null;
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    const yardDataForFilter = this.currentData.filter(item => item.Yard === yardName);
                    if (yardDataForFilter.length > 0) {
                        let foundMarker = null;
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                                foundMarker = layer;
                                return;
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for filter: ${yardName}. Using zoomToShowLayer.`);
                            this.map.closePopup();
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                foundMarker.openPopup();
                                console.log(`Popup for ${yardName} opened after zoomToShowLayer.`);
                            });
                            this.markerToOpenAfterMove = null;
                        } else {
                            console.warn(`Marker object for yard '${yardName}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            this.markerToOpenAfterMove = yardName;
                        }
                    } else {
                        console.warn(`No data found for yard '${yardName}'.`);
                    }
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup();
                this.markerToOpenAfterMove = null;
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) {
                    yardFilter.value = '';
                    yardFilter.selectedIndex = 0;
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            const levels = ['Very High', 'High', 'Average', 'Low', 'Very Low'];
            const labels = [];

            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                const color = this.getColor(level);

                labels.push(
                    `<i style="background:${color}"></i> ${level}`
                );
            }

            div.innerHTML = '<h4>Congestion Level</h4>' + labels.join('<br>');
            return div;
        }.bind(this);

        legend.addTo(this.map);
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
            'Very High': '#E53935',
            'High': '#FFB300',
            'Average': '#9E9E9E',
            'Low': '#90CAF9',
            'Very Low': '#42A5F5',
            'Unknown': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#b71c1c',
            'High': '#e65100',
            'Average': '#616161',
            'Low': '#2196F3',
            'Very Low': '#1976D2',
            'Unknown': '#5e5e5e'
        };

        return isText ? textColors[level] : circleColors[level];
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

        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

window.RailCongestionMap = RailCongestionMap;
