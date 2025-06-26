/**
 * OceanCongestionMap manages ocean shipping congestion map using Leaflet and Leaflet.markercluster.
 */
class OceanCongestionMap {
    /**
     * Constructor for OceanCongestionMap.
     * @param {string} mapElementId - ID of the HTML element where the map will be rendered.
     */
    constructor(mapElementId) {
        // Leaflet map initialization: set default view and zoom level (US centric)
        // Disable default zoom control to allow manual addition in our desired position.
        this.map = L.map(mapElementId, { zoomControl: false }).setView([37.8, -96], 4);

        // Marker cluster group initialization
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 9,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2,
            showCoverageOnHover: false,
            showCoverageOnClick: false,

            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestDelayDays = -1; // Represents the "worst" congestion
                let dominantLevel = 'Average'; // Default to Average level for clusters
                let dominantColor = this.getColor(dominantLevel); // Default to Average color

                // Determine the highest congestion level (highest current_delay_days) within the cluster
                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData;
                    if (itemData && typeof itemData.current_delay_days === 'number' && !isNaN(itemData.current_delay_days)) {
                        if (itemData.current_delay_days > highestDelayDays) {
                            highestDelayDays = itemData.current_delay_days;
                            dominantLevel = this.getCongestionLevelByDelay(itemData.current_delay_days);
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
        this.markerToOpenAfterMove = null; // Port name for popup to open after map move
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
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.port} opened.`);
            }
        });

        // Popup close event handler
        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.port : 'unknown'} closed.`);
            if (this.lastOpenedMarker === e.popup._source) {
                this.lastOpenedMarker = null; // Remove closed popup's marker from lastOpenedMarker
            }
        });

        // Map click event handler adjustment
        this.map.on('click', (e) => {
            // If a marker popup is open or about to open, ignore map click
            if (this.lastOpenedMarker && this.lastOpenedMarker.getPopup().isOpen()) {
                console.log('Map click: A marker popup is already open. Ignoring.');
            }
            if (this.markerToOpenAfterMove) { // If waiting to open popup after move
                console.log('Map click: Waiting to open a marker popup. Ignoring.');
                return;
            }
            // Close existing popups on map background click
            console.log('Map background clicked. Closing any open popups.');
            this.map.closePopup();
            this.lastOpenedMarker = null;
        });

        // Map move end event handler
        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const portName = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null; // Reset
                this.pollForMarkerAndOpenPopup(portName);
            }
        });
    }

    /**
     * Finds the marker for a specific port name and opens its popup using polling
     * once the marker is ready (rendered on the map).
     * @param {string} portName - The name of the port whose popup should be opened.
     */
    pollForMarkerAndOpenPopup(portName) {
        let targetMarker = null;
        // Find the marker within the cluster group
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.port === portName) {
                targetMarker = layer;
                return; // Leaflet eachLayer's return acts as a break
            }
        });

        if (!targetMarker) {
            console.warn(`pollForMarkerAndOpenPopup: Marker for port '${portName}' not found in current layers (might be in a cluster).`);
            return;
        }

        // Check if a popup is already bound to the marker
        if (!targetMarker.getPopup()) {
            console.warn("pollForMarkerAndOpenPopup: Invalid marker or no popup associated.");
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
                console.log(`Poll success for ${targetMarker.options.itemData.port} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup(); // Attempt to open popup directly on marker

                // Verify if the popup actually opened (for stability with filtering)
                if (!targetMarker.getPopup().isOpen()) {
                    console.warn(`Popup for ${targetMarker.options.itemData.port} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup());
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${targetMarker.options.itemData.port} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${targetMarker.options.itemData.port} after max polling attempts.`);
            }
        };

        setTimeout(checkAndOpen, 50); // First attempt after a slight delay
    }

    /**
     * Loads ocean data asynchronously from `data/global-ports.json`.
     * Normalizes data, handles duplicate coordinates with jittering,
     * renders markers, and adds/updates controls.
     */
    async loadData() {
        try {
            const response = await fetch('data/global-ports.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            // Data cleansing and parsing
            let processedData = rawData.map(item => ({
                lat: item.lat || item.Latitude, // Use lat/lng or Latitude/Longitude
                lng: item.lng || item.Longitude,
                port: item.port || item.Port,
                country: item.country || item.Country,
                port_code: item.port_code,
                current_delay: parseFloat(item.current_delay), // Ensure numeric
                current_delay_days: parseFloat(item.current_delay_days), // Ensure numeric
                delay_level: item.delay_level, // This will be used or re-categorized
                weekly_median_delay: parseFloat(item.weekly_median_delay), // Ensure numeric
                monthly_max_delay: parseFloat(item.monthly_max_delay), // Ensure numeric
                date: item.date // last_updated equivalent
            })).filter(item =>
                // Basic validation: ensure lat, lng, and port exist
                typeof item.lat === 'number' && typeof item.lng === 'number' && item.port && item.port.trim() !== ''
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

                    const offsetScale = 0.15; // Jittering offset scale

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
            console.error("Failed to load ocean data:", error);
            this.displayErrorMessage("Failed to load ocean data. Please try again later.");
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
        const level = this.getCongestionLevelByDelay(item.current_delay_days);
        const color = this.getColor(level);
        const radius = this.getRadiusByDelay(item.current_delay_days);

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
            autoClose: true, // IMPORTANT: automatically close when another popup opens or map is clicked
            closeOnClick: true, // IMPORTANT: automatically close when map background is clicked
            maxHeight: 300,
            maxWidth: 300,
            className: 'single-marker-popup' // Add class for individual marker popup
        };

        // Bind the individual marker's popup with its data
        marker.bindPopup(this.createPopupContent([item]), popupOptions);

        // Display popup on mouse hover and close on mouse out
        marker.on('mouseover', (e) => {
            // Close other popups first
            this.map.closePopup();
            e.target.openPopup();
        });

        marker.on('mouseout', (e) => {
            // If popup is open and mouse moves out of marker area, close it
            // Leaflet handles preventing closure if mouse moves into the popup itself
            if (e.target.getPopup().isOpen()) {
                e.target.closePopup();
            }
        });

        // Adjust z-index and prevent click/scroll propagation when popup opens
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.port} just opened.`);
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
            console.log(`Popup for ${item.port} just closed.`);
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null; // Remove closed popup's marker from lastOpenedMarker
            }
        });

        // Define behavior on marker click
        marker.on('click', (e) => {
            console.log(`Clicked/Tapped marker: ${item.port}. Current popup state: ${marker.getPopup().isOpen()}`);

            this.map.closePopup(); // Close other popups first (always close existing before opening new)

            // zoomToShowLayer is useful when marker is hidden in a cluster
            if (this.allMarkers.hasLayer(marker)) { // If marker belongs to cluster group (can be clustered)
                this.allMarkers.zoomToShowLayer(marker, () => {
                    // Open popup after zoomToShowLayer completes
                    marker.openPopup();
                    console.log(`Popup for ${item.port} opened after zoomToShowLayer.`);
                });
            } else {
                // If marker is not clustered, open popup directly
                marker.openPopup();
                console.log(`Popup for ${item.port} opened directly.`);
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

            const level = this.getCongestionLevelByDelay(item.current_delay_days);
            const portName = item.port || 'Unknown Port';
            const country = item.country || 'Unknown Country';
            // Removed 'Current Delay' as requested by the user.
            const currentDelayDays = (typeof item.current_delay_days === 'number' && !isNaN(item.current_delay_days)) ? item.current_delay_days.toFixed(1) : 'N/A';
            const weeklyMedianDelay = (typeof item.weekly_median_delay === 'number' && !isNaN(item.weekly_median_delay)) ? item.weekly_median_delay.toFixed(1) : 'N/A';
            const monthlyMaxDelay = (typeof item.monthly_max_delay === 'number' && !isNaN(item.monthly_max_delay)) ? item.monthly_max_delay.toFixed(1) : 'N/A';
            const portCode = item.port_code || 'N/A';


            content += `
                        <div class="location-info">
                            <h5>${portName}</h5>
                            <p><strong>Country:</strong> ${country}</p>
                            <p><strong>Congestion Level:</strong>
                                <span style="color: ${this.getColor(level, true)}">
                                    ${level}
                                </span>
                            </p>
                            <p><strong>Current Delay Days:</strong> ${currentDelayDays} days</p>
                            <p><strong>Port Code:</strong> ${portCode}</p>
                            <p><strong>Weekly Median Delay:</strong> ${weeklyMedianDelay} days</p>
                            <p><strong>Monthly Max Delay:</strong> ${monthlyMaxDelay} days</p>
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
     * Adds the combined control group (zoom, reset, country/port filters) to the top right of the map.
     */
    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            // Custom Zoom Controls
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

            // Get unique sorted countries from currentData
            const allCountries = [...new Set(this.currentData
                .map(item => item.country)
                .filter(c => c && c.trim() !== '')
            )].sort((a, b) => a.localeCompare(b));

            const countryFilterHtml = `
                        <select class="country-filter">
                            <option value="" disabled selected hidden>Select Country</option>
                            <option value="All">All Countries</option>
                            ${allCountries.map(country =>
                                `<option value="${country}">${country}</option>`
                            ).join('')}
                        </select>
                    `;
            div.insertAdjacentHTML('beforeend', countryFilterHtml);

            const portFilterHtml = `
                        <select class="port-filter" disabled>
                            <option value="" disabled selected hidden>Select Port</option>
                        </select>
                    `;
            div.insertAdjacentHTML('beforeend', portFilterHtml);

            div.insertAdjacentHTML('beforeend', `
                        <button class="ocean-reset-btn reset-btn">Reset View</button>
                    `);

            const countryFilter = div.querySelector('.country-filter');
            const portFilter = div.querySelector('.port-filter');

            countryFilter.addEventListener('change', (e) => {
                const selectedCountry = e.target.value;
                portFilter.innerHTML = '<option value="" disabled selected hidden>Select Port</option>'; // Clear existing ports
                portFilter.disabled = true; // Disable until country is valid

                if (selectedCountry === "All") {
                    console.log("Filter: All Countries selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup();
                    this.markerToOpenAfterMove = null;
                    portFilter.innerHTML = '<option value="" disabled selected hidden>Select Port</option>';
                    portFilter.disabled = true;
                } else if (selectedCountry) {
                    console.log(`Filter selected: ${selectedCountry}`);
                    const portsInCountry = this.currentData.filter(item => item.country === selectedCountry);
                    
                    // Populate the port filter dropdown with ports from the selected country
                    const uniquePorts = [...new Set(portsInCountry.map(item => item.port))].sort((a, b) => a.localeCompare(b));
                    uniquePorts.forEach(port => {
                        const option = document.createElement('option');
                        option.value = port;
                        option.textContent = port;
                        portFilter.appendChild(option);
                    });
                    portFilter.disabled = false; // Enable port filter

                    const countryCenter = this.getCountryCenter(portsInCountry);
                    this.map.setView(countryCenter, 5); // Zoom to country level
                    this.map.closePopup(); // Close any open popups when filtering
                    this.markerToOpenAfterMove = null;
                }
            });

            portFilter.addEventListener('change', (e) => {
                const selectedPort = e.target.value;
                if (selectedPort) {
                    console.log(`Port selected: ${selectedPort}`);
                    const portData = this.currentData.find(item => item.port === selectedPort);
                    if (portData) {
                        let foundMarker = null;
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.port === selectedPort) {
                                foundMarker = layer;
                                return;
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for filter: ${selectedPort}. Using zoomToShowLayer.`);
                            this.map.closePopup();
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                foundMarker.openPopup();
                                console.log(`Popup for ${selectedPort} opened after zoomToShowLayer.`);
                            });
                            this.markerToOpenAfterMove = null;
                        } else {
                            console.warn(`Marker object for port '${selectedPort}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds([portData.lat, portData.lng]);
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            this.markerToOpenAfterMove = selectedPort;
                        }
                    } else {
                        console.warn(`No data found for port '${selectedPort}'.`);
                    }
                } else {
                    // If "Select Port" is chosen after a country, just keep country view
                    const country = countryFilter.value;
                    if (country && country !== "All") {
                        const countryPorts = this.currentData.filter(p => p.country === country);
                        const countryCenter = this.getCountryCenter(countryPorts);
                        this.map.setView(countryCenter, 5); // Use fixed zoom level 5 for consistency
                    } else {
                        this.map.setView([37.8, -96], 4); // If no country selected, reset to global view
                    }
                    this.map.closePopup();
                    this.markerToOpenAfterMove = null;
                }
            });

            div.querySelector('.ocean-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup();
                this.markerToOpenAfterMove = null;
                countryFilter.value = '';
                countryFilter.selectedIndex = 0; // Ensures "Select Country" is displayed
                portFilter.innerHTML = '<option value="" disabled selected hidden>Select Port</option>';
                portFilter.disabled = true;
            });

            // Prevent map events on the control
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };
        
        control.addTo(this.map);
    }
    
    /**
     * Calculates the central coordinates for a given set of ports.
     * @param {Array<Object>} ports - Array of port data objects.
     * @returns {Array<number>} - [latitude, longitude] of the center.
     */
    getCountryCenter(ports) {
        if (!ports || ports.length === 0) return [37.8, -96]; // Default if no ports

        const lats = ports.map(p => p.lat);
        const lngs = ports.map(p => p.lng);

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
     * Determines the marker radius based on current delay days.
     * @param {number} delayDays - Current delay in days.
     * @returns {number} Marker radius (in pixels).
     */
    getRadiusByDelay(delayDays) {
        if (delayDays == null || isNaN(delayDays)) return 6; // Default size for unknown/null
        if (delayDays >= 10) return 14;
        if (delayDays >= 5) return 12;
        if (delayDays >= 2) return 10;
        if (delayDays >= 0.5) return 8; // Half a day delay
        return 6;
    }

    /**
     * Determines the congestion level string based on delay days.
     * @param {number} delayDays - Current delay in days.
     * @returns {string} Congestion level string.
     */
    getCongestionLevelByDelay(delayDays) {
        if (delayDays == null || isNaN(delayDays)) return 'Unknown';
        // Changed based on user feedback:
        // 0 days: Very Low
        // 1-2 days: Low
        // 3-5 days: Average
        // 6-9 days: High
        // 10+ days: Very High
        if (delayDays >= 10) return 'Very High';
        if (delayDays >= 6) return 'High';
        if (delayDays >= 3) return 'Average';
        if (delayDays >= 1) return 'Low';
        if (delayDays === 0) return 'Very Low';
        return 'Unknown'; // Fallback for unexpected values
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

// Expose OceanCongestionMap class to the global scope
window.OceanCongestionMap = OceanCongestionMap;
