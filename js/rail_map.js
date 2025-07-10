class RailCongestionMap {
    constructor(mapElementId) {
        // Initialize the Leaflet map with a default view and disabled zoom control
        this.map = L.map(mapElementId, { zoomControl: false }).setView([37.8, -96], 4);

        // Initialize Leaflet MarkerClusterGroup for handling clustered markers
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40, // Maximum radius in pixels where markers are clustered together
            disableClusteringAtZoom: 9, // Zoom level at which clustering is disabled
            spiderfyOnMaxZoom: true, // Whether to spiderfy on max zoom level
            spiderfyDistanceMultiplier: 2, // Multiplier for spiderfy distance
            showCoverageOnHover: false, // Don't show cluster coverage on hover
            showCoverageOnClick: false, // Don't show cluster coverage on click

            // Custom icon creation function for clusters
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average'); // Default color for clusters

                // Helper to convert congestion level string to a numeric value for comparison
                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Average': return 2;
                        case 'Low': return 1;
                        case 'Very Low': return 0;
                        default: return -1; // Unknown or invalid
                    }
                };
                
                // Determine the dominant (highest) congestion level within the cluster
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
                // Adjust cluster icon size based on the number of markers in the cluster
                const size = 30 + Math.min(childCount * 0.5, 30);

                // Return a custom DivIcon for the cluster marker
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom',
                    iconSize: new L.Point(size, size)
                });
            }
        });

        // Initialize class properties
        this.currentData = null; // Stores the loaded rail data
        this.filterControlInstance = null; // Reference to the custom filter control
        this.errorControl = null; // Reference to the error message control
        this.markerToOpenAfterMove = null; // Stores yard name to open popup after map move
        this.lastOpenedMarker = null; // Stores reference to the last opened marker popup

        // Add base tile layer to the map
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        // Set maximum bounds for the map to prevent panning too far
        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        // Load data when the map is initialized
        this.loadData();

        // Event listener for when a popup opens
        this.map.on('popupopen', (e) => {
            if (e.popup && e.popup._source && e.popup._source instanceof L.Marker) {
                this.lastOpenedMarker = e.popup._source;
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.location} opened.`); 
            }
        });

        // Event listener for when a popup closes
        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.location : 'unknown'} closed.`);
            // Clear lastOpenedMarker if the closed popup was the one we tracked
            if (this.lastOpenedMarker === e.popup._source) {
                this.lastOpenedMarker = null;
            }
        });

        // Event listener for map clicks (to close popups if background is clicked)
        this.map.on('click', (e) => {
            // If a marker popup is already open, ignore map background clicks
            if (this.lastOpenedMarker && this.lastOpenedMarker.getPopup().isOpen()) {
                console.log('Map click: A marker popup is already open. Ignoring.');
                return;
            }
            // If there's a marker queued to open after move, ignore clicks
            if (this.markerToOpenAfterMove) {
                console.log('Map click: Waiting to open a marker popup. Ignoring.');
                return;
            }
            console.log('Map background clicked. Closing any open popups.');
            this.map.closePopup(); // Close any open popups
            this.lastOpenedMarker = null; // Clear the last opened marker reference
        });

        // Event listener for when map movement ends (used for opening queued popups)
        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const yardName = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null; // Clear the queue
                this.pollForMarkerAndOpenPopup(yardName); // Attempt to open the popup
            }
        });
    }

    // Function to poll for a marker and open its popup after map movement
    pollForMarkerAndOpenPopup(yardName) {
        let targetMarker = null;
        // Iterate through all markers in the cluster group to find the target marker
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.location === yardName) {
                targetMarker = layer;
                return; // Found the marker, exit loop
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

        this.map.closePopup(); // Close any existing popups before opening a new one

        let attempts = 0;
        const maxAttempts = 30; // Max polling attempts
        const retryInterval = 100; // Interval between attempts (ms)

        // Recursive function to check if marker is ready and open popup
        const checkAndOpen = () => {
            // Check if the marker's icon is rendered and it's on the map
            if (targetMarker._icon && targetMarker._map) {
                console.log(`Poll success for ${targetMarker.options.itemData.location} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup(); // Open the popup directly

                // Double-check if the popup is actually open, sometimes it needs a slight delay or map.openPopup
                if (!targetMarker.getPopup().isOpen()) {
                    console.warn(`Popup for ${targetMarker.options.itemData.location} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup()); // Fallback to map's openPopup
                }
            } else if (attempts < maxAttempts) {
                // Marker not ready, retry after interval
                console.log(`Polling for ${targetMarker.options.itemData.location} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                // Max attempts reached, log error
                console.error(`Failed to open popup for ${targetMarker.options.itemData.location} after max polling attempts.`);
            }
        };

        setTimeout(checkAndOpen, 50); // Start polling after a small initial delay
    }

    // Asynchronously loads rail data from the JSON file
    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            // Process raw data: map to consistent keys and filter out invalid entries
            let processedData = rawData.map(item => ({
                lat: item.lat,
                lng: item.lng,
                location: item.location, // Use 'location' for consistency
                company: item.company,
                dwell_time: item.dwell_time,
                indicator: item.indicator,
                congestion_level: item.congestion_level,
                // Ensure average_value is a number or null
                average_value: parseFloat(item.average_value) || null, 
                date: item.date
            })).filter(item =>
                // Filter out items with missing essential data
                item.lat !== undefined && item.lng !== undefined && item.location && item.congestion_level
            );

            // Use a Map to group items by exact coordinates for jittering
            const coordinateMap = new Map();
            processedData.forEach(item => {
                const coordKey = `${item.lat},${item.lng}`;
                if (!coordinateMap.has(coordKey)) {
                    coordinateMap.set(coordKey, []);
                }
                coordinateMap.get(coordKey).push(item);
            });

            const jitteredData = [];
            // Apply jittering to markers that share the exact same coordinates
            coordinateMap.forEach(itemsAtCoord => {
                if (itemsAtCoord.length > 1) {
                    const baseLat = itemsAtCoord[0].lat;
                    const baseLng = itemsAtCoord[0].lng;

                    // Small offset scale to slightly separate overlapping markers
                    const offsetScale = 0.005; 

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

            this.currentData = jitteredData; // Store the processed and jittered data

            this.renderMarkers(); // Render markers on the map
            this.addRightControls(); // Add custom controls (zoom, filter, reset)
            this.addLegend(); // Add the congestion level legend
        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }

    // Renders markers on the map based on the provided data
    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty. Clearing map layers.");
            this.allMarkers.clearLayers(); // Clear existing markers
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers); // Remove the cluster group from map if present
            }
            return;
        }

        this.allMarkers.clearLayers(); // Clear existing markers before re-rendering

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker); // Add marker to the cluster group
        });

        // Add the cluster group to the map if it's not already there
        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers);
        }

        // Re-bind cluster click event listener
        this.allMarkers.off('clusterclick'); // Remove previous listener to prevent duplicates
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds(); // Zoom to the bounds of the clicked cluster
        });
    }

    // Creates a single Leaflet marker with custom icon and popup
    createSingleMarker(item) {
        const level = item.congestion_level || 'Average'; // Default to 'Average' if level is missing
        const color = this.getColor(level); // Get color based on congestion level
        // Get radius based on indicator (if available) or dwell time
        const radius = this.getRadiusByIndicator(item.indicator, item.dwell_time); 

        // HTML for the custom circular marker icon
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

        // Create a custom DivIcon
        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [radius * 2, radius * 2], // Icon size
            iconAnchor: [radius, radius] // Anchor point for the icon
        });

        // Create the marker with the custom icon and attach item data
        const marker = L.marker([item.lat, item.lng], {
            icon: customIcon,
            itemData: item // Store the full item data with the marker
        });

        // Popup options
        const popupOptions = {
            closeButton: true,
            autoClose: true,
            closeOnClick: true,
            maxHeight: 300,
            maxWidth: 300,
            className: 'single-marker-popup'
        };

        // Bind the popup content to the marker
        marker.bindPopup(this.createPopupContent([item]), popupOptions);

        // Event listener for mouseover: opens popup if no other popup is currently open
        marker.on('mouseover', (e) => {
            if (!this.lastOpenedMarker) { // Only open if no other popup is explicitly open
                 this.map.closePopup(); // Ensure any accidental popups are closed
                 e.target.openPopup();
            }
        });

        // Event listener for mouseout: closes popup if it's not the last clicked/opened one
        marker.on('mouseout', (e) => {
            if (e.target.getPopup().isOpen() && this.lastOpenedMarker !== e.target) {
                e.target.closePopup();
            }
        });

        // Event listener for when a marker's popup opens
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.location} just opened.`);
            e.popup.getElement().style.zIndex = 10000; // Ensure popup is on top
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                // Prevent map interaction (click, scroll) within the popup
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
            this.lastOpenedMarker = e.target; // Track this as the last opened marker
        });

        // Event listener for when a marker's popup closes
        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.location} just closed.`);
            // Clear lastOpenedMarker if the closed popup was the one we tracked
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null;
            }
        });

        // Event listener for marker click/tap
        marker.on('click', (e) => {
            console.log(`Clicked/Tapped marker: ${item.location}. Current popup state: ${marker.getPopup().isOpen()}`);

            this.map.closePopup(); // Close any currently open popup

            // If the marker is part of a cluster, zoom to it and then open popup
            if (this.allMarkers.hasLayer(marker)) {
                this.allMarkers.zoomToShowLayer(marker, () => {
                    marker.openPopup();
                    console.log(`Popup for ${item.location} opened after zoomToShowLayer.`);
                });
            } else {
                // If not clustered, open popup directly
                marker.openPopup();
                console.log(`Popup for ${item.location} opened directly.`);
            }
        });

        return marker;
    }

    // Creates the HTML content for a marker's popup
    createPopupContent(items) {
        const safeItems = Array.isArray(items) ? items : [items];
        let content = '';

        if (safeItems.length === 0) {
            return '<p>No valid data to display for this location.</p>';
        }

        const isMultiple = safeItems.length > 1;

        // Header for cluster popups
        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                                <h4>${safeItems.length} Locations</h4>
                                <p>Showing individual details:</p>
                               </div>
                               <div class="cluster-popup-content">`;
        }

        // Iterate through items to create detailed content for each
        safeItems.forEach(item => {
            // Basic validation for item data
            if (!item || typeof item !== 'object' || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item in popup content:", item);
                return;
            }

            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            // Format dwell time and average value, or show 'N/A'
            const dwellTime = (typeof item.dwell_time === 'number' && !isNaN(item.dwell_time)) ? item.dwell_time.toFixed(1) : 'N/A';
            const averageValue = (typeof item.average_value === 'number' && !isNaN(item.average_value)) ? item.average_value.toFixed(1) : 'N/A';

            // Append HTML for each location's info
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
                    ${item.average_value !== null ? `<p><strong>Average:</strong> ${averageValue} hours</p>` : ''}
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });

        // Close div for cluster content
        if (isMultiple) {
            content += '</div>';
        }

        return content || '<p>No valid data to display for this location.</p>';
    }

    // Adds custom controls (zoom, reset, yard filter) to the top right of the map
    addRightControls() {
        // Remove existing control instance if it exists
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }
        
        const control = L.control({ position: 'topright' });
        
        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');
            
            // Custom zoom controls
            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);
            
            // Event listeners for custom zoom buttons
            zoomControl.querySelector('.leaflet-control-zoom-in').addEventListener('click', (e) => {
                e.preventDefault();
                this.map.zoomIn();
            });
            
            zoomControl.querySelector('.leaflet-control-zoom-out').addEventListener('click', (e) => {
                e.preventDefault();
                this.map.zoomOut();
            });

            // Get unique yard locations from current data for the filter dropdown
            const validYards = this.currentData
                .filter(item => item.location && item.location.trim() !== '')
                .map(item => item.location);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            // HTML for the yard filter dropdown
            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            // Add reset button and filter dropdown to the control div
            div.insertAdjacentHTML('beforeend', `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `);
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);


            // Event listener for yard filter dropdown change
            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (yardName === "All") {
                    console.log("Filter: All Yards selected. Resetting view.");
                    this.map.setView([37.8, -96], 4); // Reset to initial view
                    this.map.closePopup(); // Close any open popups
                    this.markerToOpenAfterMove = null; // Clear queued marker
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    // Filter data to find the selected yard
                    const yardDataForFilter = this.currentData.filter(item => item.location === yardName);
                    if (yardDataForFilter.length > 0) {
                        let foundMarker = null;
                        // Find the actual marker object in the cluster group
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.location === yardName) {
                                foundMarker = layer;
                                return;
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for filter: ${yardName}. Using zoomToShowLayer.`);
                            this.map.closePopup();
                            // Zoom to the marker and open its popup
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                foundMarker.openPopup();
                                console.log(`Popup for ${yardName} opened after zoomToShowLayer.`);
                            });
                            this.markerToOpenAfterMove = null; // Clear queue
                        } else {
                            // Fallback if marker not immediately found (e.g., still clustered)
                            console.warn(`Marker object for yard '${yardName}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            this.markerToOpenAfterMove = yardName; // Queue marker to open after map move
                        }
                    } else {
                        console.warn(`No data found for yard '${yardName}'.`);
                    }
                }
            });

            // Event listener for the reset button
            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4); // Reset map view
                this.map.closePopup(); // Close any open popups
                this.markerToOpenAfterMove = null; // Clear queued marker
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) {
                    yardFilter.value = ''; // Reset dropdown to default
                    yardFilter.selectedIndex = 0;
                }
            });

            // Prevent map interaction when interacting with controls
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control; // Store reference to the control
            return div;
        };

        control.addTo(this.map); // Add the control to the map
    }

    // Adds a legend to the bottom right of the map showing congestion level colors
    addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            const levels = ['Very High', 'High', 'Average', 'Low', 'Very Low'];
            const labels = [];

            // Generate legend items with color squares and labels
            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                const color = this.getColor(level); // Get color for the level

                labels.push(
                    `<i style="background:${color}"></i> ${level}`
                );
            }

            div.innerHTML = '<h4>Congestion Level</h4>' + labels.join('<br>');
            return div;
        }.bind(this); // Bind 'this' to access getColor method within the legend context

        legend.addTo(this.map);
    }

    // Calculates the center of a group of yard data points (not currently used for map centering)
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

    // Determines marker radius (size) based on 'indicator' or 'dwell_time'
    // Prioritizes 'indicator' if valid, otherwise uses 'dwell_time'
    getRadiusByIndicator(indicator, dwell_time) {
        if (typeof indicator === 'number' && !isNaN(indicator)) {
            // Logic based on 'indicator' (from CONGESTION_RAIL)
            if (indicator > 2) return 20;
            if (indicator > 1) return 16;
            if (indicator > -1) return 12;
            if (indicator > -2) return 8;
            return 5;
        } else if (typeof dwell_time === 'number' && !isNaN(dwell_time)) {
            // Logic based on 'dwell_time' (for CONGESTION_RAIL2 or if indicator is missing)
            if (dwell_time > 28) return 20; // Very High
            if (dwell_time > 23) return 16; // High
            if (dwell_time > 18) return 12; // Average
            if (dwell_time > 10) return 8;  // Low
            return 5; // Very Low or other
        }
        return 5; // Default small radius if no valid indicator or dwell time
    }

    // Returns color code based on congestion level
    // 'isText' parameter determines if it's for circle background or text color
    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#E53935', // Red
            'High': '#FFB300',    // Orange
            'Average': '#9E9E9E', // Grey
            'Low': '#90CAF9',     // Light Blue
            'Very Low': '#42A5F5',// Blue
            'Unknown': '#bcbcbc'  // Light Grey for unknown levels
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

    // Displays a temporary error message on the map
    displayErrorMessage(message) {
        // Remove existing error control if present
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

        // Automatically remove the error message after 5 seconds
        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

// Expose the class globally so it can be instantiated in HTML
window.RailCongestionMap = RailCong congestionMap;
