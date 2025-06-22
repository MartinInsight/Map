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
  const container = L.DomUtil.create('div', 'truck-control-container');
  
  // 인라인 스타일로 높이 강제 고정
  container.innerHTML = `
    <div style="display: flex; align-items: center; height: 32px; gap: 8px;">
      <!-- 인바운드/아웃바운드 토글 버튼 유지 -->
      <div style="display: flex; height: 100%; border-radius: 4px; overflow: hidden; border: 1px solid #e0e0e0;">
        <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" 
                data-mode="inbound" style="height: 100%; padding: 0 12px; border: none; background: ${this.currentMode === 'inbound' ? '#00657E' : '#f8f8f8'}; color: ${this.currentMode === 'inbound' ? 'white' : '#555'}; font-weight: ${this.currentMode === 'inbound' ? '600' : '500'};">INBOUND</button>
        <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" 
                data-mode="outbound" style="height: 100%; padding: 0 12px; border: none; background: ${this.currentMode === 'outbound' ? '#00657E' : '#f8f8f8'}; color: ${this.currentMode === 'outbound' ? 'white' : '#555'}; font-weight: ${this.currentMode === 'outbound' ? '600' : '500'};">OUTBOUND</button>
      </div>
      <!-- 리셋 버튼 -->
      <button class="truck-reset-btn" style="height: 100%; padding: 0 12px; border: 1px solid #e0e0e0; border-radius: 4px; background: white;">RESET</button>
    </div>
  `;

  // 이벤트 리스너
  container.querySelectorAll('.truck-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      this.currentMode = btn.dataset.mode;
      this.updateToggleButtons(container);
      if (this.stateLayer) this.stateLayer.setStyle(feature => this.getStyle(feature));
    });
  });

  container.querySelector('.truck-reset-btn').addEventListener('click', () => {
    this.map.setView([37.8, -96], 4);
  });

  this.map.getContainer().appendChild(container);
}

updateToggleButtons(container) {
  container.querySelectorAll('.truck-toggle-btn').forEach(btn => {
    const isActive = btn.dataset.mode === this.currentMode;
    btn.style.background = isActive ? '#00657E' : '#f8f8f8';
    btn.style.color = isActive ? 'white' : '#555';
    btn.style.fontWeight = isActive ? '600' : '500';
  });
}

if (typeof window !== 'undefined') {
  window.TruckCongestionMap = TruckCongestionMap;
}
