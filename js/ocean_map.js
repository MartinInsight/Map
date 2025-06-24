class OceanCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.markers = [];
    this.currentData = [];
    this.lastUpdated = null;

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
      const bounds = this.map.getBounds();
      const mapHeight = bounds.getNorth() - bounds.getSouth();
      if (mapHeight > 140) { // 150에서 140으로 변경
        this.map.setZoom(Math.max(2, currentZoom - 1)); // 0.5에서 1로 변경, 최소 줌 레벨 2로 제한
      }
    });
    
    this.loadData();
    this.addControls();
    this.addFilterControl();
  }

  async loadData() {
    try {
      const response = await fetch('data/global-ports.json');
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
  
      // ✅ 이 부분 추가해야 country 목록이 나옴!
      this.addFilterControl();
  
    } catch (error) {
      console.error("Failed to load ocean data:", error);
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
          const popup = L.popup()
            .setLatLng(e.latlng)
            .setContent(this.createPopupContent(port))
            .openOn(this.map);
        },
        mouseout: () => {
          this.map.closePopup();
        }
      });

      marker.addTo(this.map);
      this.markers.push(marker);
    });
  }

  addLastUpdatedText() {
    if (this.lastUpdated) {
      const date = new Date(this.lastUpdated);
      const formattedDate = `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;

      const infoControl = L.control({ position: 'bottomleft' });

      infoControl.onAdd = () => {
        const div = L.DomUtil.create('div', 'last-updated-info');
        div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
        div.style.backgroundColor = 'white';
        div.style.padding = '5px 10px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
        return div;
      };

      infoControl.addTo(this.map);
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
      });
  
      return div;
    };
  
    controlContainer.addTo(this.map);
  }
  
  addFilterControl() {
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
          this.renderMarkers();
          return;
        }
  
        const countryPorts = this.currentData
          .filter(p => p.country === country)
          .sort((a, b) => a.port.localeCompare(b.port));
  
        countryPorts.forEach(port => {
          const option = document.createElement('option');
          option.value = port.port;
          option.textContent = port.port;
          portFilter.appendChild(option);
        });
  
        const countryCenter = this.getCountryCenter(countryPorts);
        this.map.setView(countryCenter, 5);
        this.renderMarkers(countryPorts);
      });
  
      portFilter.addEventListener('change', (e) => {
        const portName = e.target.value;
        if (!portName) return;
  
        const port = this.currentData.find(p => p.port === portName);
        if (port) {
          this.map.setView([port.lat, port.lng], 8);
          this.renderMarkers([port]);
        }
      });
  
      return div;
    };
  
    control.addTo(this.map);
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
    return `
      <div class="ocean-tooltip">
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
      </div>
    `;
  }
}

// 반드시 추가해야 하는 부분
if (typeof window !== 'undefined') {
  window.OceanCongestionMap = OceanCongestionMap;
}
