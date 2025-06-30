class OceanCongestionMap {
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
                let highestDelayDays = -1;
                let dominantLevel = 'Average';
                let dominantColor = this.getColor(dominantLevel);

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
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.port} opened.`);
            }
        });

        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.port : 'unknown'} closed.`);
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
                const portName = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null;
                this.pollForMarkerAndOpenPopup(portName);
            }
        });
    }

    pollForMarkerAndOpenPopup(portName) {
        let targetMarker = null;
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.port === portName) {
                targetMarker = layer;
                return;
            }
        });

        if (!targetMarker) {
            console.warn(`pollForMarkerAndOpenPopup: Marker for port '${portName}' not found in current layers (might be in a cluster).`);
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
                console.log(`Poll success for ${targetMarker.options.itemData.port} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup();

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

        setTimeout(checkAndOpen, 50);
    }

    async loadData() {
        try {
            const response = await fetch('data/global-ports.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            let processedData = rawData.map(item => ({
                lat: item.lat || item.Latitude,
                lng: item.lng || item.Longitude,
                port: item.port || item.Port,
                country: item.country || item.Country,
                port_code: item.port_code,
                current_delay: parseFloat(item.current_delay),
                current_delay_days: parseFloat(item.current_delay_days),
                delay_level: item.delay_level,
                weekly_median_delay: parseFloat(item.weekly_median_delay),
                monthly_max_delay: parseFloat(item.monthly_max_delay),
                date: item.date
            })).filter(item =>
                typeof item.lat === 'number' && typeof item.lng === 'number' && item.port && item.port.trim() !== ''
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

                    const offsetScale = 0.3;

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
            console.error("Failed to load ocean data:", error);
            this.displayErrorMessage("Failed to load ocean data. Please try again later.");
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
        const level = this.getCongestionLevelByDelay(item.current_delay_days);
        const color = this.getColor(level);
        const radius = this.getRadiusByDelay(item.current_delay_days);

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
            console.log(`Popup for ${item.port} just opened.`);
            e.popup.getElement().style.zIndex = 10000;
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
            this.lastOpenedMarker = e.target;
        });

        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.port} just closed.`);
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null;
            }
        });

        marker.on('click', (e) => {
            console.log(`Clicked/Tapped marker: ${item.port}. Current popup state: ${marker.getPopup().isOpen()}`);

            this.map.closePopup();

            if (this.allMarkers.hasLayer(marker)) {
                this.allMarkers.zoomToShowLayer(marker, () => {
                    marker.openPopup();
                    console.log(`Popup for ${item.port} opened after zoomToShowLayer.`);
                });
            } else {
                marker.openPopup();
                console.log(`Popup for ${item.port} opened directly.`);
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

            const level = this.getCongestionLevelByDelay(item.current_delay_days);
            const portName = item.port || 'Unknown Port';
            const country = item.country || 'Unknown Country';
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

            div.insertAdjacentHTML('beforeend', `
                <button class="ocean-reset-btn reset-btn">Reset View</button>
            `);

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

            const countryFilter = div.querySelector('.country-filter');
            const portFilter = div.querySelector('.port-filter');

            countryFilter.addEventListener('change', (e) => {
                const selectedCountry = e.target.value;
                portFilter.innerHTML = '<option value="" disabled selected hidden>Select Port</option>';
                portFilter.disabled = true;

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
                    
                    const uniquePorts = [...new Set(portsInCountry.map(item => item.port))].sort((a, b) => a.localeCompare(b));
                    uniquePorts.forEach(port => {
                        const option = document.createElement('option');
                        option.value = port;
                        option.textContent = port;
                        portFilter.appendChild(option);
                    });
                    portFilter.disabled = false;

                    const countryCenter = this.getCountryCenter(portsInCountry);
                    this.map.setView(countryCenter, 5);
                    this.map.closePopup();
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
                    const country = countryFilter.value;
                    if (country && country !== "All") {
                        const countryPorts = this.currentData.filter(p => p.country === country);
                        const countryCenter = this.getCountryCenter(countryPorts);
                        this.map.setView(countryCenter, 5);
                    } else {
                        this.map.setView([37.8, -96], 4);
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
                countryFilter.selectedIndex = 0;
                portFilter.innerHTML = '<option value="" disabled selected hidden>Select Port</option>';
                portFilter.disabled = true;
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };
        
        control.addTo(this.map);
    }
    
    getCountryCenter(ports) {
        if (!ports || ports.length === 0) return [37.8, -96];

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

    getRadiusByDelay(delayDays) {
        if (delayDays == null || isNaN(delayDays)) return 6;
        if (delayDays >= 10) return 14;
        if (delayDays >= 5) return 12;
        if (delayDays >= 2) return 10;
        if (delayDays >= 0.5) return 8;
        return 6;
    }

    getCongestionLevelByDelay(delayDays) {
        if (delayDays == null || isNaN(delayDays)) return 'Unknown';
        if (delayDays >= 10) return 'Very High';
        if (delayDays >= 6) return 'High';
        if (delayDays >= 3) return 'Average';
        if (delayDays >= 1) return 'Low';
        if (delayDays === 0) return 'Very Low';
        return 'Unknown';
    }

    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#E53935',
            'High': '#FFB300',
            'Average': '#9E9E9E',
            'Low': '#90CAF9',
            'Very Low': '#42A5F5',
            'Unknown': '#cccccc'
        };

        const textColors = {
            'Very High': '#b71c1c',
            'High': '#e65100',
            'Average': '#616161',
            'Low': '#2196F3',
            'Very Low': '#1976D2',
        };

        return isText ? (textColors[level] || textColors['Unknown']) : (circleColors[level] || circleColors['Unknown']);
    }

    displayErrorMessage(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const ErrorControl = L.Control.extend({
            onAdd: function(map) {
                const div = L.DomUtil.create('div', 'map-error-message');
                div.innerHTML = `<strong>Error:</strong> ${message}`;
                return div;
            },
            onRemove: function(map) {}
        });

        this.errorControl = new ErrorControl({ position: 'topleft' }).addTo(this.map);
    }
}
