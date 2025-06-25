class OceanCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.markers = [];
    this.currentData = [];
    this.lastUpdated = null;
    this.filterControlInstance = null; // Ensure this is initialized
    this.lastUpdatedControl = null; // Initialize for consistency
    this.errorControl = null; // Initialize for consistency

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
      minZoom: 2
    }).addTo(this.map);

    this.map.setMaxBounds([
      [-85, -180],
      [85, 180]
    ]);
    
    this.map.on('zoomend', () => {
      const currentZoom = this.map.getZoom();
      // This zoom logic is for preventing excessive zoom out, not direct filter behavior
      if (currentZoom < this.map.getMinZoom()) {
        this.map.setZoom(this.map.getMinZoom());
      }
    });
    
    this.loadData();
    this.addControls();
  }

  async loadData() {
    try {
      const response = await fetch('data/global-ports.json');
      if (!response.ok) { // Check for HTTP errors
          throw new Error(`HTTP error! status: ${response.status}`);
      }
      const rawData = await response.json();
  
      this.currentData = rawData.map(p => ({
        lat: p.lat || p.Latitude,
        lng: p.lng || p.Longitude,
        port: p.port || p.Port,
        country: p.country || p.Country,
        port_code: p.port_code,
        current_delay: p.current_delay,
        current_delay_days: p.current_delay_days,
        delay_level: p.delay_level,
        weekly_median_delay: p.weekly_median_delay,
        monthly_max_delay: p.monthly_max_delay,
        date: p.date
      }));
  
      if (this.currentData.length > 0) {
        this.lastUpdated = this.currentData[0].date;
      }
  
      this.renderMarkers();
      this.addLastUpdatedText();
  
      this.addFilterControl();
  
    } catch (error) {
      console.error("Failed to load ocean data:", error);
      // Display error message on the map for the user
      this.displayErrorMessage("Failed to load ocean data. Please try again later.");
    }
  }

  renderMarkers(data = this.currentData) {
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    data.forEach(port => {
      const marker = L.circleMarker([port.lat, port.lng], {
        radius: this.getRadiusByDelay(port.current_delay_days),
        fillColor: this.getColor(port.delay_level),
        color: "#000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });

      marker.on({
        mouseover: (e) => {
          // Mouseover will show popup
          this.map.closePopup(); // Close any existing popups
          const popup = L.popup({
              // Default popup settings for mouseover (closes on mouseout)
              closeButton: false,
              autoClose: true,
              closeOnClick: true // Allow closing on map click
          })
            .setLatLng(e.latlng)
            .setContent(this.createPopupContent(port))
            .openOn(this.map);
        },
        mouseout: () => {
          // Mouseout will close popup (if autoClose is true)
          this.map.closePopup();
        },
        click: (e) => {
          // On click: zoom to marker and show popup (for mobile compatibility)
          this.map.closePopup(); // Close any other open popups (including mouseover one)
          this.map.setView(e.latlng, 8); // Zoom to clicked marker's location with fixed zoom level 8
          
          L.popup({
              // Settings for click popup (sticky for mobile)
              closeButton: true, // Allow manual closing for click popup
              autoClose: false, // Keep open until manually closed or another action
              closeOnClick: false // Do not close on map click
          })
            .setLatLng(e.latlng) // Use the clicked latlng for the popup position
            .setContent(this.createPopupContent(port))
            .openOn(this.map);
        }
      });

      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  addLastUpdatedText() {
    // If there's an existing control, remove it to prevent duplicates
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
      this.lastUpdatedControl = infoControl; // Store instance to manage it
    }
  }

  addControls() {
    const controlContainer = L.control({ position: 'topright' });
    
    controlContainer.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-control-container');
      div.innerHTML = `
        <button class="ocean-reset-btn reset-btn">Reset View</button>
      `;
  
      div.querySelector('.ocean-reset-btn').addEventListener('click', () => {
        this.map.setView([37.8, -96], 4);
        this.renderMarkers(this.currentData); // Ensure all markers are rendered on reset
        // Reset filter dropdowns if they exist
        if (this.filterControlInstance) {
            const countryFilter = this.filterControlInstance._container.querySelector('.country-filter');
            if (countryFilter) countryFilter.value = '';
            const portFilter = this.filterControlInstance._container.querySelector('.port-filter');
            if (portFilter) {
                portFilter.innerHTML = '<option value="">Select Port</option>';
                portFilter.disabled = true;
            }
        }
      });

      // Prevent map events on the control
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
  
      return div;
    };
    
    controlContainer.addTo(this.map);
  }
  
  addFilterControl() {
    // Remove existing filter control if it exists
    if (this.filterControlInstance) {
        this.map.removeControl(this.filterControlInstance);
    }

    const control = L.control({ position: 'bottomright' });
    
    control.onAdd = () => {
      const div = L.DomUtil.create('div', 'filter-control');
      const countries = [...new Set(this.currentData
        .map(p => p.country)
        .filter(c => c && c.trim() !== '')
      )].sort((a, b) => a.localeCompare(b));
  
      div.innerHTML = `
        <select class="country-filter">
          <option value="">Select Country</option>
          ${countries.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <select class="port-filter" disabled>
          <option value="">Select Port</option>
        </select>
      `;
  
      const countryFilter = div.querySelector('.country-filter');
      const portFilter = div.querySelector('.port-filter');
  
      countryFilter.addEventListener('change', (e) => {
        const country = e.target.value;
        portFilter.innerHTML = '<option value="">Select Port</option>';
        portFilter.disabled = !country;
  
        if (!country) {
          this.map.setView([37.8, -96], 4);
          this.renderMarkers(this.currentData); // Render ALL markers
          return;
        }
  
        const countryPorts = this.currentData
          .filter(p => p.country === country)
          .sort((a, b) => a.port.localeCompare(b.port));
  
        const countryCenter = this.getCountryCenter(countryPorts);
        this.map.setView(countryCenter, 5); // Use fixed zoom level 5 for consistency
        this.renderMarkers(this.currentData); // Render ALL markers, only change view
      });
  
      portFilter.addEventListener('change', (e) => {
        const portName = e.target.value;
        if (!portName) {
            // If "Select Port" is chosen after a country, just keep country view
            const country = countryFilter.value;
            if (country) {
                const countryPorts = this.currentData.filter(p => p.country === country);
                const countryCenter = this.getCountryCenter(countryPorts);
                this.map.setView(countryCenter, 5); // Use fixed zoom level 5 for consistency
            } else {
                this.map.setView([37.8, -96], 4); // If no country selected, reset to global view
            }
            this.renderMarkers(this.currentData); // Render ALL markers
            return;
        }
  
        const port = this.currentData.find(p => p.port === portName);
        if (port) {
          this.map.setView([port.lat, port.lng], 8); // Use fixed zoom level 8 for consistency
          this.renderMarkers(this.currentData); // Render ALL markers, only change view
        }
      });

      // Prevent map events on the control
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
  
      return div;
    };
    
    control.addTo(this.map);
    this.filterControlInstance = control; // Store instance to manage it
  }
  
  getCountryCenter(ports) {
    if (!ports || ports.length === 0) return [37.8, -96];
    const lats = ports.map(p => p.lat);
    const lngs = ports.map(p => p.lng);
    return [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lngs) + Math.max(...lngs)) / 2
    ];
  }
  
  getRadiusByDelay(delayDays) {
    if (!delayDays) return 5;
    return Math.min(20, Math.max(5, delayDays * 1.5));
  }

  getColor(level) {
    const colors = {
      'low': '#4CAF50',
      'medium': '#FFC107',
      'high': '#F44336'
    };
    return colors[level] || '#555';
  }

  getTextColor(level) {
    const colors = {
      'low': '#2E7D32',
      'medium': '#FF8F00',
      'high': '#C62828'
    };
    return colors[level] || '#333';
  }

  createPopupContent(port) {
    // Removed the <div class="map-tooltip"> wrapper
    return `
        <h4>${port.port}, ${port.country}</h4>
        <p><strong>Current Delay:</strong> ${port.current_delay}</p>
        <p><strong>Delay Level:</strong> 
          <span style="color: ${this.getTextColor(port.delay_level)}">
            ${port.delay_level}
          </span>
        </p>
        <p><strong>Port Code:</strong> ${port.port_code}</p>
        <p><strong>Weekly Median:</strong> ${port.weekly_median_delay} days</p>
        <p><strong>Monthly Max:</strong> ${port.monthly_max_delay} days</p>
    `;
  }

  // Adding displayErrorMessage for consistency and good practice as it was previously commented out.
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

// Expose the class to the global scope
if (typeof window !== 'undefined') {
  window.OceanCongestionMap = OceanCongestionMap;
}
