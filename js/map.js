class StateMap {
  constructor(mapElementId) {
    // 지도 초기화
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.stateLayer = null;
    
    // 타일 레이어 추가 (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(this.map);

    // 데이터 로드 시작
    this.loadData();
  }

  async loadData() {
    try {
      // 동적 경로 생성 (GitHub Pages 호환)
      const basePath = window.location.pathname.includes('/Map') 
        ? window.location.pathname.split('/').slice(0, 2).join('/')
        : '';
      
      const [geoJsonResp, metricsResp] = await Promise.all([
        fetch(`${basePath}/data/us-states.json`),
        fetch(`${basePath}/data/states-data.json?t=${Date.now()}`)
      ]);

      if (!geoJsonResp.ok || !metricsResp.ok) {
        throw new Error(`Data loading failed: ${geoJsonResp.status}, ${metricsResp.status}`);
      }

      const [geoJson, metrics] = await Promise.all([
        geoJsonResp.json(),
        metricsResp.json()
      ]);

      // GeoJSON 속성 처리
      geoJson.features.forEach(feature => {
        feature.properties.state_code = feature.properties.code || feature.id;
      });

      // 지도 렌더링
      this.renderMap(geoJson, metrics);
      
    } catch (e) {
      console.error("Data load error:", e);
      this.showErrorMap();
    }
  }

  renderMap(geoJson, metrics) {
    // 기존 레이어 제거
    if (this.stateLayer) {
      this.map.removeLayer(this.stateLayer);
    }

    // 새로운 레이어 생성
    this.stateLayer = L.geoJSON(geoJson, {
      style: (feature) => this.getStyle(feature, metrics),
      onEachFeature: (feature, layer) => this.bindPopup(feature, layer, metrics)
    }).addTo(this.map);

    // 범례 추가
    this.addLegend();
  }

  getStyle(feature, metrics) {
    const stateCode = feature.properties.state_code;
    const data = metrics[stateCode] || {};
    const value = data.inbound || 0;
    
    // 색상 그래디언트
    return {
      fillColor: this.getColor(value),
      weight: 1,
      opacity: 1,
      color: 'white',
      fillOpacity: 0.7
    };
  }

  getColor(value) {
    // 값에 따른 색상 반환
    if (value > 10000) return '#005824';
    if (value > 5000) return '#238b45';
    if (value > 1000) return '#41ab5d';
    if (value > 0) return '#74c476';
    if (value < 0) return '#f03b20';
    return '#cccccc'; // 중립값
  }

  bindPopup(feature, layer, metrics) {
    const stateCode = feature.properties.state_code;
    const data = metrics[stateCode] || {};
    
    layer.bindPopup(`
      <div class="map-popup">
        <h4>${data.name || feature.properties.name}</h4>
        <p><strong>Inbound:</strong> ${this.formatNumber(data.inbound)}</p>
        <p><strong>Outbound:</strong> ${this.formatNumber(data.outbound)}</p>
        <p><strong>Net Change:</strong> ${this.formatNumber(data.net)}</p>
      </div>
    `);
  }

  formatNumber(num) {
    if (num === undefined || num === null) return 'N/A';
    return new Intl.NumberFormat('en-US').format(num);
  }

  addLegend() {
    const legend = L.control({ position: 'bottomright' });
    
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      const grades = [0, 1000, 5000, 10000];
      const labels = ['<strong>Population Change</strong>'];
      
      // 범례 아이템 추가
      for (let i = 0; i < grades.length; i++) {
        div.innerHTML +=
          `<i style="background:${this.getColor(grades[i] + 1)}"></i> ` +
          `${grades[i]}${grades[i + 1] ? `–${grades[i + 1]}` : '+'}<br>`;
      }
      
      div.innerHTML += `<i style="background:#f03b20"></i> Negative<br>`;
      div.innerHTML += labels.join('<br>');
      return div;
    };
    
    legend.addTo(this.map);
  }

  showErrorMap() {
    // 오류 발생 시 대체 콘텐츠 표시
    this.map.setView([37.8, -96], 3);
    L.marker([39.5, -98.35]).addTo(this.map)
      .bindPopup('Data loading failed')
      .openPopup();
  }
}

// 지도 초기화
document.addEventListener('DOMContentLoaded', () => {
  new StateMap('map');
});
