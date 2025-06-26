class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 20,
            disableClusteringAtZoom: 7,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2,
            
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average');

                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0;
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
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.lastUpdatedControl = null;
        this.markerToOpenAfterMove = null;
        this.lastOpenedMarker = null;
        this.isMarkerClickHandled = false;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        // 지도 경계 설정: Leaflet의 setMaxBounds는 [[남위, 서경], [북위, 동경]] 형식의 배열을 받습니다.
        // 이전에 발생했던 ']' 오류의 원인이었던 잘못된 구문을 수정했습니다.
        this.map.setMaxBounds([
            [-85, -180], // 남서쪽 경계
            [85, 180]    // 북동쪽 경계
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
        });

        this.map.on('click', (e) => {
            setTimeout(() => {
                if (this.isMarkerClickHandled) {
                    this.isMarkerClickHandled = false;
                    console.log('Map click ignored (marker click handled).');
                    return;
                }

                console.log('Map background clicked.');
                if (this.lastOpenedMarker && this.map.hasLayer(this.lastOpenedMarker)) {
                    if (this.lastOpenedMarker.getPopup().isOpen()) {
                        this.lastOpenedMarker.closePopup();
                        console.log('Last opened popup closed.');
                    } else {
                        this.lastOpenedMarker.openPopup();
                        console.log('Last opened popup re-opened.');
                    }
                } else {
                    console.log('No last opened marker to manage.');
                }
            }, 50);
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
            console.warn(`pollForMarkerAndOpenPopup: Marker for yard '${yardName}' not found in current layers.`);
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
                if (targetMarker.getPopup().isOpen()) {
                    console.log(`Popup for ${targetMarker.options.itemData.Yard} successfully confirmed open.`);
                } else {
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
                lat: parseFloat(item.lat || item.Latitude),
                lng: parseFloat(item.lng || item.Longitude),
                Yard: item.location || item.Yard || item.Location || 'Unknown',
                location: item.location || item.Yard || item.Location || 'Unknown Location',
                company: item.company || item.Railroad || 'Unknown',
                congestion_score: parseFloat(item.congestion_score || item.DwellTime),
                indicator: parseFloat(item.indicator || item.Indicator),
                congestion_level: item.congestion_level || item.Category || 'Average',
                date: item.date || item.DateMonth
            })).filter(item =>
               !isNaN(item.lat) && !isNaN(item.lng) && item.location && item.congestion_level
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
                    
                    const offsetScale = 0.1;

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        const jitterLat = baseLat + (Math.cos(angle) * offsetScale);
                        const jitterLng = baseLng + (Math.sin(angle) * offsetScale);

                        item.lat = jitterLat;
                        item.lng = jitterLng;
                        jitteredData.push(item);
                    });
                } else {
                    jitteredData.push(itemsAtCoord[0]);
                }
            });

            this.currentData = jitteredData;

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers();
            this.addRightControls();
            this.addLastUpdatedText();
            // this.addLegend();

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

        if (!L.Browser.mobile) {
            this.allMarkers.off('clustermouseover');
            this.allMarkers.on('clustermouseover', (a) => {
                const clusterItems = a.layer.getAllChildMarkers().map(m => m.options.itemData);
                const childCount = clusterItems.length;

                const popupContent = `
                    <div class="cluster-hover-info">
                        <h4>${childCount} Locations Clustered</h4>
                        <p>Click or zoom in to see individual details.</p>
                    </div>
                `;

                L.popup({
                    closeButton: false,
                    autoClose: true,
                    closeOnClick: false,
                    maxHeight: 300,
                    maxWidth: 300
                })
               .setLatLng(a.latlng)
               .setContent(popupContent)
               .openOn(this.map);
            });

            this.allMarkers.off('clustermouseout');
            this.allMarkers.on('clustermouseout', () => {
                this.map.closePopup();
            });
        }
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
            maxWidth: 300
        };

        marker.bindPopup(this.createPopupContent([item]), popupOptions);
        
        if (!L.Browser.mobile) {
            marker.bindTooltip(`Yard: ${item.Yard}<br>Level: ${item.congestion_level}`, {
                permanent: false,
                direction: 'top',
                offset: L.point(0, -radius),
                className: 'custom-marker-tooltip'
            });
        }

        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} just opened. Z-index set.`);
            e.popup.getElement().style.zIndex = 10000;
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
        });
        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} just closed.`);
        });

        marker.on('click', (e) => {
            this.isMarkerClickHandled = true;
            console.log(`Clicked/Tapped marker: ${item.Yard}. Current popup state: ${marker.getPopup().isOpen()}`);
            
            if (marker.getPopup().isOpen()) {
                marker.closePopup();
            } else {
                this.map.closePopup();
                setTimeout(() => {
                    if (marker && marker._map) {
                        marker.openPopup();
                        if (!marker.getPopup().isOpen()) {
                            console.warn("Mobile/Click: Popup did not open immediately, trying map.openPopup.");
                            this.map.openPopup(marker.getPopup());
                        }
                    } else {
                        console.warn("Mobile/Click: Marker not available for popup after delay.");
                    }
                }, 100);
            }
        });

        return marker;
    }

    createPopupContent(items) {
        const safeItems = Array.isArray(items) ? items : [items];
        const isMultiple = safeItems.length > 1;
        let content = '';
        
        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                                <h4>${safeItems.length} Locations</h4>
                                <p>Showing clustered locations:</p>
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
            const congestionScore = (typeof item.congestion_score === 'number' && !isNaN(item.congestion_score)) ? item.congestion_score.toFixed(1) : 'N/A';
        
            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${congestionScore} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });
        
        if (isMultiple) {
            content += '</div>';
        }
        
        return content || '<p>No valid data to display for this location.</p>';
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
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
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
            const levels = ['Very High', 'High', 'Low', 'Very Low', 'Average'];
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
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#5fa9f6',
            'Very Low': '#004fc0',
            'Average': '#bcbcbc',
            'Unknown': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e',
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

// RailCongestionMap 클래스를 전역 스코프에 노출합니다.
window.RailCongestionMap = RailCongestionMap;
