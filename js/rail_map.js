class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40, 
            disableClusteringAtZoom: 9, 
            spiderfyOnMaxZoom: true, 
            
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
        this.markerToOpenAfterMove = null; // Property to hold marker for delayed opening

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

        // Close popup when clicking on the map itself (outside of a marker/popup)
        this.map.on('click', () => {
            console.log("Map clicked, closing popup.");
            this.map.closePopup();
        });

        // Listen for map move/zoom end events to open queued popups from filter selection
        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup.');
                const targetMarker = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null; // Clear the queue immediately

                // Ensure any previous popups are closed
                this.map.closePopup(); 
                
                // If the marker is within a cluster, spiderfy it first
                // Leaflet.MarkerCluster handles this internally with openPopup()
                // but sometimes an explicit spiderfy helps ensure visibility before popup attempts.
                const cluster = this.allMarkers.getVisibleParent(targetMarker);
                if (cluster && cluster.isCluster()) {
                    console.log("Marker is in a cluster, spiderfying...");
                    cluster.spiderfy();
                }

                // Give a very small delay to allow spiderfy/rendering to complete
                // before opening the popup, especially critical for complex clusters.
                setTimeout(() => {
                    if (targetMarker && targetMarker._map) { // Check if marker is truly on the map
                        targetMarker.openPopup();
                        console.log(`Popup opened for ${targetMarker.options.itemData.Yard}`);
                    } else {
                        console.warn('Queued marker not found on map after moveend/spiderfy, cannot open popup.');
                    }
                }, 50); // Small delay
            }
        });
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
                congestion_score: parseFloat(item.congestion_score || item['Dwell Time']),
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

        // Cluster mouseover/mouseout for desktop hover info
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

                const popup = L.popup({
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
            autoClose: false, // We'll manage closing manually
            closeOnClick: false, // We'll manage closing manually on marker click/tap
            maxHeight: 300,
            maxWidth: 300
        };

        // Bind popup content once
        marker.bindPopup(this.createPopupContent([item]), popupOptions);

        // Desktop specific hover logic
        if (!L.Browser.mobile) {
            marker.on('mouseover', () => {
                console.log("PC: Mouseover on marker.");
                this.map.closePopup(); // Close any other open popups first
                marker.openPopup();
            });
            // PC: Close popup when mouse leaves the marker, if it was opened by hover
            marker.on('mouseout', () => {
                console.log("PC: Mouseout from marker.");
                // Check if the current popup is the one we just moused out of
                if (marker.getPopup() && marker.getPopup().isOpen() && marker.getPopup()._source === marker) {
                    marker.closePopup();
                }
            });
            // Desktop click to toggle popup
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e); // Prevent map's click from interfering
                console.log("PC: Clicked marker, toggling popup.");
                if (marker.getPopup().isOpen()) {
                    marker.closePopup();
                } else {
                    this.map.closePopup(); // Close any other open popups first
                    marker.openPopup();
                }
            });
        } else {
            // Mobile specific tap logic
            marker.on('click', (e) => { // Leaflet's 'click' event is optimized for mobile 'tap'
                L.DomEvent.stopPropagation(e); // Prevent map's tap from interfering
                console.log("Mobile: Tapped marker, toggling popup.");
                if (marker.getPopup().isOpen()) {
                    marker.closePopup();
                } else {
                    this.map.closePopup(); // Close any other open popups first
                    marker.openPopup();
                }
            });
        }

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
                    console.log("Filter: All Yards selected.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup(); 
                    this.markerToOpenAfterMove = null; 
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    const yardDataForFilter = this.currentData.filter(item => item.Yard === yardName);
                    if (yardDataForFilter.length > 0) {
                        const center = this.getYardCenter(yardDataForFilter);
                        console.log(`Setting view to center: ${center}`);
                        this.map.setView(center, 8); 
                        
                        // Find the actual Leaflet marker to queue for opening
                        // Iterate through ALL individual markers within the cluster group
                        let foundMarkerForFilter = null;
                        
                        // Using getLayers() to get all individual markers directly added to the group
                        const allIndividualMarkers = this.allMarkers.getLayers(); 
                        for (const marker of allIndividualMarkers) {
                            if (marker.options.itemData && marker.options.itemData.Yard === yardName) {
                                foundMarkerForFilter = marker;
                                console.log(`Found marker object for filter: ${yardName}`);
                                break; 
                            }
                        }

                        this.markerToOpenAfterMove = foundMarkerForFilter;
                        if (!foundMarkerForFilter) {
                            console.warn(`No individual marker object found for yard '${yardName}' after filter selection.`);
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
                this.markerToOpenAfterMove = null; // Clear any pending popup
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

window.RailCongestionMap = RailCongestionMap;
