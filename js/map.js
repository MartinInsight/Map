class TruckCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([43.8041, -120.5542], 6);
    this.stateLayer = null;
    this.currentMode = 'inbound';
    this.metricData = {};

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.addControls();
    this.loadData();
  }

  async loadData() {
    try {
      const [geoJsonResp, sheetDataResp] = await Promise.all([
        fetch('data/us-states.json'),
        fetch('data/data.json')
      ]);

      if (!geoJsonResp.ok || !sheetDataResp.ok) {
        throw new Error("Data loading failed");
      }

      const geoJson = await geoJsonResp.json();
      const rawData = await sheetDataResp.json();

      this.processMetricData(rawData);
      this.renderMap(geoJson);
    } catch (e) {
      console.error("Error:", e);
      this.useFallbackData();
    }
  }

processMetricData(rawData) {
  this.metricData = Object.fromEntries(
    Object.entries(rawData).map(([code, data]) => {
      return [
        code,
        {
          name: data.name,
          inboundDelay: Number(data.inboundDelay) || 0,
          inboundColor: Math.min(3, Math.max(-3, Number(data.inboundColor) || 0),
          outboundDelay: Number(data.outboundDelay) || 0,
          outboundColor: Math.min(3, Math.max(-3, Number(data.outboundColor) || 0),
          dwellInbound: Number(data.dwellInbound) || 0,
          dwellOutbound: Number(data.dwellOutbound) || 0
        }
      ];
    }
  );
}

  useFallbackData() {
    console.warn("Using fallback data");
    this.metricData = {
      'OR': {
        name: 'Oregon',
        inboundDelay: 5.99,
        inboundColor: 1,
        outboundDelay: -3.2,
        outboundColor: -1,
        dwellInbound: -5.51,
        dwellOutbound: 2.1
      }
    };
    
    fetch('data/us-states.json')
      .then(res => res.json())
      .then(geoJson => this.renderMap(geoJson))
      .catch(e => console.error("Fallback failed:", e));
  }

  renderMap(geoJson) {
    // 기존 레이어 제거
    if (this.stateLayer) {
      this.map.removeLayer(this.stateLayer);
    }

    // 주별 폴리곤 렌더링
    this.stateLayer = L.geoJSON(geoJson, {
      style: (feature) => this.getStyle(feature),
      onEachFeature: (feature, layer) => this.bindEvents(feature, layer)
    }).addTo(this.map);

    // 범례 업데이트
    this.updateLegend();
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
    // 색상 그래디언트 (-3 ~ 3)
    const colors = {
      '-3': '#d73027',  // 진한 빨강
      '-2': '#f46d43',
      '-1': '#fdae61',  // 연한 빨강
      '0': '#ffffbf',   // 중립
      '1': '#a6d96a',   // 연한 초록
      '2': '#66bd63',
      '3': '#1a9850'    // 진한 초록
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
    const safeNumber = (val) => {
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    };
  
    const isInbound = this.currentMode === 'inbound';
    const delay = safeNumber(isInbound ? data.inboundDelay : data.outboundDelay);
    const dwell = safeNumber(isInbound ? data.dwellInbound : data.dwellOutbound);
  
    const content = `
      <div class="map-tooltip">
        <h4>${data.name || 'Unknown'}</h4>
        
        <div class="metric-box">
          <strong>Truck Movement</strong>
          <p class="${delay >= 0 ? 'positive' : 'negative'}">
            <b>${delay >= 0 ? '↑' : '↓'} ${Math.abs(delay).toFixed(2)}%</b> ${delay >= 0 ? 'above' : 'below'} 2 weeks moving average
          </p>
        </div>
        
        <div class="metric-box">
          <strong>Dwell Time</strong>
          <p class="${dwell >= 0 ? 'positive' : 'negative'}">
            <b>${dwell >= 0 ? '↑' : '↓'} ${Math.abs(dwell).toFixed(2)}%</b> ${dwell >= 0 ? 'above' : 'below'} 2 weeks moving average
          </p>
        </div>
      </div>
    `;
  
    // 주의 정중앙 계산
    const bounds = event.target.getBounds();
    const center = bounds.getCenter();
    
    L.popup()
      .setLatLng(center)
      .setContent(content)
      .openOn(this.map);
  }
  
  hideTooltip() {
    if (this.tooltip) this.map.closePopup(this.tooltip);
  }

  zoomToState(feature) {
    this.map.fitBounds(L.geoJSON(feature).getBounds(), { padding: [50, 50] });
  }

  // addControls 및 renderControls 메서드 수정
  addControls() {
    const controlContainer = L.control({ position: 'topright' });
    
    controlContainer.onAdd = () => {
      this.controlDiv = L.DomUtil.create('div', 'mode-control');
      this.renderControls();
      return this.controlDiv;
    };
    
    controlContainer.addTo(this.map);
  }
  
  renderControls() {
    this.controlDiv.innerHTML = `
      <div class="toggle-container">
        <button class="reset-btn">Reset View</button>
        <div class="toggle-wrapper">
          <button class="toggle-btn ${this.currentMode === 'inbound' ? 'active' : ''}" 
                  data-mode="inbound">INBOUND</button>
          <button class="toggle-btn ${this.currentMode === 'outbound' ? 'active' : ''}" 
                  data-mode="outbound">OUTBOUND</button>
        </div>
      </div>
    `;

    this.controlDiv.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.renderControls();
        this.stateLayer.setStyle(feature => this.getStyle(feature));
        this.updateLegend();
      });
    });
  
    this.controlDiv.querySelector('.reset-btn').addEventListener('click', () => {
      this.map.setView([37.8, -96], 4);
    });
  }
  
  // 범례 유지 (기존과 동일)
  updateLegend() {
    if (this.legend) this.map.removeControl(this.legend);
    
    this.legend = L.control({ position: 'bottomright' });
    
    this.legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      const grades = [-3, -2, -1, 0, 1, 2, 3];
      const title = `${this.currentMode.toUpperCase()} DELAY`;
      
      div.innerHTML = `<strong>${title}</strong><br>`;
      
      grades.forEach(grade => {
        div.innerHTML +=
          `<i style="background:${this.getColor(grade)}"></i> ` +
          `${grade < 0 ? grade : '+' + grade}<br>`;
      });
      
      return div;
    };
    
    this.legend.addTo(this.map);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TruckCongestionMap('map');
});
