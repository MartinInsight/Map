class TruckCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.stateLayer = null;
    this.currentMode = 'inbound';
    this.metricData = null;

    // 지도 초기화
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    this.addControls();
    this.loadData(); // 데이터 로드 시작
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

showTooltip(event, data) {
  // 값 보정 로직 추가
  const safeNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  };

  const isInbound = this.currentMode === 'inbound';
  const delay = safeNumber(isInbound ? data.inboundDelay : data.outboundDelay);
  const dwell = safeNumber(isInbound ? data.dwellInbound : data.dwellOutbound);
  
    // 방향 아이콘 결정
    const delayIcon = delay >= 0 ? '↑' : '↓';
    const dwellIcon = dwell >= 0 ? '↑' : '↓';
    
    // 값에 따른 설명 텍스트
    const delayText = delay >= 0 ? "above" : "below";
    const dwellText = dwell >= 0 ? "above" : "below";
    
    // 색상 클래스 (CSS에 추가 필요)
    const delayClass = delay >= 0 ? "positive" : "negative";
    const dwellClass = dwell >= 0 ? "positive" : "negative";
  
    L.popup()
      .setLatLng(event.latlng)
      .setContent(`
        <div class="map-tooltip">
          <h4>${data.name || 'Unknown'}</h4>
          <div class="metric">
            <strong>Truck Movement</strong>
            <p class="${delayClass}">
              ${delayIcon} ${Math.abs(delay).toFixed(2)}% ${delayText} 2 weeks moving average
            </p>
          </div>
          <div class="metric">
            <strong>Dwell Time</strong>
            <p class="${dwellClass}">
              ${dwellIcon} ${Math.abs(dwell).toFixed(2)}% ${dwellText} 2 weeks moving average
            </p>
          </div>
        </div>
      `)
      .openOn(this.map);
  }

  hideTooltip() {
    if (this.tooltip) this.map.closePopup(this.tooltip);
  }

  zoomToState(feature) {
    this.map.fitBounds(L.geoJSON(feature).getBounds(), { padding: [50, 50] });
  }

  addControls() {
    // 모드 토글 버튼
    const toggleControl = L.control({ position: 'topright' });
    
    toggleControl.onAdd = () => {
      this.controlContainer = L.DomUtil.create('div', 'mode-control');
      this.renderToggle();
      return this.controlContainer;
    };
    
    toggleControl.addTo(this.map);
  }

  renderToggle() {
    this.controlContainer.innerHTML = `
      <div class="toggle-container">
        <button class="toggle-btn ${this.currentMode === 'inbound' ? 'active' : ''}" 
                data-mode="inbound">INBOUND</button>
        <button class="toggle-btn ${this.currentMode === 'outbound' ? 'active' : ''}" 
                data-mode="outbound">OUTBOUND</button>
      </div>
    `;

    // 버튼 이벤트 바인딩
    this.controlContainer.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentMode = btn.dataset.mode;
        this.renderToggle();
        this.stateLayer.setStyle(feature => this.getStyle(feature));
        this.updateLegend();
      });
    });
  }

  updateLegend() {
    // 기존 범례 제거
    if (this.legend) this.map.removeControl(this.legend);
    
    // 새로운 범례 추가
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

  showError() {
    this.map.setView([39.5, -98.35], 4);
    L.popup()
      .setLatLng([39.5, -98.35])
      .setContent('데이터를 불러오는 중 오류 발생')
      .openOn(this.map);
  }
}

// 지도 초기화
document.addEventListener('DOMContentLoaded', () => {
  new TruckCongestionMap('map');
});
