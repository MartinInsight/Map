class AirCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId, {
      zoomControl: false
    }).setView([37.8, -96], 4);

    this.allMarkers = L.markerClusterGroup({
      maxClusterRadius: 40,
      disableClusteringAtZoom: 9,
      spiderfyOnMaxZoom: true,
      spiderfyDistanceMultiplier: 2,
      showCoverageOnHover: false,
      showCoverageOnClick: false,

      iconCreateFunction: (cluster) => {
        const childMarkers = cluster.getAllChildMarkers();
        let highestTXOValue = -1;
        let dominantLevel = 'Average';
        let dominantColor = this.getColor(dominantLevel);

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
    this.locationToOpenAfterMove = null;
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
        console.log(`Popup for ${this.lastOpenedMarker.options.itemData.Airport} opened.`);
      }
    });

    this.map.on('popupclose', (e) => {
      console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.Airport : 'unknown'} closed.`);
      if (this.lastOpenedMarker === e.popup._source) {
        this.lastOpenedMarker = null;
      }
    });

    this.map.on('click', (e) => {
      console.log('Map background clicked. Closing any open popups.');
      this.map.closePopup();
      this.lastOpenedMarker = null;
    });

    this.map.on('moveend', () => {
      if (this.locationToOpenAfterMove) {
        console.log('Map animation ended, attempting to open queued popup with polling for location.');
        const selectedLocation = this.locationToOpenAfterMove;
        this.locationToOpenAfterMove = null;
        this.pollForLocationMarkerAndOpenPopup(selectedLocation);
      }
    });
  }

  pollForLocationMarkerAndOpenPopup(locationString) {
    let targetMarker = null;
    const [municipality, regionCode] = locationString.split(', ').map(s => s.trim());

    this.allMarkers.eachLayer(layer => {
      const itemData = layer.options.itemData;
      if (itemData && itemData.municipality === municipality && itemData.iso_region.endsWith(`-${regionCode}`)) {
        targetMarker = layer;
        return true;
      }
    });

    if (!targetMarker) {
      console.warn(`pollForLocationMarkerAndOpenPopup: Marker for location '${locationString}' not found in current layers (might be in a cluster).`);
      return;
    }

    if (!targetMarker.getPopup()) {
      console.warn("pollForLocationMarkerAndOpenPopup: Invalid marker or no popup associated.");
      return;
    }

    this.map.closePopup();

    let attempts = 0;
    const maxAttempts = 30;
    const retryInterval = 100;

    const checkAndOpen = () => {
      if (targetMarker._icon && targetMarker._map) {
        console.log(`Poll success for ${targetMarker.options.itemData.Airport} at ${locationString} (Attempt ${attempts + 1}). Opening popup.`);
        targetMarker.openPopup();

        if (!targetMarker.getPopup().isOpen()) {
          console.warn(`Popup for ${targetMarker.options.itemData.Airport} did not confirm open after direct call. Final retry via map.`);
          this.map.openPopup(targetMarker.getPopup());
        }
      } else if (attempts < maxAttempts) {
        console.log(`Polling for ${locationString} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
        attempts++;
        setTimeout(checkAndOpen, retryInterval);
      } else {
        console.error(`Failed to open popup for ${locationString} after max polling attempts.`);
      }
    };

    this.allMarkers.zoomToShowLayer(targetMarker, () => {
      setTimeout(checkAndOpen, 50);
    });
  }


  async loadData() {
    try {
      const response = await fetch('data/us-air.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const rawData = await response.json();

      let processedData = rawData.map(item => ({
        lat: item.latitude_deg,
        lng: item.longitude_deg,
        Airport: item.airport_code,
        name: item.name,
        municipality: item.municipality,
        iso_region: item.iso_region,
        average_txo: parseFloat(item.average_txo),
        scheduled: item.scheduled,
        departed: item.departed,
        completion_factor: item.completion_factor,
        last_updated: item.last_updated
      })).filter(item =>
        typeof item.lat === 'number' && typeof item.lng === 'number' && item.Airport && item.Airport.trim() !== ''
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
      console.error("Failed to load air data:", error);
      this.displayErrorMessage("Failed to load air data. Please try again later.");
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
    const level = this.getCongestionLevelByTXO(item.average_txo);
    const color = this.getColor(level);
    const radius = this.getRadiusByTXO(item.average_txo);

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
      closeOnClick: false,
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
      console.log(`Popup for ${item.Airport} just opened.`);
      e.popup.getElement().style.zIndex = 10000;
      const popupDiv = e.popup.getElement();
      if (popupDiv) {
        L.DomEvent.disableClickPropagation(popupDiv);
        L.DomEvent.disableScrollPropagation(popupDiv);
      }
      this.lastOpenedMarker = e.target;
    });

    marker.on('popupclose', (e) => {
      console.log(`Popup for ${item.Airport} just closed.`);
      if (this.lastOpenedMarker === e.target) {
        this.lastOpenedMarker = null;
      }
    });

    marker.on('click', (e) => {
      console.log(`Clicked/Tapped marker: ${item.Airport}. Current popup state: ${marker.getPopup().isOpen()}`);

      this.map.closePopup();

      if (this.allMarkers.hasLayer(marker)) {
        this.allMarkers.zoomToShowLayer(marker, () => {
          marker.openPopup();
          console.log(`Popup for ${item.Airport} opened after zoomToShowLayer.`);
        });
      } else {
        marker.openPopup();
        console.log(`Popup for ${item.Airport} opened directly.`);
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

  addRightControls() {
    if (this.filterControlInstance) {
      this.map.removeControl(this.filterControlInstance);
    }

    const control = L.control({
      position: 'topright'
    });

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

      const validLocations = this.currentData
        .filter(item => item.municipality && item.municipality.trim() !== '' && item.iso_region && item.iso_region.trim() !== '')
        .map(item => {
          const regionCode = item.iso_region.split('-').pop();
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
        const selectedLocation = e.target.value;
        if (selectedLocation === "All") {
          console.log("Filter: All Locations selected. Resetting view.");
          this.map.setView([37.8, -96], 4);
          this.map.closePopup();
          this.locationToOpenAfterMove = null;
        } else if (selectedLocation) {
          console.log(`Filter selected: ${selectedLocation}`);
          const [municipality, regionCode] = selectedLocation.split(', ').map(s => s.trim());

          const dataForSelectedLocation = this.currentData.filter(item =>
            item.municipality === municipality && item.iso_region.endsWith(`-${regionCode}`)
          );

          if (dataForSelectedLocation.length > 0) {
            let foundMarker = null;
            this.allMarkers.eachLayer(layer => {
              const itemData = layer.options.itemData;
              if (itemData && itemData.municipality === municipality && itemData.iso_region.endsWith(`-${regionCode}`)) {
                foundMarker = layer;
                return true;
              }
            });

            if (foundMarker) {
              console.log(`Found marker for location: ${selectedLocation}. Using zoomToShowLayer.`);
              this.map.closePopup();
              this.allMarkers.zoomToShowLayer(foundMarker, () => {
                foundMarker.openPopup();
                console.log(`Popup for ${foundMarker.options.itemData.Airport} at ${selectedLocation} opened after zoomToShowLayer.`);
              });
              this.locationToOpenAfterMove = null;
            } else {
              console.warn(`Marker object for location '${selectedLocation}' not immediately found. Falling back to fitBounds and polling.`);
              const bounds = L.latLngBounds(dataForSelectedLocation.map(item => [item.lat, item.lng]));
              this.map.fitBounds(bounds.pad(0.5), {
                maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1
              });
              this.locationToOpenAfterMove = selectedLocation;
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

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      this.filterControlInstance = control;
      return div;
    };

    control.addTo(this.map);
  }

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

  getRadiusByTXO(txo) {
    if (txo == null || isNaN(txo)) return 6;
    if (txo >= 25) return 14;
    if (txo >= 20) return 12;
    if (txo >= 15) return 10;
    if (txo >= 10) return 8;
    return 6;
  }

  getCongestionLevelByTXO(txo) {
    if (txo == null || isNaN(txo)) return 'Unknown';
    if (txo >= 25) return 'Very High';
    if (txo >= 20) return 'High';
    if (txo >= 15) return 'Average';
    if (txo >= 10) return 'Low';
    return 'Very Low';
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
      'Unknown': '#5e5e5e'
    };

    return isText ? textColors[level] : circleColors[level];
  }

  displayErrorMessage(message) {
    if (this.errorControl) {
      this.map.removeControl(this.errorControl);
    }

    const errorControl = L.control({
      position: 'topleft'
    });
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

window.AirCongestionMap = AirCongestionMap;
