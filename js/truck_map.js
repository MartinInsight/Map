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
      const [geoJson, truckData] = await Promise.all([
        fetch('data/us-states.json').then(res => res.json()),
        fetch('data/us-truck.json').then(res => res.json())
      ]);
      
      this.metricData = this.processTruckData(truckData);
      this.renderMap(geoJson);
      this.initialized = true;
    } catch (error) {
      console.error("Initialization failed:", error);
      this.metricData = this.useFallbackData();
      this.renderMap(await fetch('data/us-states.json').then(res => res.json()));
    }
  }

  processTruckData(rawData) {
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
    console.warn("Using fallback truck data");
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
    container.style.height = '40px'; // 고정 높이 설정
    
    container.innerHTML = `
      <div style="display: flex; align-items: center; height: 100%;">
        <div class="truck-toggle-wrapper">
          <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" 
                  data-mode="inbound">INBOUND</button>
          <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" 
                  data-mode="outbound">OUTBOUND</button>
        </div>
        <button class="reset-view-btn" style="margin-left: 10px;">Reset View</button>
      </div>
    `;

    // 이벤트 리스너
    container.querySelectorAll('.truck-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.updateControls(container);
        if (this.stateLayer) this.stateLayer.setStyle(feature => this.getStyle(feature));
      });
    });

    container.querySelector('.reset-view-btn').addEventListener('click', () => {
      this.map.setView([37.8, -96], 4);
    });

    this.map.getContainer().appendChild(container);
  }

  updateControls(container) {
    container.querySelectorAll('.truck-toggle-btn').forEach(btn => {
      btn.classList.toggle('truck-active', btn.dataset.mode === this.currentMode);
    });
  }
}

if (typeof window !== 'undefined') {
  window.TruckCongestionMap = TruckCongestionMap;
}
