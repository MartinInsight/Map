class TruckCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.stateLayer = null;
    this.currentMode = 'inbound';
    this.metricData = null;
    this.geoJsonData = null;
    this.initialized = false;
    this.controlDiv = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    // 최대 줌 아웃 범위 제한
    this.map.setMaxBounds([
      [-85, -180],
      [85, 180]
    ]);
    
    // 수정된 줌 아웃 제한 코드 (다른 맵과 동일하게 적용)
    this.map.on('zoomend', () => {
      const currentZoom = this.map.getZoom();
      const bounds = this.map.getBounds();
      const mapHeight = bounds.getNorth() - bounds.getSouth();
      if (mapHeight > 140) { // 150에서 140으로 변경
        this.map.setZoom(Math.max(2, currentZoom - 1)); // 0.5에서 1로 변경, 최소 줌 레벨 2로 제한
      }
    });

    this.init();
  }

  async init() {
    try {
      const [geoJson, sheetData] = await Promise.all([
        fetch('data/us-states.json').then(res => res.json()),
        this.fetchSheetData()
      ]);

      this.geoJsonData = geoJson;
      this.metricData = sheetData;

      this.renderMap();
      this.addControls();
      this.addFilterControl();
      this.initialized = true;
    } catch (err) {
      console.error("Initialization failed:", err);
      this.showError();
    }
  }

  async fetchSheetData() {
    try {
      const res = await fetch('data/us-truck.json');
      if (!res.ok) throw new Error("Truck data fetch error");
      return await res.json();
    } catch (err) {
      console.warn("Fallback data in use.");
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
  }

  renderMap() {
    if (this.stateLayer) this.map.removeLayer(this.stateLayer);

    this.stateLayer = L.geoJSON(this.geoJsonData, {
      style: this.getStyle.bind(this),
      onEachFeature: this.bindEvents.bind(this)
    }).addTo(this.map);
  }

  getStyle(feature) {
    const stateCode = feature.id;
    const data = this.metricData[stateCode] || {};
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
    const stateCode = feature.id;
    const data = this.metricData[stateCode] || {};

    layer.on({
      mouseover: (e) => this.showTooltip(e, data),
      mouseout: () => this.map.closePopup(),
      click: () => this.zoomToState(feature)
    });
  }

  showTooltip(e, data) {
    if (!this.initialized) return;

    const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
    const isInbound = this.currentMode === 'inbound';
    const delay = isInbound ? data.inboundDelay : data.outboundDelay;
    const dwell = isInbound ? data.dwellInbound : data.dwellOutbound;

    const content = `
      <div class="truck-tooltip">
        <h4>${data.name || 'Unknown'}</h4>
        <div>
          <strong>Truck Movement</strong>
          <p class="${delay >= 0 ? 'truck-positive' : 'truck-negative'}">
            ${delay >= 0 ? '↑' : '↓'} ${format(delay)}%
            <span class="truck-normal-text">${delay >= 0 ? 'above' : 'below'} 2-week avg</span>
          </p>
        </div>
        <div>
          <strong>Dwell Time</strong>
          <p class="${dwell >= 0 ? 'truck-positive' : 'truck-negative'}">
            ${dwell >= 0 ? '↑' : '↓'} ${format(dwell)}%
            <span class="truck-normal-text">${dwell >= 0 ? 'above' : 'below'} 2-week avg</span>
          </p>
        </div>
      </div>
    `;

    L.popup({
      className: 'truck-tooltip-container',
      maxWidth: 300,
      autoClose: false,
      closeButton: false,
      closeOnClick: false
    })
    .setLatLng(e.latlng)
    .setContent(content)
    .openOn(this.map);
  }

  zoomToState(feature) {
    const bounds = L.geoJSON(feature).getBounds();
    this.map.fitBounds(bounds.pad(0.3));
  }

  addControls() {
    const control = L.control({ position: 'topright' });

    control.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-control-container'); // 클래스명 변경
      this.controlDiv = div;
      this.renderControls();
      return div;
    };

    control.addTo(this.map);
  }

  renderControls() {
    this.controlDiv.innerHTML = `
      <div class="truck-toggle-container">
        <div class="truck-toggle-wrapper">
          <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">INBOUND</button>
          <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUTBOUND</button>
        </div>
        <button class="reset-btn">Reset View</button> <!-- 클래스명 통일 -->
      </div>
    `;

    this.controlDiv.querySelectorAll('.truck-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.renderControls();
        this.stateLayer.setStyle(this.getStyle.bind(this));
      });
    });

    this.controlDiv.querySelector('.reset-btn').addEventListener('click', () => {
      this.map.setView([37.8, -96], 4);
    });
  }

  addFilterControl() {
    const control = L.control({ position: 'bottomright' });
  
    control.onAdd = () => {
      const div = L.DomUtil.create('div', 'filter-control');
      
      // 주 목록 정렬
      const states = this.geoJsonData.features
        .map(f => ({
          id: f.id,
          name: f.properties.name
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      div.innerHTML = `
        <select class="state-filter">
          <option value="">Select State</option>
          ${states.map(state => 
            `<option value="${state.id}">${state.name}</option>`
          ).join('')}
        </select>
      `;
  
      div.querySelector('.state-filter').addEventListener('change', (e) => {
        const stateId = e.target.value;
        if (!stateId) {
          this.map.setView([37.8, -96], 4);
          return;
        }
  
        const state = this.geoJsonData.features.find(f => f.id === stateId);
        if (state) {
          const bounds = L.geoJSON(state).getBounds();
          this.map.fitBounds(bounds.pad(0.3));
        }
      });
  
      return div;
    };
  
    control.addTo(this.map);
  }
  
  showError() {
    const errorControl = L.control({ position: 'topright' });

    errorControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'error-message');
      div.innerHTML = 'Failed to load truck data.';
      div.style.backgroundColor = 'white';
      div.style.padding = '10px';
      div.style.borderRadius = '5px';
      div.style.boxShadow = '0 0 10px rgba(0,0,0,0.2)';
      return div;
    };

    errorControl.addTo(this.map);
  }
}

window.TruckCongestionMap = TruckCongestionMap;
