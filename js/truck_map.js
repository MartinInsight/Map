class TruckCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.stateLayer = null;
    this.currentMode = 'inbound';
    this.metricData = null;
    this.initialized = false;
    this.controlDiv = null;

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
      
      const rawData = await response.json();
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
    } catch (e) {
      console.error("Truck data loading failed:", e);
      return this.useFallbackData();
    }
  }

  useFallbackData() {
    console.warn("Using fallback data");
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
    if (this.stateLayer) {
      this.map.removeLayer(this.stateLayer);
    }

    this.stateLayer = L.geoJSON(geoJson, {
      style: (feature) => this.getStyle(feature),
      onEachFeature: (feature, layer) => this.bindEvents(feature, layer)
    }).addTo(this.map);
  }

  getStyle(feature) {
    const data = this.metricData[feature.id] || {};
    const colorValue = this.currentMode === 'inbound' 
      ? data.inboundColor 
      : data.outboundColor;
    
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
      '-3': '#F44336', // Red (High)
      '-2': '#FF9800', // Orange (Medium-High)
      '-1': '#FFC107', // Amber (Medium)
      '0': '#8BC34A',  // Light Green (Low)
      '1': '#4CAF50',  // Green (Very Low)
      '2': '#2E7D32',  // Dark Green
      '3': '#1B5E20'   // Darker Green
    };
    return colors[value] || '#cccccc';
  }

  bindEvents(feature, layer) {
    const stateCode = feature.id;
    const data = this.metricData?.[stateCode] || {};
    
    layer.on({
      mouseover: (e) => this.showTooltip(e, data),
      mouseout: () => this.hideTooltip(),
      click: () => this.zoomToState(feature)
    });
  }

  showTooltip(event, data) {
    if (!this.initialized) return;
  
    const formatValue = (val) => {
      const num = Number(val);
      return isNaN(num) ? 0 : Math.abs(num).toFixed(2);
    };
  
    const isInbound = this.currentMode === 'inbound';
    const delay = isInbound ? data.inboundDelay : data.outboundDelay;
    const dwell = isInbound ? data.dwellInbound : data.dwellOutbound;
  
    // 더 간결한 HTML 구조로 변경
    const content = `
      <div class="truck-tooltip">
        <h4>${data.name || 'Unknown'}</h4>
        <div>
          <strong>Truck Movement</strong>
          <p class="${delay >= 0 ? 'truck-positive' : 'truck-negative'}">
            ${delay >= 0 ? '↑' : '↓'} ${formatValue(delay)}%
            <span class="truck-normal-text">
              ${delay >= 0 ? ' above ' : ' below '}2 weeks moving average
            </span>
          </p>
        </div>
        <div>
          <strong>Dwell Time</strong>
          <p class="${dwell >= 0 ? 'truck-positive' : 'truck-negative'}">
            ${dwell >= 0 ? '↑' : '↓'} ${formatValue(dwell)}%
            <span class="truck-normal-text">
              ${dwell >= 0 ? ' above ' : ' below '}2 weeks moving average
            </span>
          </p>
        </div>
      </div>
    `;
  
    L.popup({
      className: 'truck-tooltip-container', // 새 클래스 추가
      maxWidth: 300,
      autoClose: false,
      closeButton: false,
      closeOnClick: false
    })
    .setLatLng(event.latlng)
    .setContent(content)
    .openOn(this.map);
  }
  hideTooltip() {
    this.map.closePopup();
  }
  
  zoomToState(feature) {
    const bounds = L.geoJSON(feature).getBounds();
    this.map.fitBounds(bounds);
  }

  addControls() {
    const controlContainer = L.control({ position: 'topright' });
    
    controlContainer.onAdd = () => {
      this.controlDiv = L.DomUtil.create('div', 'truck-control-container');
      this.renderControls();
      return this.controlDiv;
    };
    
    controlContainer.addTo(this.map);
  }

  renderControls() {
    this.controlDiv.innerHTML = `
      <div class="truck-toggle-container">
        <div class="truck-toggle-wrapper">
          <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" 
                  data-mode="inbound">INBOUND</button>
          <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" 
                  data-mode="outbound">OUTBOUND</button>
        </div>
        <button class="truck-reset-btn" id="truck-reset-view">Reset View</button>
      </div>
    `;

    this.controlDiv.querySelectorAll('.truck-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.renderControls();
        if (this.stateLayer) {
          this.stateLayer.setStyle(feature => this.getStyle(feature));
        }
      });
    });

    this.controlDiv.querySelector('#truck-reset-view').addEventListener('click', () => {
      this.map.setView([37.8, -96], 4);
    });
  }
}

// 전역 변수로 노출
window.TruckCongestionMap = TruckCongestionMap;
