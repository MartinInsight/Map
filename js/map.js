class TruckCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.stateLayer = null;
    this.currentMode = 'inbound';
    this.metricData = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.addControls();
    this.loadData();
  }

  async loadData() {
    try {
      // 1. GeoJSON 로드
      const geoJsonResp = await fetch('data/us-states.json');
      const geoJson = await geoJsonResp.json();

      // 2. Google Sheets 데이터 로드 (추가된 부분)
      await this.fetchSheetData();

      // 3. 지도 렌더링
      this.renderMap(geoJson);
    } catch (e) {
      console.error("Error:", e);
      this.showError();
    }
  }

  // Google Sheets 데이터 가져오는 함수 (여기에 추가!)
async fetchSheetData() {
  try {
    const response = await fetch('data/data.json');
    if (!response.ok) throw new Error("Failed to load data");
    
    const rawData = await response.json();
    
    // 데이터 타입 강제 변환
    this.metricData = Object.fromEntries(
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
    
    console.log("데이터 변환 완료:", this.metricData['TN']);
  } catch (e) {
    console.error("데이터 로드 실패:", e);
    this.useFallbackData();
  }
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

// js/map.js (수정된 부분)
showTooltip(event, data) {
    const formatValue = (val) => {
      const num = Number(val);
      return isNaN(num) ? 0 : Math.abs(num).toFixed(2);
    };

    const isInbound = this.currentMode === 'inbound';
    const delay = isInbound ? data.inboundDelay : data.outboundDelay;
    const dwell = data.dwellInbound;

    const delayInfo = {
      icon: delay >= 0 ? '↑' : '↓',
      text: delay >= 0 ? 'above' : 'below',
      colorClass: delay >= 0 ? 'positive' : 'negative'
    };
    
    const dwellInfo = {
      icon: dwell >= 0 ? '↑' : '↓',
      text: dwell >= 0 ? 'above' : 'below',
      colorClass: dwell >= 0 ? 'positive' : 'negative'
    };

    const content = `
      <div class="map-tooltip">
        <h4>${data.name || 'Unknown'}</h4>
        
        <div class="metric-box">
          <strong>Truck Movement</strong>
          <p class="${delayInfo.colorClass}">
            <strong>${delayInfo.icon} ${formatValue(delay)}% ${delayInfo.text} 2 weeks moving average</strong>
          </p>
        </div>
        
        <div class="metric-box">
          <strong>Dwell Time</strong>
          <p class="${dwellInfo.colorClass}">
            <strong>${dwellInfo.icon} ${formatValue(dwell)}% ${dwellInfo.text} 2 weeks moving average</strong>
          </p>
        </div>
      </div>
    `;

    L.popup()
      .setLatLng(event.latlng)
      .setContent(content)
      .openOn(this.map);
  }

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
        <div class="toggle-wrapper">
          <button class="toggle-btn ${this.currentMode === 'inbound' ? 'active' : ''}" 
                  data-mode="inbound">INBOUND</button>
          <button class="toggle-btn ${this.currentMode === 'outbound' ? 'active' : ''}" 
                  data-mode="outbound">OUTBOUND</button>
        </div>
        <button class="reset-btn" id="reset-view">Reset View</button>
      </div>
    `;

    this.controlDiv.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.renderControls();
        if (this.stateLayer) {
          this.stateLayer.setStyle(feature => this.getStyle(feature));
        }
      });
    });

    this.controlDiv.querySelector('#reset-view').addEventListener('click', () => {
      this.map.setView([37.8, -96], 4);
    });
  }

  updateLegend() {
    // 범례를 표시하지 않음
    if (this.legend) {
      this.map.removeControl(this.legend);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TruckCongestionMap('map');
});
