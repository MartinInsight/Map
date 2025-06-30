/**
 * AirCongestionMap manages the air traffic congestion map using Leaflet and Leaflet.markercluster.
 */
class AirCongestionMap {
    /**
     * Constructor for AirCongestionMap.
     * @param {string} mapElementId - ID of the HTML element where the map will be rendered.
     */
    constructor(mapElementId) {
        // Leaflet map initialization: set default view and zoom level (US centric)
        // Disable default zoom control to allow manual addition in our desired position.
        this.map = L.map(mapElementId, { zoomControl: false }).setView([37.8, -96], 4);

        // Marker cluster group initialization
        // - maxClusterRadius: Maximum pixel distance for clustering (reduced to 40px for faster declustering)
        // - disableClusteringAtZoom: Disable clustering from this zoom level (display individual markers)
        // - spiderfyOnMaxZoom: Spiderfy at max zoom (disperse overlapping markers)
        // - spiderfyDistanceMultiplier: Adjust distance between markers when spiderfying
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 9,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2,
            showCoverageOnHover: false,
            showCoverageOnClick: false,

            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestTXOValue = -1; // Represents the "worst" congestion
                let dominantLevel = 'Average'; // Default to Average level for clusters
                let dominantColor = this.getColor(dominantLevel); // Default to Average color

                // Determine the highest congestion level (highest TXO) within the cluster
                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData;
                    if (itemData && typeof itemData.average_txo === 'number' && !isNaN(itemData.average_txo)) {
                        if (itemData.average_txo > highestTXOValue) {
                            highestTXOValue = itemData.average_txo;
                            dominantLevel = this.getCongestionLevelByTXO(itemData.average_txo);
                            dominantColor = this.getColor(dominantLevel);
                        }
                    }
                });

                const childCount = cluster.getChildCount();
                // Dynamically adjust cluster size based on the number of child markers
                const size = 30 + Math.min(childCount * 0.5, 30);

                // Create custom cluster icon (circular, background color based on highest congestion)
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom', // Class for CSS styling
                    iconSize: new L.Point(size, size)
                });
            }
        });

        this.currentData = null; // Currently loaded data
        this.filterControlInstance = null; // Filter control instance
        this.errorControl = null; // Error message control
        // 이 부분을 변경합니다: 이제 로케이션 선택 시 로케이션 문자열을 저장합니다.
        this.locationToOpenAfterMove = null; // Location string for popup to open after map move
        this.lastOpenedMarker = null; // Reference to the last opened popup's marker

        // Add map tile layer (CARTO Light All)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        // Set map boundaries (worldwide coverage)
        this.map.setMaxBounds([
            [-85, -180], // South-west bounds
            [85, 180]    // North-east bounds
        ]);

        // Start loading data
        this.loadData();

        // Popup open event handler
        this.map.on('popupopen', (e) => {
            if (e.popup && e.popup._source && e.popup._source instanceof L.Marker) {
                this.lastOpenedMarker = e.popup._source;
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.Airport} opened.`);
            }
        });

        // Popup close event handler
        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.Airport : 'unknown'} closed.`);
            if (this.lastOpenedMarker === e.popup._source) {
                this.lastOpenedMarker = null; // Remove closed popup's marker from lastOpenedMarker
            }
        });

        // Map click event handler adjustment (for clicking on map background)
        this.map.on('click', (e) => {
            // Close existing popups when map background is clicked
            // This ensures only one popup is open at a time (if a marker's popup was opened manually)
            console.log('Map background clicked. Closing any open popups.');
            this.map.closePopup();
            this.lastOpenedMarker = null;
        });

        // Map move end event handler
        this.map.on('moveend', () => {
            // markerToOpenAfterMove 대신 locationToOpenAfterMove를 사용
            if (this.locationToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling for location.');
                const selectedLocation = this.locationToOpenAfterMove;
                this.locationToOpenAfterMove = null; // Reset
                this.pollForLocationMarkerAndOpenPopup(selectedLocation); // 새로운 함수 호출
            }
        });
    }

    /**
     * Finds a marker for a specific location (municipality, iso_region) and opens its popup using polling
     * once the marker is ready (rendered on the map).
     * @param {string} locationString - The location string (e.g., "Los Angeles, CA") for which a marker's popup should be opened.
     */
    pollForLocationMarkerAndOpenPopup(locationString) {
        let targetMarker = null;
        const [municipality, regionCode] = locationString.split(', ').map(s => s.trim());

        // 해당 로케이션의 첫 번째 마커를 찾습니다.
        this.allMarkers.eachLayer(layer => {
            const itemData = layer.options.itemData;
            if (itemData && itemData.municipality === municipality && itemData.iso_region.endsWith(`-${regionCode}`)) {
                targetMarker = layer;
                return true; // Leaflet eachLayer's return acts as a break
            }
        });

        if (!targetMarker) {
            console.warn(`pollForLocationMarkerAndOpenPopup: Marker for location '${locationString}' not found in current layers (might be in a cluster).`);
            return;
        }

        // Check if a popup is already bound to the marker
        if (!targetMarker.getPopup()) {
            console.warn("pollForLocationMarkerAndOpenPopup: Invalid marker or no popup associated.");
            return;
        }

        // Close existing popups (always close before opening a new one)
        this.map.closePopup();

        let attempts = 0;
        const maxAttempts = 30; // Maximum number of attempts
        const retryInterval = 100; // Retry interval in ms

        const checkAndOpen = () => {
            // Check if the marker's _icon is added to the DOM and belongs to the map
            if (targetMarker._icon && targetMarker._map) {
                console.log(`Poll success for ${targetMarker.options.itemData.Airport} at ${locationString} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup(); // Attempt to open popup directly on marker

                // Verify if the popup actually opened (for stability with filtering)
                if (!targetMarker.getPopup().isOpen()) {
                    console.warn(`Popup for ${targetMarker.options.itemData.Airport} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup());
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${targetString} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${targetString} after max polling attempts.`);
            }
        };

        // this.allMarkers.zoomToShowLayer를 호출하여 마커를 드러내고 팝업을 엽니다.
        // 이를 통해 마커가 클러스터 안에 있어도 정확히 찾아 팝업을 띄울 수 있습니다.
        this.allMarkers.zoomToShowLayer(targetMarker, () => {
            setTimeout(checkAndOpen, 50); // 줌 이동 후 팝업을 엽니다.
        });
    }


    /**
     * Loads air data asynchronously from `data/us-air.json`.
     * Normalizes data, handles duplicate coordinates with jittering,
     * renders markers, and adds/updates controls.
     */
    async loadData() {
        try {
            const response = await fetch('data/us-air.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            // Data cleansing and parsing
            let processedData = rawData.map(item => ({
                lat: item.latitude_deg, // Ensure latitude_deg is used
                lng: item.longitude_deg, // Ensure longitude_deg is used
                Airport: item.airport_code, // Standardized as 'airport_code'
                name: item.name, // Airport full name
                municipality: item.municipality,
                iso_region: item.iso_region,
                average_txo: parseFloat(item.average_txo), // Parse TXO to float
                scheduled: item.scheduled,
                departed: item.departed,
                completion_factor: item.completion_factor,
                last_updated: item.last_updated // Keep this for potential future use or debugging, but not for UI display as per Rail version
            })).filter(item =>
                // Basic validation: ensure lat, lng, and Airport code exist
                typeof item.lat === 'number' && typeof item.lng === 'number' && item.Airport && item.Airport.trim() !== ''
            );

            const coordinateMap = new Map();

            // Handle duplicate coordinates: apply slight jittering to prevent markers from overlapping on the map
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

                    const offsetScale = 0.15; // Jittering offset scale (smaller for air data usually)

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        // Apply jittering to both latitude and longitude to disperse in a circular pattern
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

            this.renderMarkers(); // Render markers
            this.addRightControls(); // Add filter control and other right controls (call after data load)

        } catch (error) {
            console.error("Failed to load air data:", error);
            this.displayErrorMessage("Failed to load air data. Please try again later.");
        }
    }

    /**
     * Renders or updates markers on the map.
     * @param {Array<Object>} [data=this.currentData] - Array of data to render.
     */
    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty. Clearing map layers.");
            this.allMarkers.clearLayers();
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers);
            }
            return;
        }

        this.allMarkers.clearLayers(); // Remove all existing markers

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker); // Add marker to cluster group
        });

        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers); // Add cluster group to map
        }

        // Redefine cluster click event (zoom in)
        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });
    }

    /**
     * Creates a single marker.
     * @param {Object} item - Data object to create the marker from.
     * @returns {L.Marker} The created Leaflet marker object.
     */
    createSingleMarker(item) {
        const level = this.getCongestionLevelByTXO(item.average_txo);
        const color = this.getColor(level);
        const radius = this.getRadiusByTXO(item.average_txo);

        // Create marker icon HTML (circular, color based on congestion)
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
            itemData: item // Store original data in marker options
        });

        const popupOptions = {
            closeButton: true,
            autoClose: true, // Re-enabled autoClose for hover popups
            closeOnClick: false, // Keep false for hover popups; map click handles closing.
            maxHeight: 300,
            maxWidth: 300,
            className: 'single-marker-popup' // Add class for individual marker popup
        };

        // Bind the individual marker's popup with its data
        marker.bindPopup(this.createPopupContent([item]), popupOptions);

        // Display popup on mouse hover and close on mouse out
        marker.on('mouseover', (e) => {
            // Close other popups first to ensure only one hover popup is open at a time
            this.map.closePopup();
            e.target.openPopup();
        });

        marker.on('mouseout', (e) => {
            // Only close if the mouse is truly out of the popup and marker area
            // Leaflet handles preventing closure if mouse moves into the popup itself
            if (e.target.getPopup().isOpen()) {
                e.target.closePopup();
            }
        });

        // Adjust z-index and prevent click/scroll propagation when popup opens
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Airport} just opened.`);
            e.popup.getElement().style.zIndex = 10000;
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
            this.lastOpenedMarker = e.target; // Save currently open marker
        });

        // Reset lastOpenedMarker when popup closes
        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Airport} just closed.`);
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null; // Remove closed popup's marker from lastOpenedMarker
            }
        });

        // Define behavior on marker click (remains for specific interaction/zoom)
        marker.on('click', (e) => {
            console.log(`Clicked/Tapped marker: ${item.Airport}. Current popup state: ${marker.getPopup().isOpen()}`);

            // Ensure hover popup is closed before click behavior
            this.map.closePopup();

            // zoomToShowLayer is useful when marker is hidden in a cluster
            if (this.allMarkers.hasLayer(marker)) { // If marker belongs to cluster group (can be clustered)
                this.allMarkers.zoomToShowLayer(marker, () => {
                    // Open popup after zoomToShowLayer completes
                    marker.openPopup(); // Use marker itself, not a separate 'foundMarker'
                    console.log(`Popup for ${item.Airport} opened after zoomToShowLayer.`);
                });
            } else {
                // If marker is not clustered, open popup directly
                marker.openPopup();
                console.log(`Popup for ${item.Airport} opened directly.`);
            }
        });

        return marker;
    }

    /**
     * Generates HTML content for marker popup (individual marker or after cluster spiderfying).
     * @param {Array<Object>} items - Array of data items to display in the popup.
     * @returns {string} HTML string for the popup content.
     */
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

            const level = this.getCongestionLevelByTXO(item.average_txo);
            const airportName = item.Airport || 'Unknown Airport';
            const municipality = item.municipality || 'Unknown City';
            const regionCode = item.iso_region ? item.iso_region.split('-').pop() : 'N/A';
            const avgTxo = (typeof item.average_txo === 'number' && !isNaN(item.average_txo)) ? item.average_txo.toFixed(2) : 'N/A';
            const scheduled = item.scheduled || 'N/A';
            const departed = item.departed || 'N/A';
            const completionFactor = item.completion_factor || 'N/A';


            content += `
                        <div class="location-info">
                            <h5>${municipality}, ${regionCode}</h5>
                            <p><strong>Airport:</strong> ${airportName}</p>
                            <p><strong>Congestion Level:</strong>
                                <span style="color: ${this.getColor(level, true)}">
                                    ${level}
                                </span>
                            </p>
                            <p><strong>Average Taxi-Out:</strong> ${avgTxo} min</p>
                            <p><strong>Scheduled Flights:</strong> ${scheduled}</p>
                            <p><strong>Departed Flights:</strong> ${departed}</p>
                            <p><strong>Completion Factor:</strong> ${completionFactor}%</p>
                        </div>
                        ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
                    `;
        });

        if (isMultiple) {
            content += '</div>';
        }

        return content || '<p>No valid data to display for this location.</p>';
    }

    /**
     * Adds the combined control group (zoom, reset, filter) to the top right of the map.
     */
    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            // Custom Zoom Controls (mimicking Leaflet's default look)
            // Removed 'leaflet-bar' class to ensure custom CSS applies fully
            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                        <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                        <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
                    `;
            div.appendChild(zoomControl);

            // Zoom button event handlers
            zoomControl.querySelector('.leaflet-control-zoom-in').addEventListener('click', (e) => {
                e.preventDefault();
                this.map.zoomIn();
            });

            zoomControl.querySelector('.leaflet-control-zoom-out').addEventListener('click', (e) => {
                e.preventDefault();
                this.map.zoomOut();
            });

            const validLocations = this.currentData
                .filter(item => item.municipality && item.municipality.trim() !== '' && item.iso_region && item.iso_region.trim() !== '')
                .map(item => {
                    const regionCode = item.iso_region.split('-').pop(); // 'US-CA' -> 'CA'
                    return `${item.municipality}, ${regionCode}`;
                });
        
            const locations = [...new Set(validLocations)].sort((a, b) => a.localeCompare(b));
        
            const filterDropdownHtml = `
                <select class="airport-filter">
                    <option value="" disabled selected hidden>Select Location</option>
                    <option value="All">All Locations</option>
                    ${locations.map(location =>
                        `<option value="${location}">${location}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', `
                        <button class="air-reset-btn reset-btn">Reset View</button>
                    `);
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            div.querySelector('.airport-filter').addEventListener('change', (e) => {
                const selectedLocation = e.target.value; // 로케이션 문자열을 가져옵니다.
                if (selectedLocation === "All") {
                    console.log("Filter: All Locations selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup();
                    this.locationToOpenAfterMove = null; // 초기화
                } else if (selectedLocation) {
                    console.log(`Filter selected: ${selectedLocation}`);
                    const [municipality, regionCode] = selectedLocation.split(', ').map(s => s.trim());
                    
                    // 선택된 로케이션에 해당하는 모든 데이터 항목을 찾습니다.
                    const dataForSelectedLocation = this.currentData.filter(item => 
                        item.municipality === municipality && item.iso_region.endsWith(`-${regionCode}`)
                    );

                    if (dataForSelectedLocation.length > 0) {
                        // 해당 로케이션의 첫 번째 마커를 찾으려고 시도합니다.
                        let foundMarker = null;
                        // 모든 마커 레이어를 순회하며 해당 로케이션의 마커를 찾습니다.
                        this.allMarkers.eachLayer(layer => {
                            const itemData = layer.options.itemData;
                            if (itemData && itemData.municipality === municipality && itemData.iso_region.endsWith(`-${regionCode}`)) {
                                foundMarker = layer;
                                return true; // Leaflet eachLayer의 break와 유사
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for location: ${selectedLocation}. Using zoomToShowLayer.`);
                            this.map.closePopup(); // 다른 팝업 먼저 닫기
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                // zoomToShowLayer 완료 후 팝업 열기
                                foundMarker.openPopup();
                                console.log(`Popup for ${foundMarker.options.itemData.Airport} at ${selectedLocation} opened after zoomToShowLayer.`);
                            });
                            this.locationToOpenAfterMove = null; // 성공적으로 처리했으므로 초기화
                        } else {
                            // 마커가 즉시 보이지 않을 경우 (예: 아직 클러스터링 해제되지 않음)
                            console.warn(`Marker object for location '${selectedLocation}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds(dataForSelectedLocation.map(item => [item.lat, item.lng]));
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            this.locationToOpenAfterMove = selectedLocation; // moveend 후 열도록 로케이션 문자열 저장
                        }
                    } else {
                        console.warn(`No data found for location '${selectedLocation}'.`);
                    }
                }
            });

            div.querySelector('.air-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup();
                this.locationToOpenAfterMove = null;
                const airportFilter = div.querySelector('.airport-filter');
                if (airportFilter) {
                    airportFilter.value = '';
                    airportFilter.selectedIndex = 0;
                }
            });

            // Prevent click/scroll propagation (allow independent interaction with controls)
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
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
     * Determines the marker radius based on the average Taxi-Out (TXO) value.
     * @param {number} txo - Average TXO value (in minutes).
     * @returns {number} Marker radius (in pixels).
     */
    getRadiusByTXO(txo) {
        if (txo == null || isNaN(txo)) return 6; // Default size for unknown/null
        if (txo >= 25) return 14;
        if (txo >= 20) return 12;
        if (txo >= 15) return 10;
        if (txo >= 10) return 8;
        return 6;
    }

    /**
     * Determines the congestion level string based on TXO value.
     * @param {number} txo - Average TXO value (in minutes).
     * @returns {string} Congestion level string.
     */
    getCongestionLevelByTXO(txo) {
        if (txo == null || isNaN(txo)) return 'Unknown';
        // Thresholds aligned with RailCongestionMap's logic
        if (txo >= 25) return 'Very High';
        if (txo >= 20) return 'High';
        if (txo >= 15) return 'Average';
        if (txo >= 10) return 'Low';
        return 'Very Low';
    }

    /**
     * Returns color based on congestion level for circles or text.
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
     * Displays a temporary error message on the map.
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

        // Automatically remove message after 5 seconds
        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

// Expose AirCongestionMap class to the global scope
window.AirCongestionMap = AirCongestionMap;
