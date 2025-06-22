class TruckCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.stateLayer = null;
    this.currentMode = 'inbound';
    this.metricData = null;
    this.initialized = false;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.addControls();
    this.initializeMap();
  }

  async initializeMap() {
    try {
      const [geoJson, sheetData] = await Promise.all([
        fetch('data/us-states.json').then(res => res.json()),
        this.fetchSheetData()
      ]);
      
      this.metricData = sheetData;
      this.renderMap(geoJson);
      this.initialized = true;
    } catch (error) {
      console.error("Initialization failed:", error);
      this.showError();
    }
  }

  async fetchSheetData() {
    try {
      const response = await fetch('data/us-truck.json');
      if (!response.ok) throw new Error("Failed to load truck data");
      return this.processData(await response.json());
    } catch (e) {
      console.error("Truck data loading failed:", e);
      return this.useFallbackData();
    }
  }

  processData(rawData) {
    return Object.fromEntries(
      Object.entries(rawData).map(([code, data]) => [
        code,
        {
          name: data.name,
          inboundDelay: Number(data.inboundDelay) || 0,
          inboundColor: Number(data.inboundColor) || 0,
          outboundDelay: Number(data.outboundDelay) || 0,
          outboundColor: Number(data.outboundColor) || 0,
          dwellInbound: Number(data.dwellInbound) || 0,
          dwellOutbound: Number(data.dwellOutbound) || 0
        }
      ])
    );
  }

  useFallbackData() {
    return {
      'TN': {
        name: 'Tennessee',
        inboundDelay: 0,
        inboundColor: 0,
        outboundDelay: 0,
        outboundColor: 0,
        dwellInbound: 0,
        dwellOutbound: 0
      }
    };
  }

  renderMap(geoJson) {
    if (this.stateLayer) this.map.removeLayer(this.stateLayer);
    
    this.stateLayer = L.geoJSON(geoJson, {
      style: (feature) => this.getStyle(feature),
      onEachFeature: (feature, layer) => this.bindEvents(feature, layer)
    }).addTo(this.map);
  }

  getStyle(feature) {
    const data = this.metricData[feature.id] || {};
    const colorValue = this.currentMode === 'inbound' ? data.inboundColor : data.outboundColor;
    
    return {
      fillColor: this.getColor(colorValue),
      weight: 1,
      opacity: 1,
      color: 'white',
      fillOpacity: 0.7
    };
  }

  getColor(value) {
    const colors = {
      '-3': '#d73027',
      '-2': '#f46d43',
      '-1': '#fdae61',
      '0': '#ffffbf',
      '1': '#a6d96a',
      '2': '#66bd63',
      '3': '#1a9850'
    };
    return colors[value] || '#cccccc';
  }

  bindEvents(feature, layer) {
    const data = this.metricData?.[feature.id] || {};
    
    layer.on({
      mouseover: (e) => this.showTooltip(e, data),
      mouseout: () => this.hideTooltip(),
      click: () => this.zoomToState(feature)
    });
  }

  showTooltip(event, data) {
    if (!this.initialized) return;
    
    const content = `
      <div class="truck-tooltip">
        <h4>${data.name || 'Unknown'}</h4>
        <div>
          <strong>Truck Movement</strong>
          <p class="${data.inboundDelay >= 0 ? 'truck-positive' : 'truck-negative'}">
            ${data.inboundDelay >= 0 ? '↑' : '↓'} ${Math.abs(data.inboundDelay || 0).toFixed(2)}%
          </p>
        </div>
      </div>
    `;
    
    L.popup()
      .setLatLng(event.latlng)
      .setContent(content)
      .openOn(this.map);
  }

  hideTooltip() {
    this.map.closePopup();
  }

  zoomToState(feature) {
    this.map.fitBounds(L.geoJSON(feature).getBounds());
  }

  addControls() {
    const container = L.DomUtil.create('div', 'map-control-container');
    
    container.innerHTML = `
      <div class="truck-toggle-wrapper">
        <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" 
                data-mode="inbound">INBOUND</button>
        <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" 
                data-mode="outbound">OUTBOUND</button>
      </div>
      <button class="reset-view-btn">Reset View</button>
    `;

    container.querySelectorAll('.truck-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.renderControls(container);
        if (this.stateLayer) {
          this.stateLayer.setStyle(feature => this.getStyle(feature));
        }
      });
    });

    container.querySelector('.reset-view-btn').addEventListener('click', () => {
      this.map.setView([37.8, -96], 4);
    });

    this.map.getContainer().appendChild(container);
  }
}

// 전역 변수로 노출
if (typeof window !== 'undefined') {
  window.TruckCongestionMap = TruckCongestionMap;
}
