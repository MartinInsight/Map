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
    // 1. CSV 파일 경로 확인
    const csvPath = window.location.href.includes('github.io') 
      ? 'data/data.csv'  // GitHub Pages 배포 시
      : '../data/data.csv';  // 로컬 개발 시

    // 2. 데이터 로드
    const response = await fetch(csvPath);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const csvText = await response.text();
    const rows = csvText.split('\n').filter(row => row.trim() !== '');
    
    // 3. 데이터 파싱
    this.metricData = {};
    const headers = rows[0].split(',');
    
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i].split(',');
      const code = values[1]?.trim();
      if (code) {
        this.metricData[code] = {
          name: values[0]?.trim(),
          inboundDelay: parseFloat(values[2]) || 0,
          inboundColor: parseInt(values[3]) || 0,
          outboundDelay: parseFloat(values[4]) || 0,
          outboundColor: parseInt(values[5]) || 0,
          dwellInbound: parseFloat(values[6]) || 0,
          dwellOutbound: parseFloat(values[8])?.trim() || 0  // Dwell Outbound는 9번째 컬럼
        };
      }
    }
    console.log('로드된 데이터 샘플:', this.metricData['TN']);  // 테네시 데이터 확인
  } catch (e) {
    console.error('데이터 로드 실패:', e);
    this.showError();
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
    const isInbound = this.currentMode === 'inbound';
    const delay = isInbound ? data.inboundDelay : data.outboundDelay;
    const dwell = isInbound ? data.dwellInbound : data.dwellOutbound;
  
    L.popup()
      .setLatLng(event.latlng)
      .setContent(`
        <div style="padding:5px">
          <strong>${data.name || 'Unknown'}</strong><br>
          ${this.currentMode.toUpperCase()} Delay: <b>${delay.toFixed(2)}%</b><br>
          Dwell Time: <b>${dwell.toFixed(2)} mins</b>
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
