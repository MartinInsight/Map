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
  // 값 포맷팅 함수
  const formatValue = (val) => {
    const num = Number(val);
    return isNaN(num) ? 0 : Math.abs(num).toFixed(2);
  };

  // 방향 및 스타일 결정
  const getDirectionStyle = (value) => {
    if (value >= 0) return { 
      icon: '↑', 
      text: 'above', 
      color: '#27ae60' // 초록
    };
    return { 
      icon: '↓', 
      text: 'below', 
      color: '#e74c3c' // 빨강
    };
  };

  const delay = this.currentMode === 'inbound' ? data.inboundDelay : data.outboundDelay;
  const dwell = data.dwellInbound;
  const delayStyle = getDirectionStyle(delay);
  const dwellStyle = getDirectionStyle(dwell);

  // 툴팁 HTML
  const content = `
    <div class="map-tooltip">
      <h3>${data.name || 'Unknown'}</h3>
      
      <div class="metric-group">
        <h4>Truck Movement</h4>
        <p style="color: ${delayStyle.color}">
          <strong>${delayStyle.icon} ${formatValue(delay)}% ${delayStyle.text}</strong> 2 weeks moving average
        </p>
      </div>
      
      <div class="metric-group">
        <h4>Dwell Time</h4>
        <p style="color: ${dwellStyle.color}">
          <strong>${dwellStyle.icon} ${formatValue(dwell)}% ${dwellStyle.text}</strong> 2 weeks moving average
        </p>
      </div>
    </div>
  `;

  // 툴팁 생성 (주 중심에 고정)
  const bounds = L.geoJSON(feature).getBounds();
  const center = bounds.getCenter();
  
  L.popup({ autoClose: false, closeOnClick: false })
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

addControls() {
  // 기존 범례 제거
  if (this.legend) this.map.removeControl(this.legend);

  // 컨트롤 컨테이너 생성
  const controlContainer = L.control({ position: 'topright' });
  
  controlContainer.onAdd = () => {
    this.controlDiv = L.DomUtil.create('div', 'map-controls');
    
    // Reset View 버튼
    const resetBtn = L.DomUtil.create('button', 'reset-btn', this.controlDiv);
    resetBtn.innerHTML = 'Reset View';
    L.DomEvent.on(resetBtn, 'click', () => {
      this.map.setView([37.8, -96], 4);
    });

    // 토글 버튼 컨테이너
    const toggleContainer = L.DomUtil.create('div', 'toggle-container', this.controlDiv);
    
    // INBOUND 버튼
    const inboundBtn = L.DomUtil.create('button', 'toggle-btn inbound', toggleContainer);
    inboundBtn.innerHTML = 'INBOUND';
    inboundBtn.dataset.mode = 'inbound';
    
    // OUTBOUND 버튼
    const outboundBtn = L.DomUtil.create('button', 'toggle-btn outbound', toggleContainer);
    outboundBtn.innerHTML = 'OUTBOUND';
    outboundBtn.dataset.mode = 'outbound';
    
    // 버튼 이벤트 바인딩
    [inboundBtn, outboundBtn].forEach(btn => {
      L.DomEvent.on(btn, 'click', () => {
        this.currentMode = btn.dataset.mode;
        this.updateToggleButtons();
        if (this.stateLayer) {
          this.stateLayer.setStyle(feature => this.getStyle(feature));
        }
      });
    });

    this.updateToggleButtons();
    return this.controlDiv;
  };

  controlContainer.addTo(this.map);
}

updateToggleButtons() {
  const buttons = this.controlDiv.querySelectorAll('.toggle-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === this.currentMode);
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
